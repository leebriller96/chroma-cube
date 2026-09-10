import './style.css';
import { attempt, rotate, startOf, type GameState } from './core/game';
import { STAGES } from './core/stages';
import type { Step, Turn } from './core/types';
import { World } from './render/world';
import { Sfx } from './ui/audio';
import { Hud } from './ui/hud';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#stage 캔버스가 없다');

const world = new World(canvas);
const sfx = new Sfx();
let index = 0;
let state: GameState = startOf(stageAt(0));
/** 이번 착지에서 스위치를 밟았는지. 착지 소리와 함께 물드는 소리를 내려고 들고 있는다. */
let pendingPaint = false;

function stageAt(i: number) {
  const stage = STAGES[i];
  if (!stage) throw new Error(`${i}번 스테이지가 없다`);
  return stage;
}

const hud = new Hud({
  move: (s) => move(s),
  turn: (d) => turn(d),
  restart: () => load(index),
  next: () => advance(),
  jump: (i) => {
    sfx.unlock();
    load(i);
  },
});

/** 판을 앞뒤로 넘긴다. 끝에서는 반대쪽 끝으로 돈다. */
function skip(d: -1 | 1): void {
  load((index + d + STAGES.length) % STAGES.length);
}

world.onImpact = () => sfx.ding();
world.onGate = (open) => sfx.gate(open);
world.onLand = () => {
  sfx.land();
  if (pendingPaint) sfx.paint();
  if (state.cleared) sfx.enter();
  pendingPaint = false;
};
world.onSettled = () => {
  if (!state.cleared) return;
  sfx.clear();
  hud.showClear(index === STAGES.length - 1);
};

function load(i: number): void {
  index = i;
  state = startOf(stageAt(i));
  world.setStage(state);
  // 판이 크면 카메라가 쭉 물러나며 전체를 드러낸다. 바람 소리를 거기 얹는다.
  if (world.revealing) sfx.wind(2.1);
  hud.setStage(i, STAGES.length, state.stage, STAGES.map((s) => s.name));
  hud.setStatus(state);
  hud.hideClear();
}

function move(step: Step): void {
  sfx.unlock();
  if (world.busy) return;
  if (state.cleared) {
    advance();
    return;
  }

  const { state: next, outcomes } = attempt(state, step);
  pendingPaint = outcomes.some((o) => o.kind === 'move' && o.painted !== null);
  state = next;
  world.play(outcomes);
  world.sync(state);
  hud.setStatus(state);
}

function turn(d: Turn): void {
  sfx.unlock();
  if (world.busy) return;
  state = rotate(state, d);
  world.turn(d, state.view);
  world.sync(state);
  hud.setStatus(state);
  sfx.turn();
}

function advance(): void {
  load(index === STAGES.length - 1 ? 0 : index + 1);
}

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // 어떤 키를 눌렀든 사용자 제스처다. 여기서 소리를 깨워 둔다 —
  // 판만 넘겨서 큰 판에 닿았을 때도 바람 소리가 나야 하니까.
  sfx.unlock();
  // 판 넘기기는 클리어 여부와 상관없이 언제나 듣는다
  if (e.key === '[') return skip(-1);
  if (e.key === ']') return skip(1);
  if (state.cleared && !world.busy) {
    if (e.key !== 'r' && e.key !== 'R') advance();
    return;
  }
  switch (e.key) {
    case 'ArrowLeft': move(-1); break;
    case 'ArrowRight': move(1); break;
    case 'a': case 'A': case 'ㅁ': case 'q': case 'Q': turn(-1); break;
    case 'd': case 'D': case 'ㅇ': case 'e': case 'E': turn(1); break;
    default: return;
  }
  e.preventDefault();
});

/**
 * 키보드 없이 하는 조작.
 * 가로로 끌면 시점이 손가락을 살짝 늦게 따라 돌고, 놓으면 가장 가까운 90°에 붙는다.
 * 끌지 않고 톡 누르면 그 방향(화면 좌/우)으로 한 칸 걷는다.
 */
const DRAG_START = 12;
const RAD_PER_PX = Math.PI / 2 / 260;
let touch: { id: number; x: number; y: number; dragging: boolean } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x;
  if (!touch.dragging) {
    if (Math.abs(dx) < DRAG_START || world.busy || state.cleared) return;
    touch.dragging = true;
    world.beginDrag();
  }
  world.dragBy(-dx * RAD_PER_PX);
});

const release = (e: PointerEvent): void => {
  if (!touch || e.pointerId !== touch.id) return;
  const wasDragging = touch.dragging;
  touch = null;
  if (!wasDragging) {
    move(e.clientX < innerWidth / 2 ? -1 : 1);
    return;
  }
  const turns = world.endDrag();
  const d: Turn = turns < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(turns); i += 1) state = rotate(state, d);
  if (turns !== 0) {
    world.sync(state);
    sfx.turn();
    hud.setStatus(state);
  }
};

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

addEventListener('resize', () => world.resize());

let last = performance.now();
const frame = (now: number): void => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  world.update(dt);
  requestAnimationFrame(frame);
};

load(0);
requestAnimationFrame(frame);

// 개발 중 콘솔에서 판을 들여다보고 프레임을 손으로 넘기는 용도
if (import.meta.env.DEV) {
  Object.assign(window, {
    chroma: {
      get state() { return state; },
      load,
      world,
      step: (ms: number) => world.update(ms / 1000),
    },
  });
}
