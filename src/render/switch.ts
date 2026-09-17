import { CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Side, Vec3 } from '../core/types';
import { SLAB_H } from './metrics';
import { STONE, type Ink } from './palette';
import { slabTexture } from './textures';

/*
 * 스위치 칸 위의 버튼.
 *
 * 발판 한가운데 스위치 색 버튼이 톡 솟아 있다. 옆에서(2D) 봐도 칸 위로 볼록 솟은 게 보여서
 * "밟는 칸"이라는 게 한눈에 읽힌다. 가만히 있을 땐 밟아 달라는 듯 살짝 숨을 쉰다.
 * 큐브가 도착하는 순간 꾹 눌리고, 떠나면 통 튀어 오른다.
 */

/** 버튼 받침과 머리. 옆면에는 발판과 같은 명암 띠를 두른다. */
const BASE = new CylinderGeometry(0.34, 0.36, 0.045, 32);
const CAP = new CylinderGeometry(0.25, 0.27, 0.13, 32);
const BASE_TOP = 0.045;
/** 솟았을 때와 눌렸을 때 머리 한가운데의 높이. 눌리면 큐브 발밑에 파묻힌다. */
const RAISED = BASE_TOP + 0.065;
const PRESSED = RAISED - 0.095;
/** 큐브가 칸에 닿는 데 걸리는 시간만큼 기다렸다가 눌린다. 떠날 땐 조금만 기다린다. */
const ARRIVE = 0.17;
const LEAVE = 0.07;
/** 튀어 오를 때 한 번 출렁이도록 덜 죄인 스프링 */
const SPRING = 28;
const DAMP = 0.42;

/** 물감 방울 */
const DROP = new IcosahedronGeometry(0.05, 0);
const DROP_LIFE = 0.75;
const GRAVITY = 9.5;

const cylinderSkin = (ink: Ink): MeshBasicMaterial[] => [
  new MeshBasicMaterial({ map: slabTexture(ink) }),
  new MeshBasicMaterial({ color: ink.light.clone() }),
  new MeshBasicMaterial({ color: ink.dark.clone() }),
];

export class PaintButton {
  readonly root = new Group();
  readonly side: Side;
  private readonly cap: Mesh;
  private held = false;
  private since = -10;
  /** 눌린 정도. 0 이면 솟아 있고 1 이면 끝까지 눌렸다. 스프링이라 잠깐 넘친다. */
  private press = 0;
  private vel = 0;

  constructor(paint: Ink, flip = false) {
    this.side = flip ? 'under' : 'top';
    const body = new Group();
    this.root.add(body);
    // 발판 밑에 매달린 큐브용 버튼은 발판 아래로 거꾸로 달린다
    if (flip) {
      body.position.y = -SLAB_H;
      body.scale.y = -1;
    }
    const base = new Mesh(BASE, cylinderSkin(STONE));
    base.position.y = BASE_TOP / 2;
    body.add(base);
    this.cap = new Mesh(CAP, cylinderSkin(paint));
    this.cap.position.y = RAISED;
    body.add(this.cap);
  }

  /** 이 버튼 위에 큐브가 서 있는지. 바뀐 순간을 기억해 두었다가 도착·출발에 맞춰 움직인다. */
  hold(on: boolean, clock: number): void {
    if (on === this.held) return;
    this.held = on;
    this.since = clock;
  }

  update(dt: number, clock: number): void {
    const waited = clock - this.since;
    const want = this.held ? (waited > ARRIVE ? 1 : 0) : waited > LEAVE ? 0 : 1;
    let left = Math.min(dt, 0.1);
    while (left > 0) {
      const step = Math.min(left, 1 / 240);
      this.vel += ((want - this.press) * SPRING * SPRING - this.vel * 2 * DAMP * SPRING) * step;
      this.press += this.vel * step;
      left -= step;
    }
    this.cap.position.y = RAISED + (PRESSED - RAISED) * this.press;
    // 솟아 있을 땐 밟아 달라는 듯 숨을 쉰다
    const idle = Math.max(0, 1 - Math.abs(this.press) * 3);
    this.cap.scale.set(1, 1 + Math.sin(clock * 3.4) * 0.07 * idle, 1);
  }
}

/** 스위치를 밟는 순간 튀는 물감 방울들. 판 하나가 한 묶음을 들고 있다. */
export class Splashes {
  readonly group = new Group();
  private readonly drops: {
    readonly mesh: Mesh;
    readonly mat: MeshBasicMaterial;
    readonly vel: Vector3;
    readonly fall: number;
    delay: number;
    life: number;
  }[] = [];

  /**
   * 칸 위에서 물감을 튀긴다. 큐브가 실제로 물들면 크게, 이미 같은 색이면 작게.
   * delay 초 뒤에 튄다 — 큐브가 굴러와 닿는 순간에 맞추려고.
   */
  burst(at: Vec3, paint: Ink, side: Side, big: boolean, delay: number): void {
    const count = big ? 16 : 6;
    const up = side === 'top' ? 1 : -1;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const reach = (big ? 1.5 : 0.8) * (0.6 + Math.random() * 0.6);
      const lift = (big ? 3.3 : 2.1) * (0.7 + Math.random() * 0.5);
      const mat = new MeshBasicMaterial({
        color: (i % 3 === 0 ? paint.light : paint.mid).clone(),
        transparent: true,
      });
      const mesh = new Mesh(DROP, mat);
      mesh.position.set(at.x + Math.cos(angle) * 0.2, at.y + up * 0.1, at.z + Math.sin(angle) * 0.2);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      mesh.visible = false;
      this.group.add(mesh);
      this.drops.push({
        mesh,
        mat,
        vel: new Vector3(Math.cos(angle) * reach, lift * up, Math.sin(angle) * reach),
        fall: GRAVITY * up,
        delay,
        life: DROP_LIFE,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const d = this.drops[i];
      if (!d) continue;
      if (d.delay > 0) {
        d.delay -= dt;
        continue;
      }
      d.mesh.visible = true;
      d.vel.y -= d.fall * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += dt * 6;
      d.life -= dt;
      const k = Math.max(0, d.life / DROP_LIFE);
      d.mesh.scale.setScalar(0.4 + 0.6 * k);
      d.mat.opacity = Math.min(1, k * 2.5);
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        d.mat.dispose();
        this.drops.splice(i, 1);
      }
    }
  }
}
