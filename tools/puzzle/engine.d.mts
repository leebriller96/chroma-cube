/** engine.mjs 의 칸. k: f 땅 · p 뒤집히는 칸 · s 스위치 · g 문, c: 0 파랑 · 1 빨강 */
export interface FastTile {
  x: number;
  y: number;
  z: number;
  k: 'f' | 'p' | 's' | 'g';
  c: 0 | 1;
}

export interface Analysis {
  solvable: boolean;
  R: number;
  L?: number;
  moves?: number;
  rots?: number;
  traps?: number;
  dead?: number;
  deadFrac?: number;
  distinct?: number;
}

export function analyze(tiles: readonly FastTile[], start?: { i: number; c: 0 | 1; v: number }): Analysis | null;
