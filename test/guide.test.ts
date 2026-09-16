import { describe, expect, it } from 'vitest';
import { solve, startOf, stateKey, type GameState } from '../src/core/game';
import { ACTIONS, act, Guide } from '../src/core/guide';
import { STAGES } from '../src/core/stages';

describe('길잡이', () => {
  it.each(STAGES.map((s, i) => [i + 1, s.name, s] as const))(
    '%i. %s — 힌트만 따라가면 최단 수로 깬다',
    (_i, _n, stage) => {
      const guide = new Guide(stage);
      let state = startOf(stage);
      const total = solve(stage) as number;
      expect(guide.remaining(state)).toBe(total);
      for (let k = 0; k < total; k += 1) {
        const next = guide.next(state);
        expect(next).not.toBeNull();
        state = act(state, next as NonNullable<typeof next>);
      }
      expect(state.cleared).toBe(true);
      expect(guide.stuck(state)).toBe(false);
    },
  );

  it('퍼즐 판에서 잘못 두어 갇히면 알아채고, 힌트는 내놓지 않는다', () => {
    const stage = STAGES[STAGES.length - 3];
    if (!stage) throw new Error('판이 없다');
    const guide = new Guide(stage);
    const start = startOf(stage);
    const seen = new Set([stateKey(start)]);
    const queue: GameState[] = [start];
    let trapped: GameState | null = null;
    while (queue.length > 0 && !trapped) {
      const s = queue.shift() as GameState;
      for (const a of ACTIONS) {
        const next = act(s, a);
        const k = stateKey(next);
        if (seen.has(k)) continue;
        seen.add(k);
        if (guide.stuck(next)) trapped = next;
        queue.push(next);
      }
    }
    expect(trapped).not.toBeNull();
    expect(guide.next(trapped as GameState)).toBeNull();
    expect(guide.remaining(trapped as GameState)).toBeNull();
  });
});
