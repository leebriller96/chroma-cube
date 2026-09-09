import { Color } from 'three';
import type { ColorId } from '../core/types';

/**
 * Monument Valley 쪽 색. 조명은 아예 쓰지 않고, 면마다 칠해 둔 색만으로 입체를 만든다.
 * 한 잉크는 어두운 쪽 · 몸통 · 밝은 쪽 세 단계를 갖는다.
 */
export interface Ink {
  /** 발판 아랫단. 그림자 노릇을 한다 */
  readonly dark: Color;
  /** 몸통 */
  readonly mid: Color;
  /** 윗면과 윗단의 빛 받은 띠 */
  readonly light: Color;
}

const ink = (dark: number, mid: number, light: number): Ink => ({
  dark: new Color(dark),
  mid: new Color(mid),
  light: new Color(light),
});

export const PALETTE: Readonly<Record<ColorId, Ink>> = {
  blue: ink(0x2f3169, 0x4d55b4, 0x9aa2ee),
  red: ink(0x8e3c31, 0xd9634c, 0xf7a785),
};

/** 문틀과 이어진 고리. 이 게임에서 '열렸다'를 뜻하는 단 하나의 색이다. */
export const GOLD = ink(0xb07c1c, 0xe6a833, 0xffd987);
/** 스위치와 교대 칸처럼 색이 없어야 하는 자리. 따뜻한 상아색. */
export const STONE = ink(0xa8937a, 0xd6c3a8, 0xf7efe1);
/** 아직 아무 색도 정해지지 않은 그림자 칸 */
export const UNPRINTED = ink(0x9d9184, 0xc2b7aa, 0xe2dad0);

/** 하늘. 위가 진한 보랏빛, 아래가 따뜻한 살구빛. */
export const SKY_TOP = new Color(0x7c78bd);
export const SKY_LOW = new Color(0xffd6ad);
/** 지평선 가까이 떠 있는 해 */
export const SUN = new Color(0xfff0d4);

/** 글자 · 표시 · 그림자에 쓰는 가장 진한 색 */
export const DEEP = new Color(0x2b2543);

export const INKS: Readonly<Record<string, Ink>> = {
  blue: PALETTE.blue,
  red: PALETTE.red,
  gold: GOLD,
  stone: STONE,
  unprinted: UNPRINTED,
};

/** 잉크를 캔버스에 쓸 수 있는 css 색으로 */
export const css = (c: Color, alpha = 1): string =>
  alpha >= 1 ? '#' + c.getHexString() : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
