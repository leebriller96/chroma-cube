import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Shape,
  ShapeGeometry,
} from 'three';
import type { Stage } from '../core/stage';
import { layout } from '../core/game';
import type { Solid, Tile, Vec3, ViewIndex } from '../core/types';
import { DEEP, GOLD, PALETTE, STONE, UNPRINTED, type Ink } from './palette';
import { slabTexture } from './textures';
import { clamp01, easeInOutCubic, easeOutCubic } from './easing';
import { SLAB_H, SLAB_MID } from './metrics';

/** 발판 한 칸. 윗면이 y=0 이고 칸 높이를 거의 다 채운다. 옆면의 명암은 텍스처에 그려져 있다. */
const SLAB = new BoxGeometry(0.96, SLAB_H, 0.96);
/** 스위치 자국 */
const BUTTON = new CircleGeometry(0.15, 24);
const BUTTON_RING = new RingGeometry(0.19, 0.225, 24);
/** 교대 칸 자국. 위아래로 갈라지는 두 삼각형이다. */
const ARROW = new CircleGeometry(0.11, 3);

/** 문 안쪽 구멍의 반너비와 높이 */
const GATE_W = 0.46;
const GATE_H = 1.12;
/**
 * 고리. 이 게임에서 '문이 열린다'를 뜻하는 단 하나의 기호다.
 * 흩어진 조각으로도, 두 몸이 반씩 나눠 이고 다니는 반쪽으로도, 문에 걸린 봉인으로도 나온다.
 * 그래서 어디서 보든 크기가 같아야 한다.
 */
export const RING_R = 0.3;
export const RING_T = 0.075;
/** 문짝이 안쪽으로 젖혀지는 각도. 90°를 넘겨야 활짝 열린 것으로 읽힌다. */
const SWING = 1.66;

/** 몸통 네 옆면의 [x, z, y축 회전] */
const SIDES: readonly (readonly [number, number, number])[] = [
  [0, 0.482, 0],
  [0, -0.482, Math.PI],
  [0.482, 0, Math.PI / 2],
  [-0.482, 0, -Math.PI / 2],
];

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

const GATE_VOID = new ShapeGeometry(archShape(GATE_W, GATE_H));
const GATE_FRAME = new ShapeGeometry(archShape(GATE_W + 0.12, GATE_H + 0.16));
const GATE_LEAF = new ShapeGeometry(leafShape(GATE_W - 0.012, GATE_H - 0.012));
/** 문짝에 반씩 새겨진 봉인. 닫혀 있을 때만 온전한 고리로 보인다. */
const SEAL_HALF = new RingGeometry(RING_R - RING_T, RING_R, 40, 1, Math.PI / 2, Math.PI);

/** 잠금 상태에 따라 색이 갈리는 부분 */
interface Lit {
  readonly mat: MeshBasicMaterial;
  readonly on: Color;
  readonly off: Color;
}

interface TileView {
  readonly tile: Tile;
  readonly cell: Group;
  /** 명암 텍스처가 걸린 옆면들. 튕겼을 때 잠깐 밝아진다. */
  readonly skin: MeshBasicMaterial[];
  /** 그림자 칸이 색을 갈아입을 때 map 을 바꿔 끼울 면들 */
  readonly banded: MeshBasicMaterial[];
  readonly flats: { readonly mat: MeshBasicMaterial; readonly hue: Color }[];
  readonly lit: Lit[];
  /** 카메라를 늘 마주 봐야 하는 것들 */
  readonly facing: Object3D[];
  /** 문짝. 열릴 때 경첩을 축으로 젖혀진다. */
  readonly leaves: { readonly hinge: Group; readonly dir: number }[];
  readonly ghost: boolean;
  flash: number;
  alive: number;
}

type Built = Omit<TileView, 'tile' | 'cell' | 'flash' | 'alive' | 'ghost'>;

const empty = (): Built => ({ skin: [], banded: [], flats: [], lit: [], facing: [], leaves: [] });

/** 스테이지 한 판의 발판 전부. 스테이지가 바뀌면 통째로 버린다. */
export class Board {
  readonly group = new Group();
  /** 문이 열리거나 닫히는 순간. 소리를 내려고 바깥으로 알린다. */
  onGate: ((open: boolean) => void) | null = null;

  private ghosts: ReadonlySet<Tile> = new Set();
  private readonly views: TileView[] = [];
  private readonly stage: Stage;
  private clock = 0;
  private aligned = true;
  /** 문이 열린 정도. 0 이면 꽉 닫혀 있다. */
  private swing = 1;

  constructor(stage: Stage) {
    this.stage = stage;
    const sigils = stage.tiles.filter((t) => t.kind === 'sigil');
    for (const tile of stage.tiles) {
      const nth = tile.kind === 'sigil' ? sigils.indexOf(tile) : 0;
      this.views.push(this.build(tile, nth, sigils.length));
    }
  }

  private build(tile: Tile, nth: number, of: number): TileView {
    const cell = new Group();
    cell.position.set(tile.pos.x, tile.pos.y, tile.pos.z);
    this.group.add(cell);
    const seed = { tile, cell, flash: 0, alive: tile.kind === 'ghost' ? 0 : 1, ghost: tile.kind === 'ghost' };
    if (tile.kind === 'sigil') return { ...seed, ...this.buildSigil(cell, nth, of) };
    if (tile.kind === 'goal') return { ...seed, ...this.buildGoal(tile, cell) };
    return { ...seed, ...this.buildFloor(tile, cell) };
  }

  /** 잉크 한 벌로 발판 여섯 면을 만든다. 옆면은 텍스처, 위아래는 단색. */
  private slabSkin(ink: Ink, under?: Ink): { all: MeshBasicMaterial[]; banded: MeshBasicMaterial[] } {
    const banded = [0, 1, 2, 3].map(() => new MeshBasicMaterial({ map: slabTexture(ink, under) }));
    const top = new MeshBasicMaterial({ color: ink.light.clone() });
    const bottom = new MeshBasicMaterial({ color: (under ?? ink).light.clone() });
    // BoxGeometry 의 면 순서는 +x, -x, +y, -y, +z, -z 다
    const all = [banded[0]!, banded[1]!, top, bottom, banded[2]!, banded[3]!];
    return { all, banded };
  }

  private addSlab(cell: Group, ink: Ink, under?: Ink): Built {
    const { all, banded } = this.slabSkin(ink, under);
    const slab = new Mesh(SLAB, all);
    slab.position.y = SLAB_MID;
    cell.add(slab);
    return { ...empty(), skin: all, banded };
  }

  private buildFloor(tile: Tile, cell: Group): Built {
    const ghost = tile.kind === 'ghost';
    const relay = tile.kind === 'relay';
    const isSwitch = tile.kind === 'switch';
    const ink: Ink = ghost ? UNPRINTED : relay || isSwitch ? STONE : PALETTE[tile.color ?? 'blue'];
    // 뒤집힌 세계가 있는 판이면 발판 아랫절반을 반대색으로 칠한다.
    // 밑에 매달린 큐브가 걷는 길이 겉에서 그대로 보이도록.
    const flip = this.stage.twoSided && !ghost && !relay && !isSwitch;
    const under = flip ? PALETTE[tile.color === 'red' ? 'blue' : 'red'] : undefined;

    const built = this.addSlab(cell, ink, under);
    if (ghost) {
      for (const m of built.skin) {
        m.transparent = true;
        m.opacity = 0.25;
      }
    }

    const flats: { mat: MeshBasicMaterial; hue: Color }[] = [];
    const stamp = (geo: CircleGeometry | RingGeometry, hue: Color, y: number, spin = 0): void => {
      for (const [x, z, ry] of SIDES) {
        const mat = new MeshBasicMaterial({ color: hue.clone(), side: DoubleSide });
        const face = new Mesh(geo, mat);
        face.position.set(x, y, z);
        face.rotation.set(0, ry, spin);
        cell.add(face);
        flats.push({ mat, hue: hue.clone() });
      }
    };
    if (isSwitch) {
      const paint = PALETTE[tile.color ?? 'blue'];
      stamp(BUTTON, paint.mid, SLAB_MID);
      stamp(BUTTON_RING, paint.dark, SLAB_MID);
    }
    if (relay) {
      // 위로 한 번, 아래로 한 번. 조종권이 발판 반대편으로 건너간다는 표시다.
      stamp(ARROW, DEEP, SLAB_MID + 0.19, Math.PI / 2);
      stamp(ARROW, DEEP, SLAB_MID - 0.19, -Math.PI / 2);
    }
    return { ...built, flats };
  }

  /**
   * 문. 발판 위에 아치가 서고, 그 안에 문짝 두 짝이 닫혀 있다.
   * 닫힌 문짝에는 봉인 고리가 반씩 새겨져 있어, 조건이 맞으면 고리가 금빛으로 켜지고
   * 문짝이 안쪽으로 젖혀지며 열린다 — 왜 못 들어갔는지, 언제 들어갈 수 있는지가 모양으로 보인다.
   * 밑에 매달린 큐브가 있는 판이면 발판 아래에도 거꾸로 하나 더 세운다.
   */
  private buildGoal(tile: Tile, cell: Group): Built {
    const ink = PALETTE[tile.color ?? 'blue'];
    const under = this.stage.twoSided ? PALETTE[tile.color === 'red' ? 'blue' : 'red'] : undefined;
    const built = this.addSlab(cell, ink, under);
    const lit: Lit[] = [];
    const facing: Object3D[] = [];
    const leaves: { hinge: Group; dir: number }[] = [];

    const gate = (flip: boolean): void => {
      const arch = new Group();
      arch.position.y = flip ? -SLAB_H : 0;
      arch.scale.y = flip ? -1 : 1;
      const face = flip ? (under ?? ink) : ink;

      const frame = new Mesh(GATE_FRAME, new MeshBasicMaterial({ color: GOLD.mid.clone(), side: DoubleSide }));
      frame.position.z = -0.37;
      arch.add(frame);

      const hole = new Mesh(GATE_VOID, new MeshBasicMaterial({ color: DEEP.clone(), side: DoubleSide, fog: false }));
      hole.position.z = -0.36;
      arch.add(hole);

      for (const dir of [-1, 1]) {
        const hinge = new Group();
        hinge.position.set(dir * (GATE_W - 0.012), 0, -0.35);
        const leaf = new Mesh(GATE_LEAF, new MeshBasicMaterial({ color: face.mid.clone(), side: DoubleSide }));
        // 왼쪽 짝은 경첩에서 오른쪽으로, 오른쪽 짝은 왼쪽으로 뻗어 가운데서 만난다
        leaf.scale.x = -dir;
        hinge.add(leaf);

        // 봉인은 문짝 한가운데 모서리에 반쪽씩 걸린다. 닫혀야 온전한 고리가 된다.
        const sealMat = new MeshBasicMaterial({ color: STONE.mid.clone(), side: DoubleSide });
        const seal = new Mesh(SEAL_HALF, sealMat);
        seal.position.set(GATE_W - 0.012, GATE_H * 0.42, 0.004);
        leaf.add(seal);
        lit.push({ mat: sealMat, on: GOLD.light.clone(), off: STONE.mid.clone() });

        arch.add(hinge);
        leaves.push({ hinge, dir });
      }

      const spin = new Group();
      spin.add(arch);
      cell.add(spin);
      facing.push(spin);
    };

    gate(false);
    if (this.stage.twoSided) gate(true);

    return { ...built, lit, facing, leaves };
  }

  /**
   * 고리 조각. 밟을 수 없다.
   * 조각들이 한 세로줄에 겹쳐 보이면 하나의 고리로 이어지고, 그때 문이 열린다.
   */
  private buildSigil(cell: Group, nth: number, of: number): Built {
    const gap = 0.2;
    const span = (Math.PI * 2) / Math.max(of, 1);
    const geo = new RingGeometry(RING_R - RING_T, RING_R, 40, 1, nth * span + gap / 2, span - gap);
    const mat = new MeshBasicMaterial({ color: STONE.mid.clone(), side: DoubleSide });
    const arc = new Mesh(geo, mat);
    arc.position.set(0, 0.5, 0);
    const spin = new Group();
    spin.add(arc);
    cell.add(spin);
    return {
      ...empty(),
      lit: [{ mat, on: GOLD.light.clone(), off: STONE.mid.clone() }],
      facing: [spin],
    };
  }

  /** 시점이 바뀌면 판을 다시 맞춘다. */
  sync(view: ViewIndex, open: boolean, ghosts: ReadonlySet<Tile>): void {
    if (open !== this.aligned) this.onGate?.(open);
    this.aligned = open;
    this.ghosts = ghosts;
    const live = new Map<Tile, Solid>();
    for (const solid of layout(this.stage, view)) live.set(solid.tile, solid);

    for (const v of this.views) {
      if (!v.ghost) continue;
      const solid = live.get(v.tile);
      if (!solid) continue;
      // 빌려 온 색으로 갈아입는다
      const map = slabTexture(PALETTE[solid.color]);
      for (const m of v.banded) m.map = map;
      const light = PALETTE[solid.color].light;
      for (const m of v.skin) if (!m.map) m.color.copy(light);
    }
  }

  /** 판이 처음 놓일 때는 애니메이션 없이 그 상태로 세워 둔다. */
  settle(): void {
    this.swing = this.aligned ? 1 : 0;
  }

  /** 색이 달라 못 밟은 칸을 한 번 밝힌다 */
  flash(pos: Vec3): void {
    const hit = this.views.find(
      (v) => v.tile.pos.x === pos.x && v.tile.pos.y === pos.y && v.tile.pos.z === pos.z,
    );
    if (hit) hit.flash = 1;
  }

  update(dt: number, azimuth: number): void {
    this.clock += dt;
    const beat = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
    // 문은 봉인이 켜진 뒤에 열려야 순서가 읽힌다. 그래서 조금 느리게 따라간다.
    this.swing += ((this.aligned ? 1 : 0) - this.swing) * (1 - Math.exp(-dt * 4.2));
    const open = easeInOutCubic(clamp01(this.swing));

    for (const v of this.views) {
      // 문과 고리는 늘 카메라를 마주 본다. 어느 쪽에서 봐도 같은 문으로 읽히도록.
      for (const node of v.facing) node.rotation.y = azimuth;
      // 두 짝 다 안쪽(카메라 반대쪽)으로 젖혀진다
      for (const leaf of v.leaves) leaf.hinge.rotation.y = -leaf.dir * SWING * open;

      if (v.flash > 0) v.flash = clamp01(v.flash - dt * 2.2);
      const bump = easeOutCubic(v.flash);

      // 텍스처가 걸린 면은 색을 1 위로 올려서 밝힌다
      for (const mat of v.skin) {
        if (mat.map) mat.color.setScalar(1 + bump * 1.1);
        if (v.ghost) {
          const want = 0.22 + 0.78 * v.alive;
          mat.opacity += (want - mat.opacity) * (1 - Math.exp(-dt * 8));
        }
      }
      if (v.ghost) v.alive += ((this.ghosts.has(v.tile) ? 1 : 0) - v.alive) * (1 - Math.exp(-dt * 8));

      for (const { mat, hue } of v.flats) mat.color.copy(hue).lerp(WHITE, bump * 0.5);

      for (const l of v.lit) {
        WANT.copy(this.aligned ? l.on : l.off);
        if (this.aligned) WANT.multiplyScalar(1 + beat * 0.16);
        l.mat.color.lerp(WANT, 1 - Math.exp(-dt * 6));
      }

      // 이어진 고리는 살짝 떠오른다
      if (v.tile.kind === 'sigil') {
        const node = v.facing[0];
        if (node) node.position.y = this.aligned ? Math.sin(this.clock * 1.8) * 0.05 + 0.06 : 0;
      }
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.group.clear();
  }
}

const WHITE = new Color(0xffffff);
/** 매 프레임 목표색을 담아 두는 그릇. 프레임마다 Color 를 새로 만들지 않으려고 하나만 쓴다. */
const WANT = new Color();
