import type { Turn, Vec3, ViewIndex } from './types';

/**
 * 이 게임의 모든 방향 계산은 여기에만 있다.
 * 시점 v 는 카메라가 (sin90v, 0, cos90v) 쪽에 서서 원점을 바라보는 상태다.
 *
 * RIGHT[v]   화면 오른쪽이 가리키는 월드 방향
 * FORWARD[v] 카메라가 보는 방향. 이 축의 값이 클수록 카메라에서 멀다.
 */
const RIGHT = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
] as const satisfies readonly Vec3[];

const FORWARD = [
  { x: 0, y: 0, z: -1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 1, y: 0, z: 0 },
] as const satisfies readonly Vec3[];

export const rightOf = (view: ViewIndex): Vec3 => RIGHT[view];
export const forwardOf = (view: ViewIndex): Vec3 => FORWARD[view];

/** 월드 좌표를 화면 가로축 정수 좌표로 접는다. */
export function screenX(p: Vec3, view: ViewIndex): number {
  const r = RIGHT[view];
  return p.x * r.x + p.z * r.z;
}

/** 카메라로부터의 깊이. 작을수록 앞이다. */
export function depthOf(p: Vec3, view: ViewIndex): number {
  const f = FORWARD[view];
  return p.x * f.x + p.z * f.z;
}

export function turnView(view: ViewIndex, d: Turn): ViewIndex {
  return (((view + d) % 4) + 4) % 4 as ViewIndex;
}

/** 카메라 방위각(라디안). 렌더러가 이 값으로 카메라를 놓는다. */
export const azimuthOf = (view: number): number => (view * Math.PI) / 2;
