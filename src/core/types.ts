/** 큐브와 땅이 가질 수 있는 색. 늘리려면 여기만 늘리면 된다. */
export type ColorId = 'blue' | 'red';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * floor  : 색이 같아야만 밟을 수 있는 보통 땅
 * switch : 색과 무관하게 밟히고, 밟는 순간 큐브를 자기 색으로 물들인다
 * goal   : 밟으면 큐브가 문 안으로 빨려 들어간다. 색 규칙은 floor 와 같다
 * ghost  : 제 색이 없는 그림자 칸. 지금 시점에서 같은 세로줄에 실체가 있어야
 *          살아나고, 그 실체의 색을 그대로 빌려 쓴다
 * sigil  : 밟을 수 없는 고리 조각. 전부 한 세로줄에 겹쳐 보이면 고리가 이어지고 문이 열린다
 * relay  : 밟으면 조종권이 발판 반대쪽 큐브로 넘어간다. 색과 무관하게 밟힌다
 */
export type TileKind = 'floor' | 'switch' | 'goal' | 'ghost' | 'sigil' | 'relay';

/** 지도에 적힌 칸. 색이 없는 종류(ghost, sigil, relay)는 color 가 null 이다. */
export interface Tile {
  readonly pos: Vec3;
  readonly color: ColorId | null;
  readonly kind: TileKind;
}

/** 지금 이 시점에서 실제로 밟을 수 있게 놓여 있는 칸 */
export interface Solid {
  readonly pos: Vec3;
  readonly color: ColorId;
  readonly kind: 'floor' | 'switch' | 'goal' | 'relay';
  /** 어느 칸에서 나왔는지. 렌더러가 짝을 맞출 때 쓴다. */
  readonly tile: Tile;
}

/**
 * 큐브가 발판의 어느 면에 붙어 있는지.
 * under 는 발판 밑면에 거꾸로 매달린다. 발판의 아랫면은 윗면의 반대색이라,
 * 매달린 큐브에게는 같은 칸이 반대색으로 보인다.
 */
export type Side = 'top' | 'under';

/** 뒤집힌 쪽에서 본 색 */
export const seenFrom = (color: ColorId, side: Side): ColorId =>
  side === 'top' ? color : color === 'blue' ? 'red' : 'blue';

/** 카메라가 Y축 기준 view*90° 위치에 있다. */
export type ViewIndex = 0 | 1 | 2 | 3;

/** 시점 회전 방향. A = -1, D = +1 */
export type Turn = -1 | 1;

/** 화면 기준 좌우 이동. ← = -1, → = +1 */
export type Step = -1 | 1;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const eq = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
