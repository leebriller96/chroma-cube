import { CanvasTexture, Color, LinearFilter, SRGBColorSpace } from 'three';
import { css, type Ink } from './palette';

/** 가운데가 밝고 가장자리로 사라지는 원. 별·빛무리에 쓴다. 이미지 파일 대신 캔버스로 만든다. */
export function softDot(size = 64, core = 0.18): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(core, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 위가 진한 보랏빛, 아래가 살구빛인 하늘. 배경으로 깐다. */
export function skyTexture(top: Color, low: Color): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, css(top));
    grad.addColorStop(0.46, css(top.clone().lerp(low, 0.45)));
    grad.addColorStop(0.82, css(top.clone().lerp(low, 0.9)));
    grad.addColorStop(1, css(low));
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const drips = new Map<string, CanvasTexture>();

/**
 * 스위치 칸 옆면. 상아색 돌 위쪽에 스위치 색 물감이 칠해져 있고, 아래로 뚝뚝 흘러내린다.
 * "밟으면 이 색으로 물든다"를 글자 없이 모양으로 말한다.
 */
export function dripTexture(stone: Ink, paint: Ink): CanvasTexture {
  const key = css(stone.mid) + '~' + css(paint.mid);
  const cached = drips.get(key);
  if (cached) return cached;

  const w = 64;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) {
    const band = (from: number, to: number, color: string): void => {
      g.fillStyle = color;
      g.fillRect(0, Math.round(from * h), w, Math.round((to - from) * h));
    };
    band(0, 0.13, css(stone.light));
    band(0.13, 0.86, css(stone.mid));
    band(0.86, 1, css(stone.dark));

    // 윗단을 덮은 물감과, 거기서 흘러내린 자국. 굵기와 길이를 조금씩 달리해 손으로 부은 것처럼.
    const flows: readonly (readonly [x: number, half: number, length: number])[] = [
      [0.12, 0.085, 0.47],
      [0.35, 0.055, 0.3],
      [0.58, 0.1, 0.64],
      [0.84, 0.065, 0.39],
    ];
    g.fillStyle = css(paint.mid);
    g.fillRect(0, 0, w, Math.round(h * 0.19));
    for (const [cx, half, length] of flows) {
      const x = cx * w;
      const r = half * w;
      const bottom = length * h;
      g.beginPath();
      g.moveTo(x - r, 0);
      g.lineTo(x - r, bottom - r);
      g.arc(x, bottom - r, r, Math.PI, 0, true);
      g.lineTo(x + r, 0);
      g.closePath();
      g.fill();
    }
    // 물감의 윤기. 윗단 한 줄과 흘러내린 자국마다 가는 빛줄기.
    g.fillStyle = css(paint.light);
    g.fillRect(0, 0, w, Math.round(h * 0.045));
    for (const [cx, half, length] of flows) {
      const r = half * w;
      g.fillRect(cx * w - r * 0.55, h * 0.06, Math.max(1.5, r * 0.32), length * h - r * 1.9 - h * 0.06);
    }
    // 물감 윗단 아래 그늘 한 줄
    g.fillStyle = css(paint.dark, 0.45);
    g.fillRect(0, Math.round(h * 0.19), w, 2);

    g.fillStyle = 'rgba(28,20,52,0.24)';
    g.fillRect(0, 0, 1, h);
    g.fillRect(w - 1, 0, 1, h);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  drips.set(key, tex);
  return tex;
}

const slabs = new Map<string, CanvasTexture>();

/**
 * 발판 옆면 한 장. 조명이 없으니 명암을 아예 그려 넣는다.
 * 위에서부터 빛 받은 띠 · 몸통 · 그림자 아랫단.
 * under 를 주면 아랫절반을 반대 잉크로 칠한다 — 발판 뒤집힌 쪽의 색이 겉에서 바로 보이도록.
 */
export function slabTexture(top: Ink, under?: Ink): CanvasTexture {
  const key = css(top.mid) + (under ? '/' + css(under.mid) : '');
  const cached = slabs.get(key);
  if (cached) return cached;

  const h = 128;
  const w = 16;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const fill = (from: number, to: number, color: string): void => {
    if (!g) return;
    g.fillStyle = color;
    g.fillRect(0, Math.round(from * h), w, Math.round((to - from) * h));
  };

  // 띠는 뚝뚝 끊어 칠한다. 그라데이션으로 뭉개면 플라스틱처럼 보이고,
  // 딱 떨어지는 면으로 나눠야 돌을 깎아 쌓은 건축물로 읽힌다.
  if (under) {
    // 위아래를 거울처럼 칠한다. 뒤집어 보면 반대쪽이 똑같이 빛 받은 발판이 된다.
    fill(0, 0.11, css(top.light));
    fill(0.11, 0.45, css(top.mid));
    fill(0.45, 0.5, css(top.dark));
    fill(0.5, 0.55, css(under.dark));
    fill(0.55, 0.89, css(under.mid));
    fill(0.89, 1, css(under.light));
  } else {
    fill(0, 0.13, css(top.light));
    fill(0.13, 0.86, css(top.mid));
    fill(0.86, 1, css(top.dark));
  }

  // 좌우 모서리를 살짝 죽이고 왼쪽에만 빛을 물린다. 해가 왼쪽에 걸려 있으니까.
  // 이 한 줄 덕분에 나란히 붙은 발판들이 한 덩어리로 뭉치지 않고 돌 하나하나로 읽힌다.
  if (g) {
    g.fillStyle = 'rgba(28,20,52,0.24)';
    g.fillRect(0, 0, 1, h);
    g.fillRect(w - 1, 0, 1, h);
    g.fillStyle = 'rgba(255,252,246,0.13)';
    g.fillRect(1, 0, 1, h);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  slabs.set(key, tex);
  return tex;
}
