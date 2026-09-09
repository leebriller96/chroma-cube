export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
