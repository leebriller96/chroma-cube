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
} from 'three';
import type { Stage } from '../core/stage';
import { layout } from '../core/game';
import { other, type Solid, type Tile, type Vec3, type ViewIndex } from '../core/types';
import { DEEP, GOLD, PALETTE, STONE, UNPRINTED, type Ink } from './palette';
import { slabTexture } from './textures';
import { clamp01, easeInOutCubic, easeOutCubic } from './easing';
import { RING_R, RING_T, SLAB_H, SLAB_MID } from './metrics';
import { Gate } from './gate';

export { RING_R, RING_T };

/** 발판 한 칸. 윗면이 y=0 이고 칸 높이를 거의 다 채운다. 옆면의 명암은 텍스처에 그려져 있다. */
const SLAB = new BoxGeometry(0.96, SLAB_H, 0.96);
/** 스위치 자국 */
const BUTTON = new CircleGeometry(0.15, 24);
const BUTTON_RING = new RingGeometry(0.19, 0.225, 24);
/** 교대 칸 자국. 위아래로 갈라지는 두 삼각형이다. */
const ARROW = new CircleGeometry(0.11, 3);
/**
 * 뒤집히는 칸의 표식. 색 경계 한가운데에 박힌 상아색 메달과, 그 위에서 서로를 쫓는 화살표 둘.
 * 위아래 반반 칠해진 발판은 교대 판의 안 뒤집히는 칸에도 있어서, 색만으로는 둘을 못 가른다.
 * "돈다"는 뜻은 이 표식 하나가 맡는다.
 */
const TURN_DISC = new CircleGeometry(0.24, 32);
const TURN_R = 0.15;
const TURN_ARC_FROM = 0.45;
const TURN_ARC_LEN = 2.15;
const TURN_ARC = new RingGeometry(TURN_R - 0.028, TURN_R + 0.028, 24, 1, TURN_ARC_FROM, TURN_ARC_LEN);
const TURN_HEAD = new CircleGeometry(0.068, 3);

/** 몸통 네 옆면의 [x, z, y축 회전] */
const SIDES: readonly (readonly [number, number, number])[] = [
  [0, 0.482, 0],
  [0, -0.482, Math.PI],
  [0.482, 0, Math.PI / 2],
  [-0.482, 0, -Math.PI / 2],
];

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
  /** 문 칸이면 그 위에 선 문집 (교대 판이면 발판 밑에 하나 더) */
  readonly gates: Gate[];
  /** 뒤집히는 칸이면 몸통을 매단 축. 여기를 돌려서 발판을 넘긴다. */
  readonly flip: Group | null;
  readonly ghost: boolean;
  flash: number;
  alive: number;
  /** 지금까지 넘어간 횟수와, 화면이 실제로 따라간 각도 */
  turns: number;
  spun: number;
}

type Built = Omit<TileView, 'tile' | 'cell' | 'flash' | 'alive' | 'ghost' | 'turns' | 'spun'>;

const empty = (): Built => ({
  skin: [],
  banded: [],
  flats: [],
  lit: [],
  facing: [],
  gates: [],
  flip: null,
});

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
    const seed = {
      tile,
      cell,
      flash: 0,
      alive: tile.kind === 'ghost' ? 0 : 1,
      ghost: tile.kind === 'ghost',
      turns: 0,
      spun: 0,
    };
    if (tile.kind === 'flip') return { ...seed, ...this.buildFlip(tile, cell) };
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
   * 뒤집히는 칸. 위아래가 반대색으로 칠해진 판때기 한 장이다.
   * 밟고 떠나면 제자리에서 180° 넘어가고, 그러면 아랫면이 올라와 색이 바뀐다 —
   * 색이 왜 바뀌는지를 설명할 필요가 없다. 넘어가는 걸 그냥 보면 되니까.
   *
   * 축을 카메라 쪽으로 돌려 두어서, 어느 시점에서 보든 앞으로 넘어오는 것으로 읽힌다.
   * 몸통이 정사각이고 옆면 넷이 같은 무늬라 축을 돌려도 가만히 있을 때의 모습은 그대로다.
   *
   * 앞뒤 면에 회전 표식을 붙인다. 넘어가면 뒷면이 앞으로 오므로 표식도 두 장이다.
   */
  private buildFlip(tile: Tile, cell: Group): Built {
    const face = PALETTE[tile.color ?? 'blue'];
    const back = PALETTE[other(tile.color ?? 'blue')];
    const { all, banded } = this.slabSkin(face, back);

    const slab = new Mesh(SLAB, all);
    const pivot = new Group();
    pivot.position.y = SLAB_MID;
    pivot.add(slab);

    const flats: { mat: MeshBasicMaterial; hue: Color }[] = [];
    const paint = (geo: CircleGeometry | RingGeometry, hue: Color, parent: Group): Mesh => {
      const mat = new MeshBasicMaterial({ color: hue.clone(), side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      parent.add(mesh);
      flats.push({ mat, hue: hue.clone() });
      return mesh;
    };
    for (const [z, ry] of [[0.483, 0], [-0.483, Math.PI]] as const) {
      const medal = new Group();
      medal.position.z = z;
      medal.rotation.y = ry;
      pivot.add(medal);
      paint(TURN_DISC, STONE.light, medal);
      for (const half of [0, Math.PI]) {
        const arc = paint(TURN_ARC, DEEP, medal);
        arc.rotation.z = half;
        arc.position.z = 0.002;
        // 화살촉은 호가 끝나는 자리에서 도는 방향(반시계)을 가리킨다
        const end = TURN_ARC_FROM + TURN_ARC_LEN + half;
        const head = paint(TURN_HEAD, DEEP, medal);
        head.position.set(TURN_R * Math.cos(end), TURN_R * Math.sin(end), 0.003);
        head.rotation.z = end + Math.PI / 2;
      }
    }

    const facing = new Group();
    facing.add(pivot);
    cell.add(facing);

    return { ...empty(), skin: all, banded, flats, facing: [facing], flip: pivot };
  }

  /**
   * 문. 발판 위에 문집이 선다 (모양과 표정은 gate.ts).
   * 봉인이 풀리면 문짝이 안쪽으로 젖혀지며 열린다 — 왜 못 들어갔는지, 언제 들어갈 수 있는지가 모양으로 보인다.
   * 밑에 매달린 큐브가 있는 판이면 발판 아래에도 거꾸로 하나 더 세운다.
   */
  private buildGoal(tile: Tile, cell: Group): Built {
    const ink = PALETTE[tile.color ?? 'blue'];
    const under = this.stage.twoSided ? PALETTE[tile.color === 'red' ? 'blue' : 'red'] : undefined;
    const built = this.addSlab(cell, ink, under);
    const gates = [new Gate(ink)];
    if (under) gates.push(new Gate(under, true));
    for (const gate of gates) cell.add(gate.root);
    return { ...built, gates };
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
  sync(view: ViewIndex, open: boolean, ghosts: ReadonlySet<Tile>, flipped: number): void {
    if (open !== this.aligned) this.onGate?.(open);
    this.aligned = open;
    this.ghosts = ghosts;
    const live = new Map<Tile, Solid>();
    for (const solid of layout(this.stage, view, flipped)) live.set(solid.tile, solid);

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

  /** 큐브가 떠난 칸을 한 번 넘긴다. 아랫면이 올라오면서 색이 반대로 바뀐다. */
  turnOver(pos: Vec3): void {
    const hit = this.at(pos);
    if (hit?.flip) hit.turns += 1;
  }

  /** 되돌리기로 한 수 전의 판을 되살릴 때. 뒤집힌 칸을 넘어가는 모습 없이 그 상태로 놓는다. */
  placeFlips(flipped: number): void {
    for (const v of this.views) {
      if (!v.flip || v.tile.flipBit < 0) continue;
      v.turns = (flipped >> v.tile.flipBit) & 1;
      v.spun = v.turns * Math.PI;
      v.flip.rotation.x = v.spun;
    }
  }

  private at(pos: Vec3): TileView | undefined {
    return this.views.find(
      (v) => v.tile.pos.x === pos.x && v.tile.pos.y === pos.y && v.tile.pos.z === pos.z,
    );
  }

  /** 색이 달라 못 밟은 칸을 한 번 밝힌다 */
  flash(pos: Vec3): void {
    const hit = this.at(pos);
    if (!hit) return;
    hit.flash = 1;
    // 문을 들이받았으면 문이 덜컹거린다
    for (const gate of hit.gates) gate.rattle();
  }

  /** 큐브가 모두 문에 들어갔다. 문이 닫히며 한바탕 기뻐한다. */
  celebrate(): void {
    for (const v of this.views) for (const gate of v.gates) gate.celebrate();
  }

  update(dt: number, azimuth: number, focus: Vec3 | null = null): void {
    this.clock += dt;
    const beat = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
    // 문은 봉인이 켜진 뒤에 열려야 순서가 읽힌다. 그래서 조금 느리게 따라간다.
    this.swing += ((this.aligned ? 1 : 0) - this.swing) * (1 - Math.exp(-dt * 4.2));
    const open = easeInOutCubic(clamp01(this.swing));

    for (const v of this.views) {
      // 문과 고리는 늘 카메라를 마주 본다. 어느 쪽에서 봐도 같은 문으로 읽히도록.
      for (const node of v.facing) node.rotation.y = azimuth;
      for (const gate of v.gates) {
        gate.update(dt, { clock: this.clock, open, aligned: this.aligned, azimuth, focus });
      }

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

      // 넘어가는 발판. 목표 각도로 빠르게 붙었다가 잦아든다.
      if (v.flip) {
        const want = v.turns * Math.PI;
        v.spun += (want - v.spun) * (1 - Math.exp(-dt * 9));
        v.flip.rotation.x = v.spun;
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
