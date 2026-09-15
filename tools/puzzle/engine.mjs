// 게임 규칙(src/core/game.ts)의 빠른 복제본. floor / flip / switch / goal, 큐브 하나, 윗면만.
// 칸: {x,y,z,k:'f'|'p'|'s'|'g',c:0 blue|1 red}
export const sx = (v, x, z) => (v === 0 ? x : v === 1 ? -z : v === 2 ? -x : z);
export const dp = (v, x, z) => (v === 0 ? -z : v === 1 ? -x : v === 2 ? z : x);

export function compile(tiles) {
  const n = tiles.length;
  let fb = 0;
  const bit = tiles.map((t) => (t.k === 'p' ? fb++ : -1));
  const tgt = new Int32Array(n * 8).fill(-1);
  for (let i = 0; i < n; i++) {
    const a = tiles[i];
    for (let v = 0; v < 4; v++) {
      for (let s = 0; s < 2; s++) {
        const col = sx(v, a.x, a.z) + (s ? 1 : -1);
        for (const dy of [0, 1, -1]) {
          let best = -1;
          for (let j = 0; j < n; j++) {
            const b = tiles[j];
            if (b.y !== a.y + dy || sx(v, b.x, b.z) !== col) continue;
            if (best < 0 || dp(v, b.x, b.z) < dp(v, tiles[best].x, tiles[best].z)) best = j;
          }
          if (best >= 0) { tgt[(i * 4 + v) * 2 + s] = best; break; }
        }
      }
    }
  }
  return { tiles, n, bit, flips: fb, tgt };
}

/**
 * 전체 도달 가능 상태를 BFS 로 훑고, 문까지의 거리(d2g)도 거꾸로 센다.
 * move 부호: 0 ←, 1 →, 2 A, 3 D
 */
export function analyze(tiles, start = { i: 0, c: 0, v: 0 }) {
  const C = compile(tiles);
  const { n, bit, tgt } = C;
  const F = 1 << C.flips;
  const S = n * 8 * F;
  if (S > 40_000_000) return null;
  const dist = new Int32Array(S).fill(-1);
  const parent = new Int32Array(S);
  const pmove = new Int8Array(S);
  const queue = new Int32Array(S);
  const enc = (i, c, v, f) => ((i * 2 + c) * 4 + v) * F + f;
  const s0 = enc(start.i, start.c, start.v, 0);
  dist[s0] = 0;
  let qh = 0, qt = 0;
  queue[qt++] = s0;
  const succ = new Int32Array(4);
  let goalFrom = -1, goalMove = -1;
  const step = (st, out) => {
    const f = st % F; let r = (st - f) / F;
    const v = r % 4; r = (r - v) / 4;
    const c = r % 2; const i = (r - c) / 2;
    for (let s = 0; s < 2; s++) {
      out[s] = -1;
      const j = tgt[(i * 4 + v) * 2 + s];
      if (j < 0) continue;
      const t = tiles[j];
      let nc = c;
      if (t.k === 's') nc = t.c;
      else {
        const face = t.k === 'p' ? t.c ^ ((f >> bit[j]) & 1) : t.c;
        if (face !== c) continue;
      }
      if (t.k === 'g') { out[s] = -2; continue; }
      const nf = bit[i] >= 0 ? f ^ (1 << bit[i]) : f;
      out[s] = enc(j, nc, v, nf);
    }
    out[2] = enc(i, c, (v + 3) % 4, f);
    out[3] = enc(i, c, (v + 1) % 4, f);
  };
  while (qh < qt) {
    const st = queue[qh++];
    step(st, succ);
    for (let m = 0; m < 4; m++) {
      const nx = succ[m];
      if (nx === -2) { if (goalFrom < 0) { goalFrom = st; goalMove = m; } continue; }
      if (nx < 0 || dist[nx] >= 0) continue;
      dist[nx] = dist[st] + 1; parent[nx] = st; pmove[nx] = m;
      queue[qt++] = nx;
    }
  }
  const R = qt;
  if (goalFrom < 0) return { solvable: false, R };
  const L = dist[goalFrom] + 1;
  const path = [goalMove];
  const states = [];
  for (let st = goalFrom; st !== s0; st = parent[st]) { path.push(pmove[st]); states.push(st); }
  states.push(s0);
  path.reverse(); states.reverse();

  // 거꾸로: 문까지 거리
  const idx = new Map();
  // reached 상태에 번호. dist 배열 재활용: 번호 = queue 위치
  const order = new Int32Array(S).fill(-1);
  for (let q = 0; q < R; q++) order[queue[q]] = q;
  const edges = new Int32Array(R * 4).fill(-1);
  const indeg = new Int32Array(R + 1);
  const d2g = new Int32Array(R).fill(-1);
  const rq = new Int32Array(R);
  let rh = 0, rt = 0;
  for (let q = 0; q < R; q++) {
    step(queue[q], succ);
    for (let m = 0; m < 4; m++) {
      const nx = succ[m];
      if (nx === -2) { if (d2g[q] < 0) { d2g[q] = 1; rq[rt++] = q; } continue; }
      if (nx < 0) continue;
      const o = order[nx];
      edges[q * 4 + m] = o;
      indeg[o + 1]++;
    }
  }
  for (let q = 0; q < R; q++) indeg[q + 1] += indeg[q];
  const pred = new Int32Array(indeg[R]);
  const fill = indeg.slice();
  for (let q = 0; q < R; q++) for (let m = 0; m < 4; m++) { const o = edges[q * 4 + m]; if (o >= 0) pred[fill[o]++] = q; }
  while (rh < rt) {
    const q = rq[rh++];
    for (let e = indeg[q]; e < indeg[q + 1]; e++) {
      const p = pred[e];
      if (d2g[p] < 0) { d2g[p] = d2g[q] + 1; rq[rt++] = p; }
    }
  }
  let dead = 0;
  for (let q = 0; q < R; q++) if (d2g[q] < 0) dead++;
  // 경로 위 함정: 한 수에 죽은 상태로 빠지는 갈림
  let traps = 0, detours = 0, moves = 0, rots = 0;
  const visited = new Set();
  for (let p = 0; p < states.length; p++) {
    const q = order[states[p]];
    let trap = false, detour = false;
    for (let m = 0; m < 2; m++) {
      const o = edges[q * 4 + m];
      if (o < 0) continue;
      if (d2g[o] < 0) trap = true;
    }
    if (trap) traps++;
    const m = path[p];
    if (m < 2) moves++; else rots++;
    const st = states[p];
    const f = st % F; let r = (st - f) / F; r = (r - (r % 4)) / 4; const i = (r - (r % 2)) / 2;
    visited.add(i);
  }
  return { solvable: true, R, L, path, states, dead, deadFrac: dead / R, traps, moves, rots, distinct: visited.size, flips: C.flips, n, F };
}

export const KEYS = ['←', '→', 'A', 'D'];

export function toCells(tiles) {
  const glyph = (t) => (t.c ? 'r' : 'b') + { f: '.', p: '/', s: '!', g: '*' }[t.k];
  return tiles.map((t) => [t.x, t.y, t.z, glyph(t)]);
}

export function show(tiles) {
  const xs = tiles.map((t) => t.x), zs = tiles.map((t) => -t.z), ys = tiles.map((t) => t.y);
  const W = Math.max(...xs) + 1, D = Math.max(...zs) + 1;
  const out = [];
  for (let y = Math.max(...ys); y >= Math.min(...ys); y--) {
    const grid = Array.from({ length: D }, () => Array(W).fill('..'));
    let any = false;
    for (const t of tiles) if (t.y === y) { grid[-t.z][t.x] = (t.c ? 'r' : 'b') + { f: '.', p: '/', s: '!', g: '*' }[t.k]; any = true; }
    if (any) out.push(`y=${y}\n` + grid.map((r) => '  ' + r.join(' ')).join('\n'));
  }
  return out.join('\n');
}
