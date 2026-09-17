import './style.css';
import { attempt, rotate, startOf, type GameState } from './core/game';
import { Guide } from './core/guide';
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
/**
 * 되돌리기용. 수를 두거나 시점을 돌리기 직전의 상태를 쌓는다.
 * 뒤집히는 칸은 한 번 밟으면 되돌릴 수 없어서, 긴 퍼즐 판에서 한 수 실수로 처음부터 다시 하지 않게 한다.
 */
const history: GameState[] = [];
/**
 * 지금 판의 길잡이. 판을 불러온 직후 한가할 때 짓는다 — 판이 드러나는 연출을 끊지 않으려고.
 * 그 전에 물으면 그 자리에서 짓는다.
 */
let guide: Guide | null = null;
/** 이번 상태에서 힌트를 물었는지. 수를 두면 도로 거둔다. */
let asked = false;

function guideNow(): Guide {
  guide ??= new Guide(state.stage);
  return guide;
}

/** 수를 둘 때마다 부른다. 갇혔는지 보고, 힌트를 물었으면 다음 수를 띄운다. */
function refreshGuide(): void {
  const g = guideNow();
  const stuck = g.stuck(state);
  hud.showGuide(stuck, asked && !stuck ? g.next(state) : null, g.remaining(state));
}

/** 상태가 바뀐 뒤 공통으로 할 일 */
function changed(): void {
  asked = false;
  refreshGuide();
}

function hint(): void {
  sfx.unlock();
  if (state.cleared) return;
  asked = true;
  refreshGuide();
}

function stageAt(i: number) {
  const stage = STAGES[i];
  if (!stage) throw new Error(`${i}번 스테이지가 없다`);
  return stage;
}

const hud = new Hud({
  move: (s) => move(s),
  turn: (d) => turn(d),
  restart: () => load(index),
  undo: () => undo(),
  hint: () => hint(),
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
world.onFlip = () => sfx.flip();
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
  history.length = 0;
  world.setStage(state);
  // 판이 크면 카메라가 쭉 물러나며 전체를 드러낸다. 바람 소리를 거기 얹는다.
  if (world.revealing) sfx.wind(2.1);
  hud.setStage(i, STAGES.length, state.stage, STAGES.map((s) => s.name));
  hud.setStatus(state);
  hud.hideClear();

  guide = null;
  asked = false;
  hud.showGuide(false, null, null);
  const stage = state.stage;
  setTimeout(() => {
    if (state.stage !== stage || guide) return;
    guide = new Guide(stage);
    refreshGuide();
  }, 60);
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
  if (next !== state) history.push(state);
  state = next;
  world.play(outcomes);
  world.sync(state);
  hud.setStatus(state);
  // 튕긴 걸음은 상태가 그대로라 띄워 둔 힌트도 그대로 둔다
  if (outcomes.some((o) => o.kind === 'move')) changed();
}

function turn(d: Turn): void {
  sfx.unlock();
  if (world.busy) return;
  history.push(state);
  state = rotate(state, d);
  world.turn(d, state.view);
  world.sync(state);
  hud.setStatus(state);
  sfx.turn();
  changed();
}

/** 한 수 되돌린다. 걸음이든 시점 전환이든 한 번에 하나씩. */
function undo(): void {
  sfx.unlock();
  if (world.busy || state.cleared) return;
  const prev = history.pop();
  if (!prev) return;
  state = prev;
  world.restore(state);
  hud.setStatus(state);
  sfx.turn();
  changed();
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
    case 'z': case 'Z': case 'ㅋ': case 'Backspace': undo(); break;
    case 'h': case 'H': case 'ㅗ': hint(); break;
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
/** 세로로 끌 때 기울어지는 정도. 가로보다 조금 둔하게 — 보기만 하는 거니까. */
const PITCH_PER_PX = 1 / 320;
let touch: { id: number; x: number; y: number; dragging: boolean } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  if (!touch.dragging) {
    if (Math.hypot(dx, dy) < DRAG_START || world.busy || state.cleared) return;
    touch.dragging = true;
    world.beginDrag();
  }
  // 아래로 끌면 위에서 내려다본다
  world.dragBy(-dx * RAD_PER_PX, dy * PITCH_PER_PX);
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
  if (turns !== 0) history.push(state);
  for (let i = 0; i < Math.abs(turns); i += 1) state = rotate(state, d);
  if (turns !== 0) {
    world.sync(state);
    sfx.turn();
    hud.setStatus(state);
    changed();
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
