import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { GOLD, STONE } from './palette';
import { RING_R, RING_T } from './board';

/**
 * 두 몸을 묶는 고리.
 *
 * 이 게임에서 문이 열리는 조건은 하나다 — **흩어진 고리가 하나로 이어질 것.**
 * 「이어진 고리」에서는 시점을 돌려 조각을 겹치고, 여기서는 두 몸을 한 칸에 포갠다.
 * 그래서 큐브마다 고리 반쪽을 이고 다니게 했다. 떨어져 있으면 반쪽씩 따로 돌고,
 * 포개지는 순간 두 반쪽이 가운데로 미끄러져 하나가 된다. 그게 곧 문이 열렸다는 신호다.
 */
// 문에 걸린 봉인 · 흩어진 조각 · 두 몸이 나눠 든 반쪽. 셋이 같은 고리라 크기도 같다.
const RADIUS = RING_R;
const THICK = RING_T;
/** 조각 사이에 남기는 틈 */
const GAP = 0.26;
/** 큐브에 파묻히지 않게 카메라 쪽으로 이만큼 띄운다 */
const FRONT = 0.55;
/** 큐브 머리 위(밑에 매달린 큐브면 발밑)로 이만큼 띄운다 */
export const BADGE_LIFT = 0.78;

interface Arc {
  readonly spin: Group;
  readonly mat: MeshBasicMaterial;
  /** 지금 떠 있는 자리. 목표로 스르르 따라간다. */
  readonly at: Vector3;
  placed: boolean;
}

const WANT = new Color();

export class Bond {
  readonly group = new Group();
  private readonly arcs: Arc[] = [];
  private readonly centre = new Vector3();
  private clock = 0;

  constructor(count: number) {
    const span = (Math.PI * 2) / count;
    for (let i = 0; i < count; i += 1) {
      const geo = new RingGeometry(RADIUS - THICK, RADIUS, 48, 1, i * span + GAP / 2, span - GAP);
      const mat = new MeshBasicMaterial({
        color: STONE.dark.clone(),
        side: DoubleSide,
        transparent: true,
        opacity: 0,
        fog: false,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.z = FRONT;
      const spin = new Group();
      spin.add(mesh);
      this.group.add(spin);
      this.arcs.push({ spin, mat, at: new Vector3(), placed: false });
    }
  }

  /**
   * spots[i] 는 그 큐브의 한가운데. 이미 문에 들어갔으면 null.
   * joined 면 살아 있는 조각들이 전부 가운데로 모여 고리를 잇는다.
   */
  update(dt: number, azimuth: number, spots: readonly (Vector3 | null)[], joined: boolean): void {
    this.clock += dt;
    const live = spots.filter((s): s is Vector3 => s !== null);
    // 한 몸만 남았으면 이을 것이 없다
    const shown = live.length > 1;

    this.centre.set(0, 0, 0);
    for (const s of live) this.centre.add(s);
    if (live.length > 0) this.centre.multiplyScalar(1 / live.length);

    const beat = 0.5 + 0.5 * Math.sin(this.clock * 2.4);
    const chase = 1 - Math.exp(-dt * 9);

    this.arcs.forEach((arc, i) => {
      const own = spots[i] ?? null;
      const here = joined ? this.centre : own;
      if (here) {
        // 처음 나타날 때는 곧장 제자리에 놓는다. 원점에서 날아오면 눈에 거슬린다.
        if (arc.placed) arc.at.lerp(here, chase);
        else arc.at.copy(here);
        arc.placed = true;
      }
      arc.spin.position.copy(arc.at);
      arc.spin.position.y += joined ? Math.sin(this.clock * 1.9) * 0.04 : 0;
      arc.spin.rotation.y = azimuth;

      WANT.copy(joined ? GOLD.light : STONE.dark);
      if (joined) WANT.multiplyScalar(1 + beat * 0.18);
      arc.mat.color.lerp(WANT, chase);

      const want = shown && own !== null ? 1 : 0;
      arc.mat.opacity += (want - arc.mat.opacity) * chase;
    });
  }

  dispose(): void {
    for (const arc of this.arcs) {
      arc.mat.dispose();
      arc.spin.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
    }
    this.group.clear();
  }
}
