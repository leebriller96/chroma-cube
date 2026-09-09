import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';

/**
 * 카메라가 확 물러날 때 화면을 스쳐 지나가는 바람.
 * 판 앞쪽 허공에 얇고 긴 줄을 몇 개 흘려서, 뒤로 빠지는 속도를 눈으로 보이게 한다.
 * 카메라를 늘 마주 보게 세워 두므로 어느 시점에서 빠져도 똑같이 스쳐 간다.
 */
const COUNT = 22;
const LINE = new PlaneGeometry(1, 0.028);

interface Streak {
  readonly mesh: Mesh;
  readonly mat: MeshBasicMaterial;
  /** 화면 가로로 흐르는 속도 */
  speed: number;
  life: number;
  span: number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Gust {
  readonly group = new Group();
  private readonly streaks: Streak[] = [];
  private readonly rand = seeded(19);
  /** 지금 부는 세기. 0 이면 아무것도 안 그린다. */
  private force = 0;
  /** 이번 판이 얼마나 세게 부는지. blow() 로 정한다. */
  private strength = 0;

  constructor() {
    for (let i = 0; i < COUNT; i += 1) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      });
      const mesh = new Mesh(LINE, mat);
      this.group.add(mesh);
      const streak: Streak = { mesh, mat, speed: 0, life: 0, span: 1 };
      this.streaks.push(streak);
    }
  }

  /** 바람을 일으킨다. 세기 1 이면 화면을 가득 스친다. */
  blow(force: number): void {
    this.strength = force;
    for (const s of this.streaks) this.spawn(s, this.rand() * 0.8);
  }

  private spawn(s: Streak, born = 0): void {
    const r = this.rand;
    s.span = 1.6 + r() * 4.2;
    s.speed = (5 + r() * 9) * (r() < 0.5 ? -1 : 1);
    s.life = born;
    s.mesh.scale.set(s.span, 1, 1);
    s.mesh.position.set(-Math.sign(s.speed) * (7 + r() * 6), -4.4 + r() * 9, 1.6 + r() * 3);
  }

  /** 판 앞 허공에 세우고 흘린다. target 은 카메라가 보고 있는 점. */
  update(dt: number, azimuth: number, target: Vector3, on: boolean): void {
    const want = on ? this.strength : 0;
    this.force += (want - this.force) * (1 - Math.exp(-dt * 2.4));
    this.group.visible = this.force > 0.01;
    if (!this.group.visible) return;

    this.group.position.copy(target);
    this.group.rotation.y = azimuth;

    for (const s of this.streaks) {
      s.life += dt * 0.85;
      if (s.life >= 1) this.spawn(s);
      s.mesh.position.x += s.speed * dt;
      // 나타났다 사라지는 한 번의 호(弧). 가운데서 가장 진하다.
      s.mat.opacity = Math.sin(Math.PI * Math.max(s.life, 0)) * 0.4 * this.force;
    }
  }

  dispose(): void {
    for (const s of this.streaks) s.mat.dispose();
    this.group.clear();
  }
}
