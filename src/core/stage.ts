import type { ColorId, Side, Tile, TileKind, Vec3, ViewIndex } from './types';
import { seenFrom, vec } from './types';

/**
 * 스테이지는 글자 지도로 적는다. 한 칸은 두 글자다.
 *
 *   ..  빈 공간
 *   b.  파란 땅        r.  빨간 땅
 *   b!  파랑 스위치    r!  빨강 스위치   (색과 무관하게 밟히고, 밟으면 큐브가 그 색이 된다)
 *   b*  파란 문        r*  빨간 문
 *   .?  그림자 칸      (제 색이 없다. 같은 세로줄에 실체가 있어야 살아나고 그 색을 빌린다)
 *   .#  고리 조각      (밟을 수 없다. 전부 한 줄에 겹쳐 보이면 고리가 이어져 문이 열린다)
 *   .~  교대 칸        (색과 무관하게 밟히고, 밟으면 조종권이 반대편 큐브로 넘어간다)
 *
 * 한 줄이 깊이 한 겹이다. 첫 줄이 카메라에서 가장 가까운 앞 겹(z=0),
 * 그다음 줄이 한 겹 뒤(z=-1) 다. 열은 x, 즉 화면 가로다.
 * view 0 에서는 앞 겹이 뒤 겹을 가리므로, 뒤 겹에 뭘 숨겨 두는 것이 퍼즐이 된다.
 * floors 로 층을 쌓으면 같은 지도를 높이별로 겹쳐 세운다.
 */
export interface StageSpec {
  readonly name: string;
  readonly hint: string;
  /** y=0 층만 쓸 때의 짧은 표기 */
  readonly rows?: readonly string[];
  /** 층을 쌓을 때. y 가 클수록 위다. */
  readonly floors?: readonly { readonly y: number; readonly rows: readonly string[] }[];
  /** 큐브가 시작하는 [행, 열] 또는 [행, 열, 높이] 들. 둘 이상이면 큐브가 여럿이다. */
  readonly start: readonly (readonly number[])[];
  /** 하나면 모든 큐브가 그 색, 배열이면 큐브마다 따로 */
  readonly startColor: ColorId | readonly ColorId[];
  /** 큐브가 붙는 면. under 면 발판 밑에 거꾸로 매달려 시작한다. */
  readonly startSide?: Side | readonly Side[];
  readonly startView?: ViewIndex;
}

export interface Stage {
  readonly name: string;
  readonly hint: string;
  readonly tiles: readonly Tile[];
  readonly starts: readonly Vec3[];
  readonly startColors: readonly ColorId[];
  readonly startSides: readonly Side[];
  readonly startView: ViewIndex;
  /** 지도의 크기. 카메라를 가운데 놓는 데만 쓴다. width = 가로, depth = 겹의 수 */
  readonly width: number;
  readonly depth: number;
  /** 층의 아래위 끝. 카메라가 담을 범위를 잡는 데 쓴다. */
  readonly low: number;
  readonly high: number;
  /** 고리 조각이 하나라도 있으면 문이 잠겨 있다. */
  readonly sealed: boolean;
  /** 교대 칸이 있으면 한 번에 한 큐브만 움직인다. */
  readonly relay: boolean;
  /** 밑면에 매달린 큐브가 있으면 발판 아래쪽도 반대색으로 칠해야 한다. */
  readonly twoSided: boolean;
}

const COLORS: Readonly<Record<string, ColorId | null>> = { b: 'blue', r: 'red', '.': null };
const KINDS: Readonly<Record<string, TileKind>> = {
  '.': 'floor',
  '!': 'switch',
  '*': 'goal',
  '?': 'ghost',
  '#': 'sigil',
  '~': 'relay',
};
/** 색이 필요 없는 종류 */
const COLORLESS: ReadonlySet<TileKind> = new Set<TileKind>(['ghost', 'sigil', 'relay']);

/** 지도의 n번째 줄이 놓이는 z. 첫 줄이 0, 뒤로 갈수록 작아진다. (-0 을 피한다) */
const backward = (row: number): number => (row === 0 ? 0 : -row);

export function parseStage(spec: StageSpec): Stage {
  const floors = spec.floors ?? [{ y: 0, rows: spec.rows ?? [] }];
  const tiles: Tile[] = [];
  let width = 0;
  let depth = 0;

  for (const floor of floors) {
    const grid = floor.rows.map((row) => row.trim().split(/\s+/));
    const w = grid[0]?.length ?? 0;
    if (w === 0) throw new Error(`스테이지 "${spec.name}" 의 ${floor.y}층이 비어 있다`);
    width = Math.max(width, w);
    depth = Math.max(depth, grid.length);

    grid.forEach((cells, row) => {
      if (cells.length !== w) {
        throw new Error(`스테이지 "${spec.name}" ${floor.y}층 ${row}행 길이가 ${w} 가 아니다`);
      }
      cells.forEach((cell, x) => {
        if (cell === '..') return;
        const color = COLORS[cell[0] ?? ''];
        const kind = KINDS[cell[1] ?? ''];
        if (color === undefined || !kind) {
          throw new Error(`스테이지 "${spec.name}" 의 ${row}행 ${x}열에 모르는 칸 "${cell}" 이 있다`);
        }
        if (COLORLESS.has(kind) !== (color === null)) {
          throw new Error(`스테이지 "${spec.name}" 의 "${cell}" 은 색이 ${color ? '없어야' : '있어야'} 한다`);
        }
        tiles.push({ pos: vec(x, floor.y, backward(row)), color, kind });
      });
    });
  }

  const pick = <T,>(v: T | readonly T[], i: number, fallback: T): T =>
    Array.isArray(v) ? ((v[i] ?? v[0] ?? fallback) as T) : ((v ?? fallback) as T);
  const colors = spec.start.map((_, i) => pick(spec.startColor, i, 'blue' as ColorId));
  const sides = spec.start.map((_, i) => pick(spec.startSide ?? 'top', i, 'top' as Side));

  const starts = spec.start.map((cell, i) => {
    const [row = 0, col = 0, y = 0] = cell;
    const at = vec(col, y, backward(row));
    const under = tiles.find((t) => t.pos.x === at.x && t.pos.y === at.y && t.pos.z === at.z);
    if (!under) throw new Error(`스테이지 "${spec.name}" 의 시작 칸이 비어 있다`);
    const facing = under.color === null ? null : seenFrom(under.color, sides[i] ?? 'top');
    if (under.kind !== 'switch' && facing !== null && facing !== colors[i]) {
      throw new Error(`스테이지 "${spec.name}" 의 시작 칸 색이 큐브 색과 다르다`);
    }
    return at;
  });
  if (starts.length === 0) throw new Error(`스테이지 "${spec.name}" 에 시작 칸이 없다`);

  return {
    name: spec.name,
    hint: spec.hint,
    tiles,
    starts,
    startColors: colors,
    startSides: sides,
    startView: spec.startView ?? 0,
    width,
    depth,
    low: Math.min(...tiles.map((t) => t.pos.y)),
    high: Math.max(...tiles.map((t) => t.pos.y)),
    sealed: tiles.some((t) => t.kind === 'sigil'),
    relay: tiles.some((t) => t.kind === 'relay'),
    twoSided: sides.includes('under'),
  };
}
