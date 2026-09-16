import type { ColorId, Side, Solid, Step, Tile, Turn, Vec3, ViewIndex } from './types';
import { eq, other, seenFrom, vec } from './types';
import type { Stage } from './stage';
import { depthOf, rightOf, screenX, turnView } from './view';

/** 큐브 한 마리. 여럿이면 같은 입력을 함께 받는다. */
export interface Piece {
  readonly pos: Vec3;
  readonly color: ColorId;
  /** 딛고 선 발판의 윗면인지 아랫면인지. 아랫면은 반대색이라 걷는 길이 통째로 뒤집힌다. */
  readonly side: Side;
  /** 문에 들어가 판에서 빠졌는지 */
  readonly done: boolean;
}

export interface GameState {
  readonly stage: Stage;
  readonly pieces: readonly Piece[];
  readonly view: ViewIndex;
  /**
   * 지금 뒤집혀 있는 칸들. 칸마다 비트 하나다.
   * 밟고 떠난 칸은 뒤집혀 반대색이 되므로, 왔던 길로는 되돌아갈 수 없다.
   */
  readonly flipped: number;
  readonly moves: number;
  /** 교대 판에서 지금 조종하는 큐브. 그 외에는 전부 함께 움직인다. */
  readonly active: number;
  readonly cleared: boolean;
}

/** 못 간 이유. void = 칸이 없음, color = 색이 다름, sealed = 문이 잠김 */
export type RefuseReason = 'void' | 'color' | 'sealed' | 'apart' | 'cleared';

export interface Movement {
  readonly kind: 'move';
  readonly index: number;
  readonly from: Vec3;
  readonly to: Vec3;
  /** 화면 기준 이동 방향의 월드 단위벡터. 굴림 축을 여기서 뽑는다. */
  readonly toward: Vec3;
  readonly painted: ColorId | null;
  readonly entered: boolean;
  /** 떠나면서 이 칸을 뒤집어 놓았는지. 렌더러가 발판을 돌릴 때 쓴다. */
  readonly turned: boolean;
}

export interface Refusal {
  readonly kind: 'refuse';
  readonly index: number;
  readonly at: Vec3;
  readonly toward: Vec3;
  readonly reason: RefuseReason;
  /** 색이 안 맞아 못 밟은 칸. 번쩍이게 할 때 쓴다. */
  readonly blocked: Vec3 | null;
}

export type MoveOutcome = Movement | Refusal;

export const startOf = (stage: Stage): GameState => ({
  stage,
  pieces: stage.starts.map((pos, i) => ({
    pos,
    color: stage.startColors[i] ?? 'blue',
    side: stage.startSides[i] ?? 'top',
    done: false,
  })),
  view: stage.startView,
  flipped: 0,
  moves: 0,
  active: 0,
  cleared: false,
});

export function tileAt(stage: Stage, p: Vec3): Tile | undefined {
  return stage.tiles.find((t) => eq(t.pos, p));
}

/** 지금 이 칸의 윗면 색. 뒤집힌 칸은 적힌 색의 반대다. */
export function faceOf(tile: Tile, flipped: number): ColorId {
  const worn = tile.color as ColorId;
  const turned = tile.flipBit >= 0 && (flipped >> tile.flipBit) % 2 !== 0;
  return turned ? other(worn) : worn;
}

/**
 * 지금 시점에서 밟을 수 있게 놓인 칸 전부.
 * 그림자 칸은 여기서 같은 세로줄의 실체를 찾아 색을 빌리고, 못 찾으면 아예 빠진다.
 */
export function layout(stage: Stage, view: ViewIndex, flipped = 0): Solid[] {
  const solids: Solid[] = [];
  // 그림자 칸이 색을 빌릴 수 있는 실체들만 먼저 넣는다. 교대 칸은 제 색이 없어 빌려 줄 게 없다.
  for (const tile of stage.tiles) {
    if (tile.kind === 'flip') {
      solids.push({ pos: tile.pos, color: faceOf(tile, flipped), kind: 'floor', tile });
      continue;
    }
    if (tile.kind !== 'floor' && tile.kind !== 'switch' && tile.kind !== 'goal') continue;
    solids.push({ pos: tile.pos, color: tile.color as ColorId, kind: tile.kind, tile });
  }
  const real = solids.length;
  for (const tile of stage.tiles) {
    if (tile.kind !== 'relay') continue;
    solids.push({ pos: tile.pos, color: 'blue', kind: 'relay', tile });
  }
  for (const tile of stage.tiles) {
    if (tile.kind !== 'ghost') continue;
    const column = screenX(tile.pos, view);
    let backer: Solid | undefined;
    for (let i = 0; i < real; i += 1) {
      const s = solids[i] as Solid;
      if (screenX(s.pos, view) !== column) continue;
      if (!backer || depthOf(s.pos, view) < depthOf(backer.pos, view)) backer = s;
    }
    if (backer) solids.push({ pos: tile.pos, color: backer.color, kind: 'floor', tile });
  }
  return solids;
}

/** 조종권을 넘길 다음 큐브. 아직 안 빠진 큐브 중 다음 차례다. */
export function nextActive(pieces: readonly Piece[], from: number): number {
  for (let i = 1; i <= pieces.length; i += 1) {
    const at = (from + i) % pieces.length;
    if (!pieces[at]?.done) return at;
  }
  return from;
}

/**
 * 큐브가 여럿이면 한 칸에 포개져야 문이 열린다.
 * 색이 다른 큐브는 스위치 위에서만 포개질 수 있다 — 보통 칸은 색이 하나라 한쪽이 튕기니까.
 * 위아래로 맞물려도 포개진 것으로 친다 — 발판 하나를 사이에 두고 붙어 있는 셈이니까.
 */
export function merged(state: GameState): boolean {
  const live = state.pieces.filter((p) => !p.done);
  const head = live[0];
  if (!head) return true;
  return live.every((p) => eq(p.pos, head.pos));
}

/** 흩어진 고리 조각이 전부 한 세로줄에 겹쳐 보이면 고리가 이어지고 문이 열린다. */
export function unsealed(stage: Stage, view: ViewIndex): boolean {
  if (!stage.sealed) return true;
  const columns = stage.tiles.filter((t) => t.kind === 'sigil').map((t) => screenX(t.pos, view));
  return columns.every((c) => c === columns[0]);
}

/**
 * 이 게임의 심장. 화면은 2D 라서 깊이가 접힌다.
 * 화면 기준 한 칸 옆 세로줄에 겹쳐 보이는 칸들 중 카메라에 가장 가까운 하나가 실제 목적지다.
 * 뒤에 숨은 칸은 시점을 돌려 앞으로 끌어내야만 밟을 수 있다.
 *
 * 높이는 **화면에 보이는 그림만으로** 정한다. 옆 세로줄을 아래에서 위로 보면:
 *   - 큐브 머리 높이(한 층 위)에 칸이 있으면 그건 계단이다. 오른다.
 *     그 위(두 층 위)에도 칸이 있으면 두 칸 높이로 쌓인 벽이다. 못 간다.
 *     큐브 **제 머리 위**(제 세로줄 두 층 위)가 막혀 있어도 못 오른다 — 오르려면 그 자리를 지나 굴러야 하니까.
 *   - 머리 높이가 비어 있으면 같은 높이의 평지로 걷고, 그것도 없으면 한 층 내려선다.
 * 같은 높이를 먼저 찾으면 안 된다. 머리 높이의 칸 밑에 다른 겹의 평지가 깔려 있을 때
 * 계단처럼 보이는 칸을 두고 큐브가 그 칸 속으로 파고들어, 같은 그림이 어떤 때는 계단이고
 * 어떤 때는 벽이 되어 버린다.
 */
export function targetSolid(
  solids: readonly Solid[],
  from: Vec3,
  view: ViewIndex,
  step: Step,
): Solid | undefined {
  const here = screenX(from, view);
  const column = here + step;
  const frontAt = (y: number, col = column): Solid | undefined => {
    let front: Solid | undefined;
    for (const solid of solids) {
      if (solid.pos.y !== y) continue;
      if (screenX(solid.pos, view) !== col) continue;
      if (!front || depthOf(solid.pos, view) < depthOf(front.pos, view)) front = solid;
    }
    return front;
  };
  const stair = frontAt(from.y + 1);
  if (stair) return frontAt(from.y + 2) || frontAt(from.y + 2, here) ? undefined : stair;
  return frontAt(from.y) ?? frontAt(from.y - 1);
}

export function towardOf(view: ViewIndex, step: Step): Vec3 {
  const r = rightOf(view);
  return vec(r.x * step, 0, r.z * step);
}

/**
 * 화살표 한 번. 큐브가 여럿이면 저마다 따로 판정한다.
 * 하나도 못 움직이면 상태를 건드리지 않는다 — 튕기는 건 실패가 아니라 그냥 튕기는 것이다.
 */
export function attempt(state: GameState, step: Step): { state: GameState; outcomes: MoveOutcome[] } {
  const { stage, view } = state;
  const toward = towardOf(view, step);
  const outcomes: MoveOutcome[] = [];

  if (state.cleared) return { state, outcomes };

  const solids = layout(stage, view, state.flipped);
  const open = unsealed(stage, view);
  const together = merged(state);
  const next: Piece[] = [];
  let moved = false;
  let relayed = false;
  // 이번 수에 뒤집히는 칸들. 둘이 같은 칸에서 함께 떠나도 한 번만 뒤집혀야 해서 따로 모은다.
  let turning = 0;

  state.pieces.forEach((piece, index) => {
    // 교대 판에서는 지금 조종 중인 큐브만 움직인다. 나머지는 제자리에 선다.
    if (piece.done || (stage.relay && index !== state.active)) {
      next.push(piece);
      return;
    }
    const at = piece.pos;
    const refuse = (reason: RefuseReason, blocked: Vec3 | null): void => {
      outcomes.push({ kind: 'refuse', index, at, toward, reason, blocked });
      next.push(piece);
    };

    const target = targetSolid(solids, at, view, step);
    if (!target) return refuse('void', null);
    // 발판 밑에 매달린 큐브에게는 칸의 색이 뒤집혀 보인다
    const facing = seenFrom(target.color, piece.side);
    const free = target.kind === 'switch' || target.kind === 'relay';
    if (!free && facing !== piece.color) return refuse('color', target.pos);
    if (target.kind === 'goal' && !open) return refuse('sealed', target.pos);
    if (target.kind === 'goal' && !together) return refuse('apart', target.pos);

    const painted = target.kind === 'switch' && facing !== piece.color ? facing : null;
    const color = target.kind === 'switch' ? facing : piece.color;
    const entered = target.kind === 'goal';
    if (target.kind === 'relay') relayed = true;
    moved = true;
    next.push({ pos: target.pos, color, side: piece.side, done: entered });

    // 딛고 있던 칸이 뒤집히는 칸이면, 떠나는 순간 반대색으로 넘어간다
    const left = tileAt(stage, at);
    const bit = left && left.flipBit >= 0 ? 1 << left.flipBit : 0;
    const turned = bit !== 0 && (turning & bit) === 0;
    turning |= bit;

    outcomes.push({ kind: 'move', index, from: at, to: target.pos, toward, painted, entered, turned });
  });

  if (!moved) return { state, outcomes };

  // 교대 칸을 밟았거나 지금 큐브가 빠져나갔으면 조종권이 넘어간다
  const handOver = relayed || (next[state.active]?.done ?? false);
  const active = handOver ? nextActive(next, state.active) : state.active;

  return {
    state: {
      ...state,
      pieces: next,
      flipped: state.flipped ^ turning,
      moves: state.moves + 1,
      active,
      cleared: next.every((p) => p.done),
    },
    outcomes,
  };
}

/** 시점을 돌린다. */
export function rotate(state: GameState, d: Turn): GameState {
  return { ...state, view: turnView(state.view, d) };
}

/** 판 상태를 가르는 열쇠. 걸음 수처럼 앞으로의 수에 상관없는 것은 넣지 않는다. */
export const stateKey = (s: GameState): string =>
  s.pieces
    .map((p) => [p.pos.x, p.pos.y, p.pos.z, p.color, p.side, p.done ? 1 : 0].join(','))
    .join('|') + '@' + s.view + '/' + s.active + '#' + s.flipped;

/** BFS 로 최단 수를 센다. 못 깨면 null. 이동과 회전을 모두 한 수로 친다. */
export function solve(stage: Stage): number | null {
  const start = startOf(stage);
  const key = stateKey;
  const seen = new Set<string>([key(start)]);
  const queue: { state: GameState; depth: number }[] = [{ state: start, depth: 0 }];

  while (queue.length > 0) {
    const cur = queue.shift() as { state: GameState; depth: number };
    if (cur.state.cleared) return cur.depth;
    const nexts: GameState[] = [
      attempt(cur.state, -1).state,
      attempt(cur.state, 1).state,
      rotate(cur.state, -1),
      rotate(cur.state, 1),
    ];
    for (const next of nexts) {
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ state: next, depth: cur.depth + 1 });
    }
  }
  return null;
}

/** 스테이지를 만들 때 클리어 가능한지만 볼 때 쓴다. */
export const isSolvable = (stage: Stage): boolean => solve(stage) !== null;
