import type { Step, Turn } from './types';
import type { Stage } from './stage';
import { attempt, rotate, startOf, stateKey, type GameState } from './game';

/** 한 수. 걸음이거나 시점 전환이다. */
export type Action =
  | { readonly kind: 'move'; readonly step: Step }
  | { readonly kind: 'turn'; readonly d: Turn };

/** 둘 수 있는 네 수. 힌트가 같은 거리의 수 여럿 중 고를 때 이 순서를 따른다 — 걸음이 먼저다. */
export const ACTIONS: readonly Action[] = [
  { kind: 'move', step: -1 },
  { kind: 'move', step: 1 },
  { kind: 'turn', d: -1 },
  { kind: 'turn', d: 1 },
];

export const act = (state: GameState, a: Action): GameState =>
  a.kind === 'move' ? attempt(state, a.step).state : rotate(state, a.d);

/**
 * 판 하나의 길잡이.
 *
 * 판을 불러올 때 처음 상태에서 닿을 수 있는 상태를 전부 펼치고, 문에서 거꾸로 거리를 잰다.
 * 플레이어가 서는 상태는 늘 이 안에 있으므로, 그다음부터는 수를 둘 때마다 한 번 찾아보면 끝이다.
 *
 * - 거리가 없는 상태는 **갇힌** 상태다. 어떻게 두어도 문에 못 닿는다
 * - 거리가 d 인 상태에서 거리가 d-1 이 되는 수가 **다음 최선의 수**다
 */
export class Guide {
  private readonly left = new Map<string, number>();

  constructor(stage: Stage) {
    const start = startOf(stage);
    const index = new Map<string, number>([[stateKey(start), 0]]);
    const states: GameState[] = [start];
    const preds: number[][] = [[]];
    const queue: number[] = [];

    for (let i = 0; i < states.length; i += 1) {
      const s = states[i] as GameState;
      // 깬 상태는 끝이다. 거기서부터 거꾸로 잰다.
      if (s.cleared) {
        queue.push(i);
        continue;
      }
      for (const a of ACTIONS) {
        const next = act(s, a);
        // 튕긴 걸음은 상태를 그대로 돌려준다
        if (next === s) continue;
        const k = stateKey(next);
        let j = index.get(k);
        if (j === undefined) {
          j = states.length;
          index.set(k, j);
          states.push(next);
          preds.push([]);
        }
        (preds[j] as number[]).push(i);
      }
    }

    const dist = new Int32Array(states.length).fill(-1);
    for (const i of queue) dist[i] = 0;
    for (let h = 0; h < queue.length; h += 1) {
      const i = queue[h] as number;
      for (const p of preds[i] as number[]) {
        if (dist[p] !== -1) continue;
        dist[p] = (dist[i] as number) + 1;
        queue.push(p);
      }
    }
    for (const [k, i] of index) {
      const d = dist[i] as number;
      if (d >= 0) this.left.set(k, d);
    }
  }

  /** 문까지 남은 최단 수. 갇혔으면 null. */
  remaining(state: GameState): number | null {
    return this.left.get(stateKey(state)) ?? null;
  }

  /** 이 상태로는 어떻게 두어도 문에 못 닿는지 */
  stuck(state: GameState): boolean {
    return !state.cleared && !this.left.has(stateKey(state));
  }

  /** 다음 최선의 수. 갇혔거나 이미 깼으면 null. */
  next(state: GameState): Action | null {
    const d = this.remaining(state);
    if (d === null || d === 0) return null;
    return ACTIONS.find((a) => this.left.get(stateKey(act(state, a))) === d - 1) ?? null;
  }
}
