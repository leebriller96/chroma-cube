import type { Tile, Vec3, ViewIndex } from './types';
import { depthOf, screenX } from './view';

const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;

export class World {
  readonly tiles: readonly Tile[];
  private readonly byCell = new Map<string, Tile>();

  constructor(tiles: readonly Tile[]) {
    this.tiles = tiles;
    for (const t of tiles) this.byCell.set(key(t.pos), t);
  }

  /** 3D 격자에 실제로 놓인 타일. 시점과 무관하다. */
  at(p: Vec3): Tile | null {
    return this.byCell.get(key(p)) ?? null;
  }

  /**
   * 화면상 같은 칸에 겹쳐 보이는 타일 중 카메라에 가장 가까운 하나만 실재한다.
   * 뒤에 있는 것은 보이지도 않고 밟히지도 않는다. 이 규칙이 시점 회전을
   * 단순한 연출이 아니라 퍼즐로 만든다.
   */
  frontAt(sx: number, y: number, view: ViewIndex): Tile | null {
    let best: Tile | null = null;
    let bestDepth = Number.POSITIVE_INFINITY;
    for (const t of this.tiles) {
      if (t.pos.y !== y) continue;
      if (screenX(t.pos, view) !== sx) continue;
      const d = depthOf(t.pos, view);
      if (d < bestDepth) {
        bestDepth = d;
        best = t;
      }
    }
    return best;
  }

  /** p 에서 아래로 내려가며 만나는 첫 타일. 회전 후 착지 지점을 구할 때 쓴다. */
  supportBelow(p: Vec3, maxDrop = 32): Tile | null {
    for (let d = 1; d <= maxDrop; d++) {
      const t = this.at({ x: p.x, y: p.y - d, z: p.z });
      if (t) return t;
    }
    return null;
  }
}
