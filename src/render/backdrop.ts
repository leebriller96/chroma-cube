import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { softDot } from './textures';
import { DEEP, SUN } from './palette';

/** 시점을 돌릴 때 층마다 다른 속도로 흘러가는 배경. 항상 판 뒤에 서 있다. */
const BEHIND = 13;

interface Layer {
  readonly group: Group;
  /** 시점 각도 대비 흘러가는 속도 */
  readonly speed: number;
  /** 이 간격마다 무늬가 반복된다. 그래서 아무리 돌려도 배경이 떨어지지 않는다. */
  readonly period: number;
}

/** 같은 스테이지에서는 같은 배경이 나오도록 고정된 난수 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 위가 둥근 탑. 아치를 뚫으면 저 멀리 또 다른 문처럼 보인다. */
function towerShape(w: number, h: number, gate: number): Shape {
  const s = new Shape();
  const cap = Math.min(w, h * 0.5);
  s.moveTo(-w, 0);
  s.lineTo(-w, h - cap);
  s.absarc(0, h - cap, cap, Math.PI, 0, true);
  s.lineTo(w, 0);
  s.closePath();
  if (gate > 0) {
    const a = w * gate;
    const hole = new Path();
    hole.moveTo(-a, 0);
    hole.lineTo(-a, h * 0.42 - a);
    hole.absarc(0, h * 0.42 - a, a, Math.PI, 0, true);
    hole.lineTo(a, 0);
    hole.closePath();
    s.holes.push(hole);
  }
  return s;
}

const DISC = new CircleGeometry(1.55, 64);
const HALO = new PlaneGeometry(7.5, 7.5);

export class Backdrop {
  readonly group = new Group();
  private readonly layers: Layer[] = [];
  private readonly twinkle: PointsMaterial[] = [];
  private readonly halo: MeshBasicMaterial;
  private clock = 0;

  constructor() {
    // 가장 먼 것부터. 해는 거의 붙박이고, 가까운 층일수록 빠르게 흐른다.
    this.layers.push(this.buildSun());
    this.layers.push(this.buildSkyline({ seed: 7, period: 30, count: 5, z: -6.5, color: 0xa9a2d8, speed: 1.0, opacity: 0.34, base: -4.6, tall: 5.4 }));
    this.layers.push(this.buildSkyline({ seed: 41, period: 19, count: 3, z: -3, color: 0xf2b78f, speed: 2.1, opacity: 0.26, base: -5.2, tall: 3.4 }));

    this.group.add(this.buildStars(3, 120, 2.2, 0.3));
    this.group.add(this.buildStars(11, 60, 3.2, 0.2));

    this.halo = (this.layers[0]?.group.children[0] as Mesh | undefined)?.material as MeshBasicMaterial;
  }

  /** 지평선 위에 낮게 걸린 해. 배경에서 유일하게 둥근 것이라 눈이 먼저 간다. */
  private buildSun(): Layer {
    const group = new Group();
    const halo = new Mesh(
      HALO,
      new MeshBasicMaterial({ map: softDot(128, 0.05), color: SUN.clone(), transparent: true, opacity: 0.3, depthWrite: false, fog: false }),
    );
    halo.position.set(-5.4, 2.6, -8.4);
    group.add(halo);

    const disc = new Mesh(DISC, new MeshBasicMaterial({ color: SUN.clone(), fog: false }));
    disc.position.set(-5.4, 2.6, -8.2);
    group.add(disc);

    this.group.add(group);
    // 한 바퀴 다 돌면 해가 정확히 제자리로 온다. 그래서 아무리 돌려도 해가 흘러가 버리지 않는다.
    const speed = 0.35;
    return { group, speed, period: Math.PI * 2 * speed };
  }

  /**
   * 먼 지평선에 늘어선 탑들.
   * 판과 같은 언어(모난 돌덩이와 아치)로 지어야 배경이 따로 놀지 않는다.
   */
  private buildSkyline(o: {
    seed: number;
    period: number;
    count: number;
    z: number;
    color: number;
    speed: number;
    opacity: number;
    base: number;
    tall: number;
  }): Layer {
    const group = new Group();
    const rand = seeded(o.seed);
    const material = new MeshBasicMaterial({ color: o.color, fog: false, transparent: true, opacity: o.opacity });

    const towers = Array.from({ length: o.count }, (_, i) => ({
      x: (i + 0.15 + rand() * 0.7) * (o.period / o.count),
      w: 0.7 + rand() * 1.5,
      h: o.tall * (0.5 + rand() * 0.9),
      gate: rand() < 0.45 ? 0.36 + rand() * 0.2 : 0,
    }));

    // 무늬를 좌우로 세 번 늘어놓아 어느 쪽으로 흘러도 빈자리가 없다
    for (let tile = -1; tile <= 1; tile += 1) {
      for (const t of towers) {
        const mesh = new Mesh(new ShapeGeometry(towerShape(t.w, t.h, t.gate)), material);
        mesh.position.set(t.x + tile * o.period - o.period / 2, o.base, o.z);
        group.add(mesh);
      }
    }
    this.group.add(group);
    return { group, speed: o.speed, period: o.period };
  }

  private buildStars(seed: number, count: number, size: number, opacity: number): Points {
    const rand = seeded(seed);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = (rand() - 0.5) * 46;
      pos[i * 3 + 1] = -1.2 + rand() * 6;
      pos[i * 3 + 2] = -9 - rand() * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    const material = new PointsMaterial({
      map: softDot(),
      color: DEEP.clone(),
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    });
    this.twinkle.push(material);
    return new Points(geometry, material);
  }

  /** 카메라 방위에 맞춰 판 뒤에 세우고, 층마다 다른 속도로 흘린다. */
  update(dt: number, azimuth: number, target: Vector3): void {
    this.clock += dt;
    this.group.position.set(
      target.x - Math.sin(azimuth) * BEHIND,
      target.y,
      target.z - Math.cos(azimuth) * BEHIND,
    );
    this.group.rotation.y = azimuth;

    for (const layer of this.layers) {
      const p = layer.period;
      const raw = -azimuth * layer.speed;
      layer.group.position.x = ((raw % p) + p) % p - p / 2;
    }

    if (this.halo) this.halo.opacity = 0.26 + 0.06 * Math.sin(this.clock * 0.6);

    this.twinkle.forEach((m, i) => {
      m.opacity = (i === 0 ? 0.3 : 0.2) * (0.82 + 0.18 * Math.sin(this.clock * (0.7 + i * 0.5) + i));
    });
  }
}
