import { describe, expect, it } from 'vitest';
import { refuseAngle } from '../src/render/cube';

const samples = Array.from({ length: 201 }, (_, i) => refuseAngle(i / 200));

describe('refuseAngle', () => {
  it('가만히 있다 시작해서 가만히 끝난다', () => {
    expect(refuseAngle(0)).toBe(0);
    expect(refuseAngle(1)).toBeCloseTo(0, 6);
  });

  it('먼저 가려던 쪽으로 기운다', () => {
    const peak = Math.max(...samples);
    const peakAt = samples.indexOf(peak) / 200;
    expect(peak).toBeGreaterThan(0.25);
    expect(peakAt).toBeLessThan(0.25);
  });

  it('되튕겨 반대쪽으로 넘어갔다가 잦아든다', () => {
    const dip = Math.min(...samples);
    expect(dip).toBeLessThan(-0.03);
    const tail = samples.slice(160);
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.03);
  });

  it('구간 밖은 잘라 쓴다', () => {
    expect(refuseAngle(-1)).toBe(0);
    expect(refuseAngle(2)).toBeCloseTo(0, 6);
  });
});
