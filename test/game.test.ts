import { describe, expect, it } from 'vitest';
import {
  attempt,
  layout,
  rotate,
  startOf,
  targetSolid,
  tileAt,
  unsealed,
  type GameState,
} from '../src/core/game';
import { parseStage } from '../src/core/stage';
import { vec } from '../src/core/types';

/**
 *   앞줄(z=0)  : 파랑 - 빨강 - 파란 문
 *   뒷줄(z=-1) :   -  파랑스위치 -  -
 * view 0 에서는 스위치가 빨간 칸 뒤에 완전히 숨는다.
 */
const sandbox = parseStage({
  name: 'sandbox',
  hint: '',
  rows: [
    'b. r. b*',
    '.. b! ..',
  ],
  start: [[0, 0]],
  startColor: 'blue',
});

const only = (s: GameState) => s.pieces[0]!;
const solids = (s: GameState) => layout(s.stage, s.view);

describe('parseStage', () => {
  it('첫 줄이 앞 겹, 다음 줄이 뒤 겹이다', () => {
    expect(tileAt(sandbox, vec(1, 0, 0))).toMatchObject({ color: 'red', kind: 'floor' });
    expect(tileAt(sandbox, vec(1, 0, -1))).toMatchObject({ color: 'blue', kind: 'switch' });
    expect(sandbox.depth).toBe(2);
  });

  it('층을 쌓으면 같은 지도가 높이별로 겹쳐 선다', () => {
    const tower = parseStage({
      name: 'tower',
      hint: '',
      floors: [
        { y: 0, rows: ['b. ..'] },
        { y: 1, rows: ['.. ..', '.. b.'] },
      ],
      start: [[0, 0, 0]],
      startColor: 'blue',
    });
    expect(tileAt(tower, vec(1, 1, -1))).toMatchObject({ color: 'blue' });
    expect([tower.low, tower.high]).toEqual([0, 1]);
  });

  it('모르는 글자는 거부한다', () => {
    expect(() =>
      parseStage({ name: 'x', hint: '', rows: ['q.'], start: [[0, 0]], startColor: 'blue' }),
    ).toThrow();
  });

  it('색이 없어야 하는 칸에 색을 쓰면 거부한다', () => {
    expect(() =>
      parseStage({ name: 'x', hint: '', rows: ['b? b.'], start: [[0, 1]], startColor: 'blue' }),
    ).toThrow();
  });
});

describe('targetSolid', () => {
  const s0 = startOf(sandbox);

  it('겹쳐 보이는 칸 중 카메라에 가까운 쪽을 고른다', () => {
    expect(targetSolid(solids(s0), vec(0, 0, 0), 0, 1)).toMatchObject({ pos: vec(1, 0, 0) });
  });

  it('반대편에서 보면 뒷줄이 앞줄이 된다', () => {
    const flipped = { ...s0, view: 2 as const };
    expect(targetSolid(solids(flipped), vec(0, 0, 0), 2, -1)).toMatchObject({ pos: vec(1, 0, -1) });
  });

  it('평지가 없으면 한 칸 올라서고, 그것도 없으면 한 칸 내려선다', () => {
    const steps = parseStage({
      name: 'steps',
      hint: '',
      floors: [
        { y: 0, rows: ['b. .. b.'] },
        { y: 1, rows: ['.. b. ..'] },
      ],
      start: [[0, 0, 0]],
      startColor: 'blue',
    });
    const all = layout(steps, 0);
    expect(targetSolid(all, vec(0, 0, 0), 0, 1)).toMatchObject({ pos: vec(1, 1, 0) });
    expect(targetSolid(all, vec(1, 1, 0), 0, 1)).toMatchObject({ pos: vec(2, 0, 0) });
  });

  it('머리 높이에 칸이 있으면 그 밑에 다른 겹의 평지가 있어도 계단으로 오른다', () => {
    const step = parseStage({
      name: 'step',
      hint: '',
      floors: [
        { y: 0, rows: ['b. ..', '.. b.'] }, // (1,0,-1) — 한 겹 뒤의 평지. 정면에서는 계단 칸 바로 밑에 겹쳐 보인다
        { y: 1, rows: ['.. b.'] }, // (1,1,0) — 머리 높이의 칸
      ],
      start: [[0, 0, 0]],
      startColor: 'blue',
    });
    expect(targetSolid(layout(step, 0), vec(0, 0, 0), 0, 1)).toMatchObject({ pos: vec(1, 1, 0) });
  });

  it('두 칸 높이로 쌓여 보이면 벽이라 오르지 못한다', () => {
    const wall = parseStage({
      name: 'wall',
      hint: '',
      floors: [
        { y: 0, rows: ['b. ..'] },
        { y: 1, rows: ['.. b.'] },
        { y: 2, rows: ['.. ..', '.. b.'] }, // 겹은 달라도 화면에서는 계단 칸 위에 얹혀 보인다
      ],
      start: [[0, 0, 0]],
      startColor: 'blue',
    });
    expect(targetSolid(layout(wall, 0), vec(0, 0, 0), 0, 1)).toBeUndefined();
  });

  it('제 머리 위가 막혀 있으면 계단을 오르지 못한다', () => {
    const low = parseStage({
      name: 'low',
      hint: '',
      floors: [
        { y: 0, rows: ['b. ..'] },
        { y: 1, rows: ['.. b.'] },
        { y: 2, rows: ['.. ..', 'b. ..'] }, // (0,2,-1) — 겹은 달라도 화면에서는 큐브 바로 머리 위다
      ],
      start: [[0, 0, 0]],
      startColor: 'blue',
    });
    expect(targetSolid(layout(low, 0), vec(0, 0, 0), 0, 1)).toBeUndefined();
  });

  it('그 줄에 아무것도 없으면 목적지가 없다', () => {
    expect(targetSolid(solids(s0), vec(0, 0, 0), 0, -1)).toBeUndefined();
  });
});

describe('attempt', () => {
  const s0 = startOf(sandbox);
  const red = { ...s0, pieces: [{ ...only(s0), color: 'red' as const }] };

  it('앞줄이 색이 다르면 뒤에 맞는 칸이 있어도 튕긴다', () => {
    expect(attempt(red, 1).outcomes[0]).toMatchObject({ kind: 'move', to: vec(1, 0, 0) });

    const blocked = attempt(s0, 1);
    expect(blocked.outcomes[0]).toMatchObject({ kind: 'refuse', reason: 'color' });
    expect(blocked.state).toBe(s0);
  });

  it('시점을 돌리면 숨어 있던 칸을 밟을 수 있다', () => {
    const turned = rotate(s0, -1); // view 3 : 화면 가로축이 깊이 축이 된다
    const { state, outcomes } = attempt(turned, -1);
    expect(outcomes[0]).toMatchObject({ kind: 'move', to: vec(1, 0, -1) });
    expect(only(state).pos).toEqual(vec(1, 0, -1));
  });

  it('칸이 없으면 튕기고 상태는 그대로다', () => {
    const { state, outcomes } = attempt(s0, -1);
    expect(outcomes[0]).toMatchObject({ kind: 'refuse', reason: 'void' });
    expect(state).toBe(s0);
  });

  it('스위치는 색과 무관하게 밟히고 큐브를 물들인다', () => {
    const onSwitch = attempt(rotate(red, -1), -1);
    expect(onSwitch.outcomes[0]).toMatchObject({ kind: 'move', painted: 'blue' });
    expect(only(onSwitch.state).color).toBe('blue');
  });

  it('문에 들어가면 그 큐브가 빠지고, 다 빠지면 끝난다', () => {
    const mid = attempt(red, 1).state;
    const end = attempt({ ...mid, pieces: [{ ...only(mid), color: 'blue' }] }, 1);
    expect(end.outcomes[0]).toMatchObject({ kind: 'move', entered: true });
    expect(end.state.cleared).toBe(true);
  });
});

describe('그림자 칸', () => {
  const stage = parseStage({
    name: 'ghost',
    hint: '',
    rows: [
      'b. .? b.',
      '.. r. ..',
    ],
    start: [[0, 0]],
    startColor: 'blue',
  });

  it('같은 세로줄의 실체에서 색을 빌린다', () => {
    const ghost = layout(stage, 0).find((s) => s.tile.kind === 'ghost');
    expect(ghost).toMatchObject({ color: 'red', pos: vec(1, 0, 0) });
  });

  it('뒤에 아무것도 없으면 아예 놓이지 않는다', () => {
    const lonely = parseStage({
      name: 'lonely',
      hint: '',
      rows: ['b. .? b.'],
      start: [[0, 0]],
      startColor: 'blue',
    });
    expect(layout(lonely, 0).some((s) => s.tile.kind === 'ghost')).toBe(false);
  });
});

describe('고리 조각', () => {
  const stage = parseStage({
    name: 'sigil',
    hint: '',
    rows: [
      'b. b. b*',
      '.# .. ..',
      '.. .# ..',
    ],
    start: [[0, 0]],
    startColor: 'blue',
  });

  it('한 줄로 겹쳐 이어질 때만 문이 열린다', () => {
    expect(unsealed(stage, 0)).toBe(false); // x 가 달라 어긋나 보인다
    expect(unsealed(stage, 1)).toBe(false); // z 도 다르다
  });

  it('조각이 없는 판은 늘 열려 있다', () => {
    expect(unsealed(sandbox, 0)).toBe(true);
  });
});

describe('rotate', () => {
  it('네 번 돌면 시점이 제자리로 온다', () => {
    const s0 = startOf(sandbox);
    const spun = rotate(rotate(rotate(rotate(s0, 1), 1), 1), 1);
    expect(spun.view).toBe(s0.view);
  });
});
