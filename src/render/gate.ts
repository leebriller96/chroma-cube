import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferAttribute,
} from 'three';
import type { Vec3 } from '../core/types';
import { clamp01, easeOutCubic } from './easing';
import { RING_R, RING_T, SLAB_H } from './metrics';
import { css, DEEP, GOLD, STONE, type Ink } from './palette';
import { softDot } from './textures';

/*
 * 문. 발판 위에 선 작은 돌 문집이다.
 *
 *   - 두께 있는 상아색 아치, 금빛 주춧돌과 기둥머리. 안쪽은 어두운 터널이다
 *   - 판 색으로 칠한 두꺼운 문짝 두 짝. 봉인 고리가 반씩 새겨져 있어, 닫혀야 온전한 고리가 된다
 *   - 아치 꼭대기 쐐기돌에 **문지기 눈** 하나. 잠긴 문은 눈을 감고 잔다(z z z).
 *     열리면 번쩍 깨서 큐브를 눈으로 좇고, 가끔 깜빡인다. 큐브가 코앞에 오면 눈이 커지고 안쪽 빛이 밝아진다
 *   - 꼭대기 깃발은 이 문으로 들어갈 수 있는 색이다
 *   - 색이 안 맞거나 잠긴 채로 부딪히면 문짝이 덜컹거리고 눈이 놀라 뜬다
 *   - 큐브가 다 들어가면 문이 탕 닫히고, 눈은 흐뭇하게 가늘어지고, 쐐기돌에서 금빛이 튄다
 *
 * 조명이 없으므로 면마다 밝기를 다르게 칠해 입체를 만든다. 정면(2D)에서는 한 장의 문으로 읽히고,
 * 기울이거나 돌리면 두께와 터널이 드러난다.
 */

/** 문구멍의 반너비와 높이 */
const W = 0.33;
const H = 1.08;
/**
 * 아치 돌의 두께와 깊이. 터널이 문짝 너비보다 깊어야 활짝 젖혀진 문짝이 아치 밖으로 삐져나오지 않는다.
 * 그래서 문집 뒤쪽은 발판 뒤로 조금 넘어간다.
 */
const RIM = 0.12;
const DEPTH = 0.5;
/** 아치 뒷면과 앞면의 z. 문집은 발판 가운데보다 뒤에 선다 — 큐브는 그 앞에서 빨려 들어간다. */
const BACK = -0.68;
const FRONT = BACK + DEPTH;
/** 아치 바깥 꼭대기 */
const CROWN = H + RIM;
/** 문짝이 안쪽으로 젖혀지는 각도. 90°를 넘겨야 활짝 열린 것으로 읽힌다. */
const SWING = 1.66;
/** 큐브가 다 빨려 들어갈 즈음 문이 닫히기 시작한다 */
const SHUT_AT = 1.1;
const SHUT_MS = 0.42;
const FLAG_LEN = 0.3;

/** 아래가 평평하고 위가 둥근 문 모양 */
function archShape(w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(-w, 0);
  s.lineTo(-w, h - w);
  s.absarc(0, h - w, w, Math.PI, 0, true);
  s.lineTo(w, 0);
  s.closePath();
  return s;
}

/**
 * 문짝 한 짝. 경첩이 원점이고 몸은 +x 로 뻗는다.
 * 오른쪽 짝은 이걸 x 로 뒤집어 쓴다 — 그래서 봉인 고리도 저절로 반씩 나뉜다.
 */
function leafShape(w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0, h - w);
  s.absarc(w, h - w, w, Math.PI, Math.PI / 2, true);
  s.lineTo(w, 0);
  s.closePath();
  return s;
}

const ARCH = (() => {
  const outer = archShape(W + RIM, CROWN);
  outer.holes.push(archShape(W, H));
  return new ExtrudeGeometry(outer, { depth: DEPTH, bevelEnabled: false, curveSegments: 20 });
})();
const VOID = new ShapeGeometry(archShape(W, H), 20);
const LEAF = new ExtrudeGeometry(leafShape(W - 0.008, H - 0.008), {
  depth: 0.035,
  bevelEnabled: false,
  curveSegments: 12,
});
const SEAL_HALF = new RingGeometry(RING_R - RING_T, RING_R, 40, 1, Math.PI / 2, Math.PI);
const KNOB = new CircleGeometry(0.022, 12);
const BLOCK = new BoxGeometry(RIM + 0.06, 0.07, DEPTH + 0.05);
const KEY_H = 0.27;
const KEYSTONE = new BoxGeometry(0.27, KEY_H, 0.3);
const SCLERA = new CircleGeometry(0.092, 28);
const LASH = new RingGeometry(0.092, 0.112, 28);
const IRIS = new CircleGeometry(0.055, 20);
const PUPIL = new CircleGeometry(0.027, 16);
const GLINT = new CircleGeometry(0.014, 8);
const POLE = new BoxGeometry(0.02, 0.36, 0.02);
const FINIAL = new BoxGeometry(0.046, 0.046, 0.046);
const GLOW = new PlaneGeometry(W * 2.6, H * 1.25);
const SPILL = new PlaneGeometry(0.9, 0.5);
const SPARK = new PlaneGeometry(0.15, 0.15);
const QUAD = new PlaneGeometry(1, 1);

const EYE_WHITE = new Color(0xfffaf2);
const WANT = new Color();

let dot: CanvasTexture | null = null;
const glowDot = (): CanvasTexture => (dot ??= softDot(64, 0.1));

let zee: CanvasTexture | null = null;
/** 잠든 문 위로 피어오르는 z 한 글자 */
function zTexture(): CanvasTexture {
  if (zee) return zee;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.font = '800 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = css(DEEP);
    g.fillText('z', 32, 30);
  }
  zee = new CanvasTexture(canvas);
  zee.colorSpace = SRGBColorSpace;
  return zee;
}

const paint = (color: Color): MeshBasicMaterial => new MeshBasicMaterial({ color: color.clone(), side: DoubleSide });

/** 빛·글자처럼 겹쳐 그리는 반투명 면 */
const veil = (map: CanvasTexture, color: Color): MeshBasicMaterial =>
  new MeshBasicMaterial({ map, color: color.clone(), transparent: true, opacity: 0, depthWrite: false, fog: false });

/** 돌 상자 한 개. 면 순서는 +x, -x, +y, -y, +z, -z. 윗면이 가장 밝고 옆이 가장 어둡다. */
const boxSkin = (ink: Ink): MeshBasicMaterial[] => [
  paint(ink.dark),
  paint(ink.dark),
  paint(ink.light),
  paint(ink.dark),
  paint(ink.mid),
  paint(ink.mid),
];

/** 문을 '들이받았다'를 한 번 튀게 하는 곡선. 끝을 살짝 넘겼다가 돌아온다. */
const backOut = (t: number): number => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export interface GateContext {
  readonly clock: number;
  /** 문이 열린 정도 0~1. 판이 이미 부드럽게 따라간 값이다. */
  readonly open: number;
  /** 지금 문이 열려야 하는지 (봉인이 풀렸는지) */
  readonly aligned: boolean;
  readonly azimuth: number;
  /** 카메라가 따라가는 큐브. 눈이 이쪽을 본다. */
  readonly focus: Vec3 | null;
}

export class Gate {
  /** 늘 카메라를 마주 보는 뿌리 */
  readonly root = new Group();
  private readonly flipSign: number;
  private readonly leaves: { readonly hinge: Group; readonly dir: number }[] = [];
  private readonly seals: MeshBasicMaterial[] = [];
  private readonly crown = new Group();
  private readonly eye = new Group();
  private readonly iris = new Group();
  private readonly glow: MeshBasicMaterial;
  private readonly spill: MeshBasicMaterial;
  private readonly zs: { readonly mesh: Mesh; readonly mat: MeshBasicMaterial }[] = [];
  private readonly sparks: { readonly mesh: Mesh; readonly mat: MeshBasicMaterial; readonly angle: number; readonly reach: number }[] = [];
  private readonly flag: Mesh;
  private readonly flagBase: Float32Array;
  private readonly here = new Vector3();

  /** 눈을 뜬 정도. 0 이면 자고, 1 을 넘으면 놀라거나 신난 것이다. */
  private awake = 0;
  /** 들이받혀 덜컹거리는 세기 */
  private rattleT = 0;
  /** 큐브가 다 들어간 뒤 흐른 시간. 아직이면 음수. */
  private doneT = -1;
  private blinkAt = 2 + Math.random() * 3;
  private blinkT = 1;

  constructor(ink: Ink, flip = false) {
    const body = new Group();
    this.root.add(body);
    // 발판 밑에 매달린 큐브용 문은 발판 아래로 거꾸로 선다
    this.flipSign = flip ? -1 : 1;
    if (flip) {
      body.position.y = -SLAB_H;
      body.scale.y = -1;
    }

    // 아치. ExtrudeGeometry 는 앞뒤 면이 0번, 옆면(터널 벽 포함)이 1번 재질이다.
    const arch = new Mesh(ARCH, [paint(STONE.light), paint(STONE.dark)]);
    arch.position.z = BACK;
    body.add(arch);
    for (const dir of [-1, 1]) {
      for (const y of [0.035, H - W]) {
        const block = new Mesh(BLOCK, boxSkin(GOLD));
        block.position.set(dir * (W + RIM / 2), y, BACK + DEPTH / 2);
        body.add(block);
      }
    }

    // 터널 안쪽의 어둠, 열리면 번지는 빛, 문턱에 흘러나온 빛
    const back = new Mesh(VOID, new MeshBasicMaterial({ color: DEEP.clone(), side: DoubleSide, fog: false }));
    back.position.z = BACK + 0.004;
    body.add(back);
    this.glow = veil(glowDot(), GOLD.light);
    const glow = new Mesh(GLOW, this.glow);
    glow.position.set(0, H * 0.42, BACK + 0.012);
    body.add(glow);
    this.spill = veil(glowDot(), GOLD.light);
    const spill = new Mesh(SPILL, this.spill);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0, 0.006, FRONT + 0.18);
    body.add(spill);

    // 문짝 두 짝. 경첩은 터널 입구 바로 안쪽이라, 젖혀진 문짝이 터널 안에 쏙 들어간다.
    for (const dir of [-1, 1]) {
      const hinge = new Group();
      hinge.position.set(dir * (W - 0.008), 0, FRONT - 0.04);
      const leaf = new Mesh(LEAF, [paint(ink.mid), paint(ink.dark)]);
      // 왼쪽 짝은 경첩에서 오른쪽으로, 오른쪽 짝은 왼쪽으로 뻗어 가운데서 만난다
      leaf.scale.x = -dir;
      hinge.add(leaf);

      const sealMat = paint(STONE.mid);
      const seal = new Mesh(SEAL_HALF, sealMat);
      seal.position.set(W - 0.008, H * 0.42, 0.037);
      leaf.add(seal);
      this.seals.push(sealMat);

      const knob = new Mesh(KNOB, paint(GOLD.light));
      knob.position.set(W - 0.075, H * 0.24, 0.038);
      leaf.add(knob);

      body.add(hinge);
      this.leaves.push({ hinge, dir });
    }

    // 쐐기돌과 문지기 눈
    this.crown.position.y = CROWN - 0.03;
    body.add(this.crown);
    const key = new Mesh(KEYSTONE, boxSkin(STONE));
    key.position.z = FRONT - 0.11;
    this.crown.add(key);

    this.eye.position.z = FRONT + 0.042;
    this.crown.add(this.eye);
    this.eye.add(new Mesh(SCLERA, paint(EYE_WHITE)));
    const lash = new Mesh(LASH, paint(DEEP));
    lash.position.z = 0.001;
    this.eye.add(lash);
    this.iris.position.z = 0.002;
    this.eye.add(this.iris);
    this.iris.add(new Mesh(IRIS, paint(GOLD.mid)));
    const pupil = new Mesh(PUPIL, paint(DEEP));
    pupil.position.z = 0.001;
    this.iris.add(pupil);
    const glint = new Mesh(GLINT, paint(EYE_WHITE));
    glint.position.set(0.016, 0.019, 0.002);
    this.iris.add(glint);

    // 깃발. 들어갈 수 있는 색이다.
    const poleY = KEY_H / 2 + 0.18;
    const pole = new Mesh(POLE, paint(DEEP));
    pole.position.set(0, poleY, FRONT - 0.11);
    this.crown.add(pole);
    const finial = new Mesh(FINIAL, boxSkin(GOLD));
    finial.position.set(0, poleY + 0.2, FRONT - 0.11);
    this.crown.add(finial);

    const cloth = new PlaneGeometry(FLAG_LEN, 0.16, 12, 2);
    cloth.translate(FLAG_LEN / 2, 0, 0);
    const pos = cloth.attributes['position'] as BufferAttribute;
    // 끝으로 갈수록 좁아지는 삼각 깃발
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, pos.getY(i) * (1 - (pos.getX(i) / FLAG_LEN) * 0.82));
    this.flagBase = Float32Array.from(pos.array as ArrayLike<number>);
    this.flag = new Mesh(cloth, paint(ink.mid));
    this.flag.position.set(0.01, poleY + 0.1, FRONT - 0.11);
    this.crown.add(this.flag);

    // 잠든 문의 z z z
    for (let i = 0; i < 3; i += 1) {
      const mat = veil(zTexture(), EYE_WHITE);
      const mesh = new Mesh(QUAD, mat);
      this.crown.add(mesh);
      this.zs.push({ mesh, mat });
    }
    // 문이 닫힐 때 튀는 금빛
    for (let i = 0; i < 9; i += 1) {
      const mat = veil(glowDot(), GOLD.light);
      const mesh = new Mesh(SPARK, mat);
      this.crown.add(mesh);
      this.sparks.push({ mesh, mat, angle: (i / 9) * Math.PI * 2 + 0.3, reach: 0.3 + (i % 3) * 0.09 });
    }
  }

  /** 색이 안 맞거나 잠긴 채로 들이받혔다 */
  rattle(): void {
    this.rattleT = 1;
  }

  /** 큐브가 다 들어갔다. 조금 있다가 문을 닫는다. */
  celebrate(): void {
    if (this.doneT < 0) this.doneT = 0;
  }

  update(dt: number, ctx: GateContext): void {
    const { clock, aligned, azimuth, focus } = ctx;
    const done = this.doneT >= 0;
    this.root.rotation.y = azimuth;
    this.rattleT = clamp01(this.rattleT - dt * 1.7);
    if (done) this.doneT += dt;

    // 문짝. 다 들어가면 탕 닫히며 살짝 튕기고, 들이받히면 덜컹거린다.
    const shut = done ? backOut(clamp01((this.doneT - SHUT_AT) / SHUT_MS)) : 0;
    const open = ctx.open * (1 - shut);
    const shake = Math.sin(clock * 46) * this.rattleT * this.rattleT;
    for (const leaf of this.leaves) leaf.hinge.rotation.y = -leaf.dir * (SWING * open + shake * 0.13);
    this.crown.position.x = shake * 0.025;

    // 큐브가 어디 있는지. 눈은 그쪽을 보고, 가까울수록 들뜬다.
    let excite = 0;
    let lookX = 0;
    let lookY = 0;
    if (focus) {
      this.root.getWorldPosition(this.here);
      const dx = focus.x - this.here.x;
      const dz = focus.z - this.here.z;
      excite = clamp01(1.9 - Math.hypot(dx, focus.y - this.here.y, dz));
      // 문은 카메라를 마주 보므로, 화면 가로로 얼마나 떨어졌는지만 보면 된다
      const across = dx * Math.cos(azimuth) - dz * Math.sin(azimuth);
      const up = (focus.y + 0.45 - (this.here.y + CROWN * this.flipSign)) * this.flipSign;
      const len = Math.hypot(across, up) + 0.9;
      lookX = (across / len) * 0.03;
      lookY = (up / len) * 0.03;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.iris.position.x += (lookX - this.iris.position.x) * k;
    this.iris.position.y += (lookY - this.iris.position.y) * k;

    // 눈꺼풀. 잠긴 문은 자고, 열리면 깨고, 들이받히면 놀라 뜨고, 다 끝나면 흐뭇하게 가늘어진다.
    const want = done
      ? 0.34
      : this.rattleT > 0.05
        ? 1.3
        : aligned
          ? 1 + excite * 0.2
          : 0;
    this.awake += (want - this.awake) * (1 - Math.exp(-dt * (want > this.awake ? 16 : 4)));
    if (clock > this.blinkAt) {
      this.blinkT = 0;
      this.blinkAt = clock + 2.2 + Math.random() * 3.6;
    }
    this.blinkT = Math.min(1, this.blinkT + dt / 0.17);
    const blink = done ? 1 : 1 - Math.sin(Math.PI * this.blinkT) * 0.93;
    this.eye.scale.set(done ? 1.15 : 1, Math.max(0.08, this.awake * blink), 1);

    // 잠든 문 위로 z 가 하나씩 피어오른다. 깃발이 오른쪽으로 나부끼니 왼쪽으로.
    const sleep = aligned || done ? 0 : clamp01(1 - this.awake * 1.6);
    this.zs.forEach(({ mesh, mat }, i) => {
      const p = (clock * 0.42 + i / 3) % 1;
      mesh.position.set(-0.15 - p * 0.2 + Math.sin(p * 7 + i) * 0.02, 0.18 + p * 0.5, FRONT + 0.08);
      const s = 0.07 + p * 0.09;
      mesh.scale.set(s, s, 1);
      mat.opacity = Math.sin(Math.PI * p) * 0.9 * sleep;
    });

    // 안쪽 빛. 큐브가 다가오면 더 밝아진다.
    const beat = 0.5 + 0.5 * Math.sin(clock * 2.2);
    this.glow.opacity = open * (0.42 + 0.14 * beat + 0.4 * excite);
    this.spill.opacity = open * (0.3 + 0.35 * excite);

    // 봉인 고리는 풀리면 금빛
    WANT.copy(aligned ? GOLD.light : STONE.mid);
    for (const mat of this.seals) mat.color.lerp(WANT, 1 - Math.exp(-dt * 6));

    // 깃발은 늘 나부끼고, 들뜨거나 끝나면 더 세게 나부낀다
    const cloth = this.flag.geometry.attributes['position'] as BufferAttribute;
    const speed = 5.5 + 3.5 * excite + (done ? 5 : 0);
    for (let i = 0; i < cloth.count; i += 1) {
      const bx = this.flagBase[i * 3] as number;
      const u = bx / FLAG_LEN;
      const w = clock * speed - u * 6.5;
      cloth.setXYZ(
        i,
        bx,
        (this.flagBase[i * 3 + 1] as number) + Math.sin(w) * 0.03 * u,
        (this.flagBase[i * 3 + 2] as number) + Math.cos(w) * 0.035 * u,
      );
    }
    cloth.needsUpdate = true;

    // 문이 닫히는 순간 쐐기돌에서 금빛이 튄다
    const burst = done ? (this.doneT - SHUT_AT - SHUT_MS * 0.5) / 0.8 : -1;
    for (const s of this.sparks) {
      if (burst < 0 || burst > 1) {
        s.mat.opacity = 0;
        continue;
      }
      const r = easeOutCubic(burst) * s.reach;
      s.mesh.position.set(Math.cos(s.angle) * r, Math.sin(s.angle) * r, FRONT + 0.1);
      const size = 0.6 + (1 - burst) * 0.9;
      s.mesh.scale.set(size, size, 1);
      s.mat.opacity = 1 - burst;
    }
  }
}
