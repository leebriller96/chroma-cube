import {
  Fog,
  Group,
  OrthographicCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Stage } from '../core/stage';
import type { Tile, Vec3, ViewIndex } from '../core/types';
import type { GameState, Movement, Refusal } from '../core/game';
import { layout, merged, unsealed } from '../core/game';
import { azimuthOf, forwardOf, rightOf, screenX, turnView } from '../core/view';
import { Backdrop } from './backdrop';
import { SKY_LOW, SKY_TOP } from './palette';
import { skyTexture } from './textures';
import { FinishShader } from './print';
import { Board } from './board';
import { BADGE_LIFT, Bond } from './bond';
import { Gust } from './gust';
import { Cube } from './cube';
import { easeInOutCubic } from './easing';

/** 시점이 목표 각도로 빨려 들어가는 세기. 클수록 빠르다. */
const TURN_PULL = 8.5;
/** 평소 카메라 각도. 0 이라 화면은 완전한 2D 다. 뒤 겹은 앞 겹에 완전히 가려진다. */
const TILT = 0;
/** 시점을 돌리는 동안만 위로 들어올려 3D 라는 걸 보여 준다. 크게 들면 화면이 출렁인다. */
const TURN_LIFT = 0.17;
/** 화면 가로로 최소한 이만큼(월드 단위 × 2)은 보이게 한다. 세로가 긴 폰에서도 판이 안 좁아지도록. */
const MIN_HALF_X = 2.8;
/** 판이 넓으면 이만큼까지는 뒤로 물러나 다 담는다 */
const MAX_FIT = 15;
/** 그 이상 물러나면 발판이 콩알만 해진다 */
const MAX_HALF_Y = 5.4;
/**
 * 판이 이보다 높으면 한 화면에 통째로 담지 않는다. 담으면 발판이 콩알만 해지니까.
 * 대신 이만큼의 높이만 보여 주고, 큐브를 따라 위아래로 올라간다 — 오르는 맛이 나도록.
 */
const TALL_SPAN = 11;
/** 카메라가 플레이어를 따라가는 속도 */
const FOLLOW = 6;
/** 손가락을 이만큼(90° 대비) 끌어야 시점이 넘어간다 */
const COMMIT = 0.4;
const DISTANCE = 24;
/** 작은 판이 시작할 때 살짝 당겨졌다 제자리로 오는 시간 */
const INTRO_MS = 620;
/**
 * 큰 판은 큐브에 바짝 붙어서 시작했다가 쭉 물러나며 판 전체를 드러낸다.
 * "이게 다인 줄 알았지?" 하는 순간을 만들려는 것이라, 판이 클수록 더 오래 더 세게 당긴다.
 */
const REVEAL_MS = 1750;
/** 물러나기 전 화면에 담기는 범위. 1 이면 처음부터 다 보인다. */
const REVEAL_ZOOM = 0.34;
/** 판이 이만큼(칸 수) 커야 드러내기를 한다. 작은 판은 그냥 시작한다. */
const REVEAL_AT = 10;

export class World {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly stageRoot = new Group();
  private readonly cubes: Cube[] = [];
  private readonly ghosts = new Set<Tile>();
  /** 카메라가 따라갈 큐브. 바통을 넘기면 여기도 넘어간다. */
  private lead = 0;
  private readonly backdrop = new Backdrop();
  private readonly target = new Vector3();
  private readonly fog = new Fog(SKY_LOW.clone(), 22, 30);
  private readonly composer: EffectComposer;
  private readonly print: ShaderPass;
  private board: Board | null = null;
  /** 큐브가 여럿인 판에서 두 몸을 묶는 고리. 한 몸뿐이면 만들지 않는다. */
  private bond: Bond | null = null;
  /** 지금 두 몸이 포개져 있는지. 고리가 이어졌는지와 같은 말이다. */
  private joined = true;
  private view: ViewIndex = 0;
  private azimuth = 0;
  private azimuthTo = 0;
  /** 지금 도는 속도. 손을 떼도 이 속도가 이어져서 끊기지 않는다. */
  private azimuthVel = 0;
  /** 손가락으로 돌리는 중이면 그 시작 각도 */
  private dragFrom: number | null = null;
  private intro = 1;
  private stage: Stage | null = null;
  /** 판의 한가운데. 카메라의 깊이 기준점이다. */
  private readonly centre = new Vector3();
  /** 카메라가 보려는 월드 점. 도는 동안에는 이 값을 얼려 둔다. */
  private readonly desired = new Vector3();
  private spanX = 9;
  private spanY = 4.4;
  /** 한 화면에 다 못 담을 만큼 높은 판이면, 큐브를 따라 위아래로도 움직인다 */
  private tall = false;
  /** 이번 판을 드러낼 때 처음 잡는 배율. 1 이면 드러내기 없이 그냥 시작한다. */
  private revealFrom = 1;
  private revealMs = INTRO_MS;
  private readonly gust = new Gust();
  /** 고리 반쪽이 뜨는 자리. 프레임마다 Vector3 를 새로 만들지 않으려고 들고 있는다. */
  private readonly badges: Vector3[] = [];
  /** 손가락이 만든 각도차. 90° 를 넘지 않는다. */
  private dragOffset = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.camera = new OrthographicCamera(-8, 8, 5, -5, 0.1, 120);
    this.scene.fog = this.fog;
    this.scene.background = skyTexture(SKY_TOP, SKY_LOW);


    this.scene.add(this.stageRoot, this.backdrop.group, this.gust.group);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.print = new ShaderPass(FinishShader);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.print);
    this.resize();
  }

  /** 큐브가 여럿이어도 소리는 한 번만 난다 */
  onImpact: (() => void) | null = null;
  onLand: (() => void) | null = null;
  onSettled: (() => void) | null = null;
  /** 문이 열리거나 닫히는 순간 */
  onGate: ((open: boolean) => void) | null = null;
  /** 발판이 넘어가는 순간 */
  onFlip: (() => void) | null = null;

  get busy(): boolean {
    if (this.cubes.some((c) => c.busy)) return true;
    if (this.dragFrom !== null) return false;
    return Math.abs(this.azimuthTo - this.azimuth) > 0.035 || Math.abs(this.azimuthVel) > 0.25;
  }

  setStage(state: GameState): void {
    const { stage, view } = state;
    this.board?.dispose();
    this.stageRoot.clear();
    this.board = new Board(stage);
    this.stageRoot.add(this.board.group);

    for (const cube of this.cubes) this.scene.remove(cube.root);
    this.cubes.length = 0;
    if (this.bond) {
      this.scene.remove(this.bond.group);
      this.bond.dispose();
      this.bond = null;
    }
    if (state.pieces.length > 1) {
      this.bond = new Bond(state.pieces.length);
      this.scene.add(this.bond.group);
    }
    this.badges.length = 0;
    for (let i = 0; i < state.pieces.length; i += 1) this.badges.push(new Vector3());
    for (const piece of state.pieces) {
      const cube = new Cube();
      cube.onImpact = () => this.onImpact?.();
      cube.onLand = () => this.onLand?.();
      cube.onSettled = () => this.onSettled?.();
      cube.setSide(piece.side);
      cube.place(piece.pos, piece.color);
      this.scene.add(cube.root);
      this.cubes.push(cube);
    }

    this.stage = stage;
    this.centre.set((stage.width - 1) / 2, 0.2 + (stage.low + stage.high) / 2, -(stage.depth - 1) / 2);
    this.spanX = Math.max(stage.width, stage.depth) + 2.6;
    const fullY = 4.4 + (stage.high - stage.low);
    this.tall = fullY > TALL_SPAN;
    this.spanY = Math.min(fullY, TALL_SPAN);

    // 겹이 뒤로 갈수록 어두워지도록 안개를 판에 맞춰 잡는다
    this.fog.near = DISTANCE - (stage.depth - 1) / 2 - 0.4;
    this.fog.far = this.fog.near + 55;

    // 판이 크면 큐브에 바짝 붙어 시작했다가 물러나며 전체를 드러낸다.
    // 카메라가 담는 범위가 아니라 판 자체의 크기로 잰다. 높이는 한 층이 가로 한 칸보다 크게 다가온다.
    const scale = Math.max(stage.width, stage.depth, 1 + (stage.high - stage.low) * 1.6);
    const big = scale >= REVEAL_AT;
    this.revealFrom = big ? REVEAL_ZOOM : 0.95;
    this.revealMs = big ? REVEAL_MS : INTRO_MS;
    this.gust.blow(big ? Math.min(1, (scale - REVEAL_AT) / 5 + 0.5) : 0);

    this.view = view;
    this.azimuth = this.azimuthTo = azimuthOf(view);
    this.azimuthVel = 0;
    this.dragFrom = null;
    this.intro = 0;
    this.resize();
    this.sync(state);
    this.board?.settle();
    // 판을 세우면서 나는 여닫힘은 소리를 내지 않는다. 지금부터가 진짜다.
    if (this.board) this.board.onGate = (open) => this.onGate?.(open);
    this.aimAt(this.clampFocus(screenX(this.focusPoint(), view)), this.clampFocusY(this.focusPoint().y));
    this.target.copy(this.desired);
  }

  /**
   * 되돌리기. 판은 새로 세우지 않고, 큐브와 뒤집힌 칸만 그 수의 모습으로 되살린다.
   * 시점이 달라졌으면 카메라는 뚝 끊기지 않고 그쪽으로 돌아간다.
   */
  restore(state: GameState): void {
    state.pieces.forEach((piece, i) => {
      const cube = this.cubes[i];
      if (!cube) return;
      cube.setSide(piece.side);
      cube.place(piece.pos, piece.color);
      if (piece.done) cube.vanish();
    });
    this.board?.placeFlips(state.flipped);
    const delta = (((state.view - this.view) % 4) + 4) % 4;
    if (delta !== 0) this.azimuthTo += ((delta === 3 ? -1 : delta) * Math.PI) / 2;
    this.sync(state);
  }

  /** 이번 판이 드러내기를 하는지. 바람 소리를 낼지 정하는 데 쓴다. */
  get revealing(): boolean {
    return this.revealFrom < 0.5;
  }

  /** 판이 바뀔 때마다(수를 두거나 시점을 돌릴 때마다) 부른다. */
  sync(state: GameState): void {
    this.view = state.view;
    this.joined = merged(state);
    const open = unsealed(state.stage, state.view) && this.joined;
    this.ghosts.clear();
    for (const solid of layout(state.stage, state.view, state.flipped)) {
      if (solid.tile.kind === 'ghost') this.ghosts.add(solid.tile);
    }
    this.board?.sync(state.view, open, this.ghosts, state.flipped);
    this.lead = state.pieces[state.active]?.done
      ? state.pieces.findIndex((p) => !p.done)
      : state.active;
    if (this.lead < 0) this.lead = 0;
    this.cubes.forEach((cube, i) => {
      cube.setActive(!state.stage.relay || i === state.active);
    });
  }

  /** 카메라가 따라다닐 큐브의 자리 */
  private focusPoint(): Vec3 {
    const cube = this.cubes[this.lead] ?? this.cubes.find((c) => !c.gone) ?? this.cubes[0];
    return cube ? cube.position : { x: 0, y: 0, z: 0 };
  }

  play(outcomes: readonly (Movement | Refusal)[]): void {
    for (const outcome of outcomes) {
      const cube = this.cubes[outcome.index];
      if (!cube) continue;
      if (outcome.kind === 'move') {
        cube.roll(outcome.from, outcome.to, outcome.toward, forwardOf(this.view), outcome.painted, outcome.entered);
        // 떠난 자리가 뒤집히는 칸이면 큐브가 구르는 동안 등 뒤에서 넘어간다
        if (outcome.turned) {
          this.board?.turnOver(outcome.from);
          this.onFlip?.();
        }
      } else {
        cube.refuse(outcome.toward);
        if (outcome.blocked) this.board?.flash(outcome.blocked);
      }
    }
  }

  /** 손가락으로 시점을 잡는다. 이때부터 dragBy 로 실시간으로 따라 돈다. */
  beginDrag(): void {
    this.dragFrom = this.azimuthTo;
    this.dragOffset = 0;
  }

  /** 한 번에 한 칸까지만 돈다. 손가락을 그대로 따라가지 않고 살짝 늦게 따라붙는다. */
  dragBy(delta: number): void {
    if (this.dragFrom === null) return;
    const quarter = Math.PI / 2;
    this.dragOffset = Math.max(-quarter, Math.min(quarter, delta));
  }

  /** 손을 떼면 넘어갔는지 판정해서 붙인다. 결과적으로 몇 칸 돌았는지 돌려준다. */
  endDrag(): number {
    if (this.dragFrom === null) return 0;
    const quarter = Math.PI / 2;
    const turns = Math.abs(this.dragOffset) >= quarter * COMMIT ? Math.sign(this.dragOffset) : 0;
    this.azimuthTo = this.dragFrom + turns * quarter;
    // 속도는 그대로 둔다. 손을 떼는 순간 카메라가 멈췄다 다시 출발하면 뚝 끊겨 보인다.
    this.dragFrom = null;
    this.dragOffset = 0;
    if (turns !== 0) this.view = turnView(this.view, turns as -1 | 1);
    return turns;
  }

  /** 시점을 d(=±1)만큼 돌린다. 각도를 누적해서 항상 짧은 쪽으로 돈다. */
  turn(d: -1 | 1, next: ViewIndex): void {
    this.view = next;
    this.azimuthTo += (d * Math.PI) / 2;
  }

  update(dt: number): void {
    // 손가락을 따라갈 때도, 손을 떼고 붙을 때도 같은 스프링 하나가 민다.
    // 그래서 놓는 순간에 속도가 끊기지 않는다.
    const want = this.dragFrom !== null ? this.dragFrom + this.dragOffset : this.azimuthTo;
    // 프레임이 밀려도 같은 속도로 돌도록 잘게 쪼개서 적분한다. 안 그러면 끊긴 것처럼 보인다.
    let left = Math.min(dt, 0.2);
    while (left > 0) {
      const step = Math.min(left, 1 / 120);
      this.azimuthVel +=
        ((want - this.azimuth) * TURN_PULL * TURN_PULL - this.azimuthVel * 2 * TURN_PULL) * step;
      this.azimuth += this.azimuthVel * step;
      left -= step;
    }
    this.follow(dt);
    if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + (dt * 1000) / this.revealMs);
      this.frame();
    }
    for (const cube of this.cubes) cube.update(dt);
    if (this.bond) {
      const spots = this.cubes.map((c, i) =>
        c.gone ? null : c.badgeAt(this.badges[i] as Vector3, BADGE_LIFT),
      );
      this.bond.update(dt, this.azimuth, spots, this.joined);
    }
    this.board?.update(dt, this.azimuth);
    this.backdrop.update(dt, this.azimuth, this.target);
    // 바람은 물러나는 동안만 분다. 다 물러나면 잦아든다.
    this.gust.update(dt, this.azimuth, this.target, this.intro < 1);
    this.placeCamera();
    this.composer.render();
  }

  /** 판이 넓어도 좁은 화면에 담기도록, 카메라가 플레이어를 가로로 따라간다. */
  private follow(dt: number): void {
    if (!this.stage) return;
    // 도는 동안에는 보는 점을 그대로 둔다. 회전과 가로 이동이 겹치면 화면이 휩쓸리듯 흔들린다.
    const turning = this.dragFrom !== null || Math.abs(this.azimuthTo - this.azimuth) > 0.02;
    if (!turning) this.aimAt(this.clampFocus(screenX(this.focusPoint(), this.view)), this.clampFocusY(this.focusPoint().y));
    this.target.lerp(this.desired, 1 - Math.exp(-dt * FOLLOW));
  }

  /** 판 바깥의 허공까지 밀려나지 않게 시선을 판 안으로 가둔다. */
  private clampFocus(x: number): number {
    const stage = this.stage;
    if (!stage) return x;
    let lo = Infinity;
    let hi = -Infinity;
    for (const tile of stage.tiles) {
      const s = screenX(tile.pos, this.view);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    const half = this.camera.right;
    const min = lo - 1.4 + half;
    const max = hi + 1.4 - half;
    return min > max ? (lo + hi) / 2 : Math.min(Math.max(x, min), max);
  }

  /** 화면 가로 좌표를 월드의 카메라 초점으로 옮긴다. 깊이는 늘 판 한가운데. */
  private aimAt(focus: number, height: number): void {
    const r = rightOf(this.view);
    const shift = focus - screenX(this.centre, this.view);
    this.desired.set(this.centre.x + r.x * shift, height, this.centre.z + r.z * shift);
  }

  /**
   * 높은 판에서는 큐브를 따라 위아래로도 움직인다.
   * 큐브를 화면 한가운데보다 조금 아래에 두어, 올라갈 쪽이 더 넓게 보이게 한다.
   * 판 아래위 끝 너머의 허공까지는 따라가지 않는다.
   */
  private clampFocusY(y: number): number {
    const stage = this.stage;
    if (!stage || !this.tall) return this.centre.y;
    const half = this.camera.top;
    const lo = stage.low - 0.6 + half;
    const hi = stage.high + 1.6 - half;
    return lo > hi ? this.centre.y : Math.min(Math.max(y + 1.6, lo), hi);
  }

  private placeCamera(): void {
    // 시점 사이를 지나는 동안만 카메라가 들린다. 손으로 돌릴 때도 똑같이.
    // 들림 정도는 오로지 지금 각도에서만 뽑는다. 손을 떼는 순간에도 값이 튀지 않는다.
    const quarter = Math.PI / 2;
    const phase = (((this.azimuth / quarter) % 1) + 1) % 1;
    // sin² 라서 들리기 시작할 때와 내려앉을 때 속도가 0 이다. 그래서 툭 튀지 않는다.
    const lift = Math.sin(Math.PI * phase) ** 2 * TURN_LIFT;
    const tilt = TILT + lift;
    const y = Math.sin(tilt) * DISTANCE;
    const h = Math.cos(tilt) * DISTANCE;
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    this.camera.position.set(this.target.x + sin * h, this.target.y + y, this.target.z + cos * h);
    this.camera.lookAt(this.target);

  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    // 탭이 숨겨지면 창 크기가 0 으로 온다. 그대로 계산하면 NaN 이 카메라에 눌어붙는다.
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.print.uniforms['uResolution']?.value.set(w * this.renderer.getPixelRatio(), h);
    this.frame();
  }

  /** 화면 크기는 그대로 두고 담기는 범위만 다시 잡는다. */
  private frame(): void {
    const w = innerWidth;
    const h = innerHeight;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    // 처음에는 좁게 잡았다가(작을수록 바짝 붙는다) 제 범위로 벌어진다
    const zoom = this.revealFrom + (1 - this.revealFrom) * easeInOutCubic(this.intro);
    // 판이 넓으면 뒤로 물러나 통째로 담는다. 다만 발판이 너무 작아지기 전에 멈춘다.
    const fit = Math.min(this.spanX, MAX_FIT) / 2 / aspect;
    const halfY =
      Math.max(Math.max(this.spanY / 2, Math.min(fit, MAX_HALF_Y)), MIN_HALF_X / aspect) * zoom;
    const halfX = halfY * aspect;
    this.camera.left = -halfX;
    this.camera.right = halfX;
    this.camera.top = halfY;
    this.camera.bottom = -halfY;
    this.camera.updateProjectionMatrix();
  }
}
