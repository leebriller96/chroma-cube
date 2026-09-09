import { describe, expect, it } from 'vitest';
import { depthOf, forwardOf, rightOf, screenX, turnView } from '../src/core/view';
import { vec } from '../src/core/types';
import type { ViewIndex } from '../src/core/types';

const VIEWS: readonly ViewIndex[] = [0, 1, 2, 3];

describe('view', () => {
  it('오른쪽과 정면은 항상 수직이다', () => {
    for (const v of VIEWS) {
      const r = rightOf(v);
      const f = forwardOf(v);
      expect(r.x * f.x + r.z * f.z).toBeCloseTo(0);
    }
  });

  it('두 번 돌면 화면 가로축이 뒤집힌다', () => {
    const p = vec(2, 0, -3);
    for (const v of VIEWS) {
      expect(screenX(p, turnView(turnView(v, 1), 1))).toBe(-screenX(p, v));
      expect(depthOf(p, turnView(turnView(v, 1), 1))).toBe(-depthOf(p, v));
    }
  });

  it('view 0 은 화면 오른쪽이 +x, 안쪽이 -z 다', () => {
    expect(rightOf(0)).toEqual({ x: 1, y: 0, z: 0 });
    expect(depthOf(vec(0, 0, -5), 0)).toBe(5);
  });
});
