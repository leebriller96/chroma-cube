import { describe, expect, it } from 'vitest';
import { solve } from '../src/core/game';
import { STAGES } from '../src/core/stages';

describe('STAGES', () => {
  it.each(STAGES.map((s, i) => [i + 1, s.name, s] as const))('%i. %s 는 클리어 가능하다', (_i, _n, stage) => {
    const moves = solve(stage);
    expect(moves).not.toBeNull();
    // 실수로 한두 수 만에 끝나는 판이 섞이지 않도록
    expect(moves).toBeGreaterThan(2);
  });

  it('가장 긴 판이 마지막이다', () => {
    const lengths = STAGES.map((s) => solve(s) ?? 0);
    console.log(
      STAGES.map((s, i) => `${i + 1}. ${s.name} ${s.width}×${s.depth} — 최단 ${lengths[i]}수`).join('\n'),
    );
    expect(Math.max(...lengths)).toBe(lengths[lengths.length - 1]);
  });
});
