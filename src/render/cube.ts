import {
  BackSide,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { ColorId, Side, Vec3 } from '../core/types';
import { DEEP, PALETTE } from './palette';
import { SLAB_H } from './metrics';

import { clamp01, easeInOutCubic, easeOutCubic, smoothstep } from './easing';

const SIZE = 0.9;
const HALF = SIZE / 2;

export const ROLL_MS = 240;
/** 계단은 모서리를 넘느라 반 바퀴를 돈다. 그만큼 시간을 더 준다. */
export const CLIMB_MS = 400;
export const REFUSE_MS = 640;
export const SINK_MS = 1300;
const PAINT_MS = 220;

/** 발판 밑면. 거꾸로 매달린 큐브가 딛는 면이다. */
const UNDER = -SLAB_H;

/** 튕길 때 앞으로 기우는 구간의 비율과 최대 각도 */
const PUSH = 0.16;
const PEAK = 0.34;

/**
 * 벽에 부딪힌 각도 곡선.
 * 앞으로 쑥 기울었다가(PUSH 구간) 되튕겨 반대로 넘어갔다가 잦아든다.
 */
export function refuseAngle(u: number): number {
  const t = clamp01(u);
  if (t <= PUSH) return PEAK * easeOutCubic(t / PUSH);
  const k = (t - PUSH) / (1 - PUSH);
  return PEAK * Math.cos(k * Math.PI * 3.1) * Math.exp(-k * 4.6) * (1 - k ** 4);
}

type Anim =
  | {
      readonly kind: 'roll';
      readonly to: Vec3;
      /** 굴림 축이 지나는 점. 평지는 두 칸 사이 아래 모서리, 계단은 층계참 모서리다. */
      readonly pivot: Vector3;
      /** 출발할 때 축에서 큐브 한가운데까지 */
      readonly arm: Vector3;
      readonly axis: Vector3;
      /** 90° 면 평지, 180° 면 한 층 오르내리는 굴림이다 */
      readonly angle: number;
      /** 돌기만 해서는 못 메우는 나머지. 칸 사이 틈과 깊이 차를 여기서 채운다. */
      readonly slide: Vector3;
      readonly ms: number;
      readonly intoGoal: boolean;
      readonly away: Vec3;
      t: number;
    }
  | { readonly kind: 'refuse'; readonly toward: Vec3; readonly axis: Vector3; t: number; dinged: boolean }
  | { readonly kind: 'sink'; readonly away: Vec3; t: number };

/** 굴러갈 축. 진행 방향 t 로 넘어지려면 up × t 를 축으로 돈다. */
const axisFor = (toward: Vec3, up: number): Vector3 =>
  new Vector3(toward.z * up, 0, -toward.x * up);

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/*
 * 몸통. 모서리를 둥글린 상자에, 면이 향한 방향에 따라 밝기를 칠한다.
 * 조명은 없다 — 발판과 같은 규칙으로, 해가 왼쪽 위에 걸려 있다고 치고 면마다 명암을 정한다.
 * 굴러서 면이 바뀌어도 늘 "지금 위를 보는 면"이 밝으므로 입체가 무너지지 않는다.
 * 둥근 모서리에서는 명암이 부드럽게 넘어가 돌이 아니라 손에 쥐는 장난감처럼 읽힌다.
 */
const BODY = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 3, 0.1);

const SHADE_VERT = /* glsl */ `
varying vec3 vView;
void main() {
  vView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADE_FRAG = /* glsl */ `
uniform vec3 uDark;
uniform vec3 uMid;
uniform vec3 uLight;
uniform float uLift;
uniform float uOpacity;
varying vec3 vView;
void main() {
  vec3 n = normalize(vView);
  vec3 col = uMid;
  // 화면 왼쪽을 보는 면은 볕이 들고, 오른쪽을 보는 면은 그늘진다
  col = mix(col, mix(uMid, uLight, 0.45), smoothstep(0.3, 0.9, -n.x));
  col = mix(col, mix(uMid, uDark, 0.5), smoothstep(0.3, 0.9, n.x));
  // 위를 보는 면이 가장 밝고, 아래를 보는 면이 가장 어둡다
  col = mix(col, uLight, smoothstep(0.3, 0.9, n.y));
  col = mix(col, uDark, smoothstep(0.3, 0.9, -n.y));
  col = mix(col, uLight, uLift);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const shade = (lift: number): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uDark: { value: new Color() },
      uMid: { value: new Color() },
      uLight: { value: new Color() },
      uLift: { value: lift },
      uOpacity: { value: 1 },
    },
    vertexShader: SHADE_VERT,
    fragmentShader: SHADE_FRAG,
    transparent: true,
  });

/** 면마다 박힌 둥근 판. 면보다 살짝 밝아서 장난감 주사위처럼 읽힌다. */
const PANEL = (() => {
  const r = 0.09;
  const h = 0.27;
  const s = new Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new ShapeGeometry(s, 6);
})();

/** [위치, y축 회전, x축 회전] 여섯 면 */
const FACES: readonly (readonly [Vec3, number, number])[] = [
  [{ x: 0, y: 0, z: HALF + 0.003 }, 0, 0],
  [{ x: 0, y: 0, z: -HALF - 0.003 }, Math.PI, 0],
  [{ x: HALF + 0.003, y: 0, z: 0 }, Math.PI / 2, 0],
  [{ x: -HALF - 0.003, y: 0, z: 0 }, -Math.PI / 2, 0],
  [{ x: 0, y: HALF + 0.003, z: 0 }, 0, -Math.PI / 2],
  [{ x: 0, y: -HALF - 0.003, z: 0 }, 0, Math.PI / 2],
];

export class Cube {
  readonly root = new Group();
  private readonly mesh: Mesh;
  private readonly skin: ShaderMaterial;
  private readonly panels: ShaderMaterial;
  private readonly hull: MeshBasicMaterial;

  private readonly spin = new Quaternion();
  private cell: Vec3 = { x: 0, y: 0, z: 0 };
  private anim: Anim | null = null;
  private squash = 1;

  /** 조종 중이 아니면 색을 뺀다 */
  private dim = false;
  /** 지금 큐브가 머금은 색 */
  private tone: ColorId = 'blue';
  /** 스위치를 밟아 색이 넘어가는 중이면 그 진행도 */
  private blend = 1;
  private from: ColorId = 'blue';
  /** 문 안으로 완전히 들어갔는지 */
  private sunk = false;
  /** 발판 위면 +1 · 0, 밑에 매달리면 -1 · 발판 두께만큼 아래 */
  private up = 1;
  private base = 0;

  /** 벽에 닿는 순간 */
  onImpact: (() => void) | null = null;
  /** 한 칸 굴러 착지한 순간 */
  onLand: (() => void) | null = null;
  /** 문 안으로 완전히 들어간 순간 */
  onSettled: (() => void) | null = null;

  constructor() {
    this.skin = shade(0);
    this.mesh = new Mesh(BODY, this.skin);

    this.panels = shade(0.2);
    for (const [at, ry, rx] of FACES) {
      const panel = new Mesh(PANEL, this.panels);
      panel.position.set(at.x, at.y, at.z);
      panel.rotation.set(rx, ry, 0);
      this.mesh.add(panel);
    }

    // 같은 색 땅 위에 올라가도 큐브가 묻히지 않도록, 한 치수 큰 껍질의 안쪽 면으로 진한 외곽선을 두른다
    this.hull = new MeshBasicMaterial({ side: BackSide, transparent: true });
    const hull = new Mesh(BODY, this.hull);
    hull.scale.setScalar(1.075);
    this.mesh.add(hull);

    this.root.add(this.mesh);
  }

  /** 지금 서 있는 칸 */
  get position(): Vec3 {
    return this.cell;
  }

  /** 발판 위에 서 있는지, 밑에 매달려 있는지 */
  get side(): Side {
    return this.up === 1 ? 'top' : 'under';
  }

  /** 문에 들어가 판에서 빠졌는지 */
  get gone(): boolean {
    return this.sunk;
  }

  /** 고리 반쪽이 뜨는 자리. 머리 위, 밑에 매달린 큐브면 발밑이다. */
  badgeAt(out: Vector3, lift: number): Vector3 {
    const at = this.root.position;
    return out.set(at.x, at.y + this.up * lift, at.z);
  }

  /** 교대 판에서 지금 조종 중인지. 아닌 큐브는 색을 빼서 둔다. */
  setActive(on: boolean): void {
    this.dim = !on;
  }

  /** 발판의 어느 면에 붙는지. place() 전에 정한다. */
  setSide(side: Side): void {
    this.up = side === 'top' ? 1 : -1;
    this.base = side === 'top' ? 0 : UNDER;
  }

  get busy(): boolean {
    return this.anim !== null;
  }

  /** 문에 들어간 뒤의 모습으로 곧장 치운다. 되돌리기로 그 수를 되살릴 때 쓴다. */
  vanish(): void {
    this.anim = null;
    this.sunk = true;
    this.mesh.visible = false;
  }

  place(cell: Vec3, color: ColorId): void {
    this.cell = cell;
    this.anim = null;
    this.squash = 1;
    this.spin.identity();
    this.tone = color;
    this.blend = 1;
    this.repaint(1);
    this.sunk = false;
    this.mesh.scale.setScalar(1);
    this.fade(1);
    this.mesh.visible = true;
    this.rest();
  }

  /** 큐브 한가운데가 놓이는 자리 */
  private centreOf(cell: Vec3): Vector3 {
    return new Vector3(cell.x, cell.y + this.base + this.up * HALF, cell.z);
  }

  /**
   * 한 칸 구른다.
   *
   * 평지에서는 두 칸이 만나는 아래 모서리를 축으로 90° 넘어간다.
   * 한 층을 오르내릴 때는 층계참 모서리를 축으로 180° 돈다 — 큐브 크기와 칸 높이가 같아서,
   * 모서리를 타고 반 바퀴 넘어가는 것이 유일하게 성립하는 굴림이다. 그래서 뛰지 않고 굴러 오른다.
   *
   * 깊이는 직교 투영이라 화면에 안 보인다. 다만 구르는 동안 앞 겹에 가려지지 않도록
   * 카메라에 가까운 깊이에 붙여 굴린 뒤, 남은 깊이 차는 착지하며 메운다.
   */
  roll(from: Vec3, to: Vec3, toward: Vec3, forward: Vec3, painted: ColorId | null, intoGoal: boolean): void {
    const near = Math.min(dot(from, forward), dot(to, forward));
    const pull = (cell: Vec3): Vector3 => {
      const gap = near - dot(cell, forward);
      const at = this.centreOf(cell);
      return at.set(at.x + forward.x * gap, at.y, at.z + forward.z * gap);
    };
    const start = pull(from);
    const end = pull(to);
    const climbing = from.y !== to.y;

    const pivot = start.clone().add(end).multiplyScalar(0.5);
    // 평지에서는 축이 발밑 모서리로 내려간다. 계단에서는 두 자리의 한가운데가 곧 층계참 모서리다.
    if (!climbing) pivot.y = from.y + this.base;

    const axis = axisFor(toward, this.up);
    const angle = climbing ? Math.PI : Math.PI / 2;
    const arm = start.clone().sub(pivot);
    // 큐브가 칸보다 조금 작아서 돌기만 하면 살짝 못 미친다. 그 틈과 깊이 차를 같이 메운다.
    const landed = arm.clone().applyAxisAngle(axis, angle).add(pivot);
    const slide = this.centreOf(to).sub(landed);

    this.anim = {
      kind: 'roll',
      to,
      pivot,
      arm,
      axis,
      angle,
      slide,
      ms: climbing ? CLIMB_MS : ROLL_MS,
      intoGoal,
      away: forward,
      t: 0,
    };
    if (painted) {
      this.from = this.tone;
      this.tone = painted;
      this.blend = 0;
    }
  }

  refuse(toward: Vec3): void {
    this.anim = { kind: 'refuse', toward, axis: axisFor(toward, this.up), t: 0, dinged: false };
  }

  update(dt: number): void {
    const anim = this.anim;

    if (anim?.kind === 'roll') {
      anim.t = clamp01(anim.t + (dt * 1000) / anim.ms);
      const e = smoothstep(anim.t);
      const at = anim.arm.clone().applyAxisAngle(anim.axis, anim.angle * e).add(anim.pivot);
      this.root.position.set(
        at.x + anim.slide.x * e,
        at.y + anim.slide.y * e,
        at.z + anim.slide.z * e,
      );
      this.root.quaternion.setFromAxisAngle(anim.axis, anim.angle * e);
      this.mesh.position.set(0, 0, 0);
      this.mesh.quaternion.copy(this.spin);
      if (anim.t >= 1) {
        this.spin.premultiply(new Quaternion().setFromAxisAngle(anim.axis, anim.angle));
        this.cell = anim.to;
        if (anim.intoGoal) {
          this.anim = { kind: 'sink', away: anim.away, t: 0 };
          this.squash = 1;
        } else {
          this.anim = null;
          this.squash = 0;
        }
        this.rest();
        this.onLand?.();
      }
    } else if (anim?.kind === 'refuse') {
      anim.t = clamp01(anim.t + (dt * 1000) / REFUSE_MS);
      if (!anim.dinged && anim.t >= PUSH) {
        anim.dinged = true;
        this.onImpact?.();
      }
      this.root.position.set(
        this.cell.x + anim.toward.x * HALF,
        this.cell.y + this.base,
        this.cell.z + anim.toward.z * HALF,
      );
      this.root.quaternion.setFromAxisAngle(anim.axis, refuseAngle(anim.t));
      this.mesh.position.set(-anim.toward.x * HALF, this.up * HALF, -anim.toward.z * HALF);
      this.mesh.quaternion.copy(this.spin);
      if (anim.t >= 1) {
        this.anim = null;
        this.rest();
      }
    } else if (anim?.kind === 'sink') {
      // 문 안쪽 어둠으로 천천히 빨려 들어간다. 화면에서는 제자리에서 작아지며 사라진다.
      anim.t = clamp01(anim.t + (dt * 1000) / SINK_MS);
      const e = easeInOutCubic(anim.t);
      this.rest();
      this.mesh.position.set(anim.away.x * 0.42 * e, 0, anim.away.z * 0.42 * e);
      this.mesh.scale.setScalar(1 - 0.86 * e);
      this.fade(1 - e);

      if (anim.t >= 1) {
        this.anim = null;
        this.sunk = true;
        this.mesh.visible = false;
        this.onSettled?.();
      }
    } else {
      this.rest();
    }

    if (this.squash < 1) {
      this.squash = clamp01(this.squash + dt * 7);
      const e = easeOutCubic(this.squash);
      const y = 0.84 + 0.16 * e;
      this.mesh.scale.set(2 - y, y, 2 - y);
    } else if (!this.sunk && this.anim?.kind !== 'sink' && this.mesh.scale.y !== 1) {
      this.mesh.scale.set(1, 1, 1);
    }

    this.repaint(1 - Math.exp(-dt * 9));

    if (this.blend < 1) {
      this.blend = clamp01(this.blend + (dt * 1000) / PAINT_MS);
    }
  }

  private fade(a: number): void {
    this.skin.uniforms['uOpacity']!.value = a;
    this.panels.uniforms['uOpacity']!.value = a;
    this.hull.opacity = a;
  }

  /** 몸통 · 판 · 외곽선을 지금 색으로 다시 칠한다. */
  private repaint(rate: number): void {
    const ink = PALETTE[this.tone];
    const was = PALETTE[this.from];
    const k = this.blend < 1 ? 1 - easeOutCubic(this.blend) : 0;

    MID_TONE.copy(ink.mid).lerp(was.mid, k);
    LIGHT_TONE.copy(ink.light).lerp(was.light, k);
    DARK_TONE.copy(ink.dark).lerp(was.dark, k);
    EDGE_TONE.copy(ink.dark).lerp(was.dark, k).lerp(DEEP, 0.35);
    if (this.dim) {
      // 조종 중이 아닌 큐브는 색이 빠져 옅어진다
      MID_TONE.lerp(ink.light, 0.62);
      DARK_TONE.lerp(ink.light, 0.5);
      EDGE_TONE.lerp(ink.mid, 0.7);
    }

    for (const mat of [this.skin, this.panels]) {
      (mat.uniforms['uMid']!.value as Color).lerp(MID_TONE, rate);
      (mat.uniforms['uLight']!.value as Color).lerp(LIGHT_TONE, rate);
      (mat.uniforms['uDark']!.value as Color).lerp(DARK_TONE, rate);
    }
    this.hull.color.lerp(EDGE_TONE, rate);
  }

  /** 아무 애니메이션도 없을 때의 기본 자세 */
  private rest(): void {
    this.root.position.set(this.cell.x, this.cell.y + this.base + this.up * HALF, this.cell.z);
    this.root.quaternion.identity();
    this.mesh.position.set(0, 0, 0);
    this.mesh.quaternion.copy(this.spin);
  }
}

/** 매 프레임 목표색을 담아 두는 그릇들. 프레임마다 Color 를 새로 만들지 않으려고 하나씩만 쓴다. */
const MID_TONE = new Color();
const LIGHT_TONE = new Color();
const DARK_TONE = new Color();
const EDGE_TONE = new Color();
