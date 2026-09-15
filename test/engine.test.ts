import { describe, expect, it } from 'vitest';
import { solve } from '../src/core/game';
import { STAGES } from '../src/core/stages';
import { analyze, type FastTile } from '../tools/puzzle/engine.mjs';

// 퍼즐 탐색기(tools/puzzle)는 규칙을 따로 복제해 빠르게 푼다.
// 게임 규칙이 바뀌었는데 탐색기가 그대로면 엉뚱한 판을 뽑으므로, 판마다 최단 수를 대조한다.
const KIND = { floor: 'f', flip: 'p', switch: 's', goal: 'g' } as const;

const simple = STAGES.filter(
  (s) => s.starts.length === 1 && s.startSides[0] === 'top' && s.tiles.every((t) => t.kind in KIND),
);

describe('퍼즐 탐색기', () => {
  it.each(simple.map((s) => [s.name, s] as const))('%s 에서 실제 규칙과 최단 수가 같다', (_n, stage) => {
    const tiles: FastTile[] = stage.tiles.map((t) => ({
      x: t.pos.x,
      y: t.pos.y,
      z: t.pos.z,
      k: KIND[t.kind as keyof typeof KIND],
      c: t.color === 'red' ? 1 : 0,
    }));
    const start = stage.starts[0];
    const i = stage.tiles.findIndex((t) => t.pos.x === start?.x && t.pos.y === start?.y && t.pos.z === start?.z);
    const fast = analyze(tiles, { i, c: stage.startColors[0] === 'red' ? 1 : 0, v: stage.startView });
    expect(fast?.L).toBe(solve(stage));
  });

  it('퍼즐 판에는 막다른 갈림이 있다', () => {
    // 마지막 세 판은 길기만 한 판이 아니어야 한다
    for (const stage of STAGES.slice(-3)) {
      const tiles: FastTile[] = stage.tiles.map((t) => ({
        x: t.pos.x, y: t.pos.y, z: t.pos.z,
        k: KIND[t.kind as keyof typeof KIND],
        c: t.color === 'red' ? 1 : 0,
      }));
      const start = stage.starts[0];
      const i = stage.tiles.findIndex((t) => t.pos.x === start?.x && t.pos.y === start?.y && t.pos.z === start?.z);
      const r = analyze(tiles, { i, c: 0, v: stage.startView });
      expect(r?.traps ?? 0).toBeGreaterThanOrEqual(5);
    }
  });
});
