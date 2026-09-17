import {
  BackSide,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
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
      readonly toward: Vec3;
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

/*
 * 얼굴. 몸통과 따로 떠 있어서 굴러도 늘 카메라를 똑바로 본다.
 */
const EYE_GAP = 0.15;
const EYE_Y = 0.07;
const EYE_WHITE = new CircleGeometry(0.088, 24);
const EYE_RIM = new RingGeometry(0.088, 0.106, 24);
const PUPIL = new CircleGeometry(0.047, 18);
const GLINT = new CircleGeometry(0.017, 10);
/** 웃는 눈 ^ — 문에 들어갈 때 */
const HAPPY = new RingGeometry(0.058, 0.084, 18, 1, 0, Math.PI);
const CHEEK = new CircleGeometry(0.052, 18);
const SMILE = new RingGeometry(0.042, 0.066, 16, 1, Math.PI * 1.08, Math.PI * 0.84);
const GASP = new RingGeometry(0.026, 0.048, 16);
/** 식은땀 한 방울. 둥근 몸에 뾰족한 끝. */
const SWEAT = (() => {
  const s = new Shape();
  s.moveTo(0, 0.07);
  s.quadraticCurveTo(0.045, 0.01, 0.04, -0.02);
  s.absarc(0, -0.02, 0.04, 0, Math.PI, true);
  s.quadraticCurveTo(-0.045, 0.01, 0, 0.07);
  return new ShapeGeometry(s, 8);
})();

const WHITE = new Color(0xfffaf2);
const BLUSH = new Color(0xff8d7a);
const DROP = new Color(0xbfe4ff);

const flat = (color: Color, opacity = 1): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: color.clone(), transparent: true, opacity, side: DoubleSide, fog: false });

export class Cube {
  /** 판에 넣는 뿌리. 몸통과 얼굴을 함께 담는다. */
  readonly root = new Group();
  /** 구르고 튕기는 몸 */
  private readonly body = new Group();
  private readonly mesh: Mesh;
  private readonly skin: ShaderMaterial;
  private readonly panels: ShaderMaterial;
  private readonly hull: MeshBasicMaterial;

  private readonly face = new Group();
  private readonly faceMats: { readonly mat: MeshBasicMaterial; readonly alpha: number }[] = [];
  private readonly lids: Group[] = [];
  private readonly pupils: Group[] = [];
  private readonly happy: Mesh[] = [];
  private readonly smileMat = flat(DEEP);
  private readonly smile = new Mesh(SMILE, this.smileMat);
  private readonly gaspMat = flat(DEEP);
  private readonly gasp = new Mesh(GASP, this.gaspMat);
  private readonly sweatMat = flat(DROP, 0);
  private readonly sweat = new Mesh(SWEAT, this.sweatMat);
  private readonly here = new Vector3();

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

  /** 평소에 눈이 향하는 곳. 판의 문이다. */
  private gaze: Vec3 | null = null;
  private opened = 1;
  private clock = Math.random() * 10;
  private blinkAt = 1.5 + Math.random() * 3;
  private blinkT = 1;
  private lookX = 0;
  private lookY = 0;
  /** 구르거나 튕기는 중인 정도(0~1). 그동안 얼굴이 앞으로 나와 튀어나온 모서리에 안 먹힌다. */
  private float = 0;

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

    this.body.add(this.mesh);
    this.root.add(this.body, this.face);
    this.buildFace();
  }

  private buildFace(): void {
    const add = (mesh: Mesh, mat: MeshBasicMaterial, alpha = 1): Mesh => {
      this.faceMats.push({ mat, alpha });
      return mesh;
    };
    for (const side of [-1, 1]) {
      const lid = new Group();
      lid.position.set(side * EYE_GAP, EYE_Y, 0);
      const whiteMat = flat(WHITE);
      lid.add(add(new Mesh(EYE_WHITE, whiteMat), whiteMat));
      const rimMat = flat(DEEP);
      const rim = add(new Mesh(EYE_RIM, rimMat), rimMat);
      rim.position.z = 0.001;
      lid.add(rim);
      const pupil = new Group();
      pupil.position.z = 0.002;
      const pupilMat = flat(DEEP);
      pupil.add(add(new Mesh(PUPIL, pupilMat), pupilMat));
      const glintMat = flat(WHITE);
      const glint = add(new Mesh(GLINT, glintMat), glintMat);
      glint.position.set(0.018, 0.02, 0.001);
      pupil.add(glint);
      lid.add(pupil);
      this.face.add(lid);
      this.lids.push(lid);
      this.pupils.push(pupil);

      const happyMat = flat(DEEP);
      const happy = add(new Mesh(HAPPY, happyMat), happyMat);
      happy.position.set(side * EYE_GAP, EYE_Y - 0.02, 0.003);
      happy.visible = false;
      this.face.add(happy);
      this.happy.push(happy);

      const cheekMat = flat(BLUSH, 0.42);
      const cheek = add(new Mesh(CHEEK, cheekMat), cheekMat, 0.42);
      cheek.position.set(side * 0.25, -0.08, -0.001);
      this.face.add(cheek);
    }
    add(this.smile, this.smileMat);
    this.smile.position.set(0, -0.08, 0.002);
    this.face.add(this.smile);
    add(this.gasp, this.gaspMat);
    this.gasp.position.set(0, -0.12, 0.002);
    this.gasp.visible = false;
    this.face.add(this.gasp);
    this.face.add(this.sweat);
  }

  /** 지금 서 있는 칸 */
  get position(): Vec3 {
    return this.cell;
  }

  /** 문에 들어가 판에서 빠졌는지 */
  get gone(): boolean {
    return this.sunk;
  }

  /** 고리 반쪽이 뜨는 자리. 머리 위, 밑에 매달린 큐브면 발밑이다. */
  badgeAt(out: Vector3, lift: number): Vector3 {
    const at = this.body.position;
    return out.set(at.x, at.y + this.up * lift, at.z);
  }

  /** 교대 판에서 지금 조종 중인지. 아닌 큐브는 색을 빼고 졸린 눈을 한다. */
  setActive(on: boolean): void {
    this.dim = !on;
  }

  /** 평소에 눈으로 좇을 곳. 판의 문을 준다 — 문지기 눈과 서로 쳐다보게. */
  gazeAt(target: Vec3 | null): void {
    this.gaze = target;
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
    this.face.visible = false;
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
    this.face.visible = true;
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
      toward,
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

  update(dt: number, azimuth = 0): void {
    const anim = this.anim;
    this.clock += dt;

    if (anim?.kind === 'roll') {
      anim.t = clamp01(anim.t + (dt * 1000) / anim.ms);
      const e = smoothstep(anim.t);
      const at = anim.arm.clone().applyAxisAngle(anim.axis, anim.angle * e).add(anim.pivot);
      this.body.position.set(
        at.x + anim.slide.x * e,
        at.y + anim.slide.y * e,
        at.z + anim.slide.z * e,
      );
      this.body.quaternion.setFromAxisAngle(anim.axis, anim.angle * e);
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
      this.body.position.set(
        this.cell.x + anim.toward.x * HALF,
        this.cell.y + this.base,
        this.cell.z + anim.toward.z * HALF,
      );
      this.body.quaternion.setFromAxisAngle(anim.axis, refuseAngle(anim.t));
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
        this.face.visible = false;
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

    this.updateFace(dt, azimuth);
  }

  /**
   * 표정.
   * 평소엔 문을 쳐다보며 가끔 깜빡이고, 구를 땐 질끈 감고, 부딪히면 찡그리며 "o" 입에 식은땀,
   * 색이 바뀌면 눈이 동그래지고, 문에 들어갈 땐 웃는 눈. 조종 중이 아닌 몸은 졸린 눈이다.
   */
  private updateFace(dt: number, azimuth: number): void {
    if (!this.mesh.visible) return;
    const anim = this.anim;
    const sin = Math.sin(azimuth);
    const cos = Math.cos(azimuth);

    // 가만히 있을 땐 앞면에 붙인다. 구르거나 시점이 돌아 모서리가 카메라 쪽으로 튀어나오면
    // 그만큼 앞으로 띄운다 — 얼굴이 제 몸 모서리에 먹히지 않게.
    const moving = anim?.kind === 'roll' || anim?.kind === 'refuse';
    this.float += ((moving ? 1 : 0) - this.float) * (1 - Math.exp(-dt * 20));
    const turning = Math.abs(Math.sin(2 * azimuth));
    const out = HALF + 0.02 + Math.max(this.float * 0.19, turning * 0.2);
    this.mesh.getWorldPosition(this.here);
    this.face.position.set(this.here.x + sin * out, this.here.y, this.here.z + cos * out);
    this.face.rotation.set(0, azimuth, 0);
    const s = this.mesh.scale;
    this.face.scale.set(s.x, s.y * this.up, 1);

    const refusing = anim?.kind === 'refuse' && anim.t > PUSH * 0.6 && anim.t < 0.8;
    const rolling = anim?.kind === 'roll';
    const sinking = anim?.kind === 'sink';
    const painting = this.blend < 1;

    // 눈 뜬 정도
    let want = 1;
    if (this.dim) want = 0.14;
    if (painting) want = 1.3;
    if (rolling) want = 0.32;
    if (refusing) want = 0.12;
    this.opened += (want - this.opened) * (1 - Math.exp(-dt * (want > this.opened ? 18 : 22)));
    if (this.clock > this.blinkAt) {
      this.blinkT = 0;
      this.blinkAt = this.clock + 2 + Math.random() * 3.5;
    }
    this.blinkT = Math.min(1, this.blinkT + dt / 0.16);
    const blink = 1 - Math.sin(Math.PI * this.blinkT) * 0.9;
    for (const lid of this.lids) {
      lid.visible = !sinking;
      lid.scale.set(1, Math.max(0.08, this.opened * blink), 1);
    }
    for (const h of this.happy) h.visible = sinking;

    // 시선. 구를 땐 가는 쪽, 평소엔 문 쪽.
    let tx = 0;
    let ty = 0;
    if (anim?.kind === 'roll' || anim?.kind === 'refuse') {
      tx = Math.sign(anim.toward.x * cos - anim.toward.z * sin) * 0.028;
    } else if (this.gaze) {
      const dx = this.gaze.x - this.here.x;
      const dz = this.gaze.z - this.here.z;
      const across = dx * cos - dz * sin;
      const upward = (this.gaze.y + 0.6 - this.here.y) * this.up;
      const len = Math.hypot(across, upward) + 1.2;
      tx = (across / len) * 0.03;
      ty = (upward / len) * 0.025;
    }
    const k = 1 - Math.exp(-dt * 12);
    this.lookX += (tx - this.lookX) * k;
    this.lookY += (ty - this.lookY) * k;
    for (const p of this.pupils) p.position.set(this.lookX, this.lookY, 0.002);

    // 입
    this.smile.visible = !refusing;
    this.gasp.visible = refusing;
    this.smile.scale.setScalar(sinking ? 1.35 : 1);

    // 식은땀은 부딪힌 반대쪽 이마에서 흘러내린다
    if (anim?.kind === 'refuse' && anim.t > PUSH) {
      const p = (anim.t - PUSH) / (1 - PUSH);
      const away = -Math.sign(anim.toward.x * cos - anim.toward.z * sin) || 1;
      this.sweat.position.set(away * 0.3, 0.2 - p * 0.16, 0.004);
      this.sweatMat.opacity = Math.sin(Math.PI * Math.min(1, p * 1.3)) * this.skin.uniforms['uOpacity']!.value;
    } else {
      this.sweatMat.opacity = 0;
    }
  }

  private fade(a: number): void {
    this.skin.uniforms['uOpacity']!.value = a;
    this.panels.uniforms['uOpacity']!.value = a;
    this.hull.opacity = a;
    for (const { mat, alpha } of this.faceMats) mat.opacity = alpha * a;
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
    this.body.position.set(this.cell.x, this.cell.y + this.base + this.up * HALF, this.cell.z);
    this.body.quaternion.identity();
    this.mesh.position.set(0, 0, 0);
    this.mesh.quaternion.copy(this.spin);
  }
}

/** 매 프레임 목표색을 담아 두는 그릇들. 프레임마다 Color 를 새로 만들지 않으려고 하나씩만 쓴다. */
const MID_TONE = new Color();
const LIGHT_TONE = new Color();
const DARK_TONE = new Color();
const EDGE_TONE = new Color();
