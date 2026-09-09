import type { Step, Turn } from '../core/types';
import type { GameState } from '../core/game';
import { merged, unsealed } from '../core/game';
import type { Stage } from '../core/stage';

export interface HudHandlers {
  readonly move: (step: Step) => void;
  readonly turn: (d: Turn) => void;
  readonly restart: () => void;
  readonly next: () => void;
  /** 아무 판으로나 건너뛴다. 위쪽 점을 누르면 여기로 온다. */
  readonly jump: (index: number) => void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} 가 없다`);
  return found as T;
};

const make = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class Hud {
  private readonly hint = el('hint');
  private readonly banner = el('banner');
  private readonly legend = el('legend');
  private readonly dots = make('div', 'dots');
  private readonly title = make('strong');
  private readonly tip = make('span', 'tip');
  private readonly chips = make('span', 'chips');
  private readonly count = make('span', 'count');
  private readonly note = make('span', 'rule');
  private readonly jump: (index: number) => void;

  constructor(handlers: HudHandlers) {
    this.jump = handlers.jump;
    const ui = el('ui');
    ui.append(this.dots);

    this.hint.append(this.title, this.tip);
    this.legend.append(this.chips, this.note, this.count);
    this.legend.append(make('span', 'keys', '← → 이동 · A D 시점 · [ ] 판 넘기기 · R 다시'));

    const pad = make('div', 'pad');
    const buttons: readonly [string, string, () => void][] = [
      ['↺', '시점 왼쪽 (A)', () => handlers.turn(-1)],
      ['◀', '왼쪽으로 (←)', () => handlers.move(-1)],
      ['▶', '오른쪽으로 (→)', () => handlers.move(1)],
      ['↻', '시점 오른쪽 (D)', () => handlers.turn(1)],
    ];
    for (const [glyph, label, fn] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = glyph;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      pad.append(b);
    }
    ui.append(pad);

    this.banner.addEventListener('click', () => handlers.next());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') handlers.restart();
    });
  }

  setStage(index: number, total: number, stage: Stage, names: readonly string[]): void {
    this.title.textContent = stage.name;
    this.tip.textContent = stage.hint;

    // 점 하나가 판 하나다. 눌러서 바로 건너뛴다.
    this.dots.replaceChildren();
    for (let i = 0; i < total; i += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      if (i < index) dot.className = 'done';
      if (i === index) dot.className = 'now';
      dot.title = `${i + 1}. ${names[i] ?? ''}`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => this.jump(i));
      this.dots.append(dot);
    }

    // 스테이지가 바뀔 때마다 제목이 살짝 떠오르게
    this.hint.classList.remove('enter');
    void this.hint.offsetWidth;
    this.hint.classList.add('enter');
  }

  setStatus(state: GameState): void {
    const live = state.pieces.filter((p) => !p.done);
    this.chips.replaceChildren(
      ...state.pieces.flatMap((p, i) => {
        if (p.done) return [];
        const now = state.stage.relay && i === state.active;
        const label = (p.side === 'under' ? '아래 ' : '') + (p.color === 'blue' ? '파랑' : '빨강');
        return [make('span', `chip ${p.color}${now ? ' now' : ''}`, label)];
      }),
    );

    this.legend.classList.toggle('relay', state.stage.relay);
    const aligned = unsealed(state.stage, state.view);
    const together = merged(state);
    // 문이 열리는 조건은 늘 하나다 — 고리가 이어질 것. 조각을 겹치든, 두 몸을 포개든.
    const gated = state.stage.sealed || live.length > 1;
    const open = aligned && together;
    this.note.textContent = !gated
      ? '같은 색 칸만 밟는다'
      : open
        ? '고리가 이어졌다 — 문이 열렸다'
        : !together
          ? '고리가 반씩 갈렸다 — 두 몸을 한 칸에 포개라'
          : '고리가 끊겼다 — 조각을 한 줄로 겹쳐라';
    this.note.classList.toggle('open', gated && open);
    this.count.textContent = `${state.moves} 걸음`;
  }

  showClear(isLast: boolean): void {
    this.banner.replaceChildren(
      make('strong', undefined, isLast ? '전부 클리어!' : '클리어!'),
      make('span', undefined, isLast ? '아무 키나 눌러 처음부터' : '아무 키나 눌러 다음 스테이지'),
    );
    this.banner.classList.add('on');
  }

  hideClear(): void {
    this.banner.classList.remove('on');
  }
}
