import { writeFileSync } from 'node:fs';
import { analyze, show, KEYS } from './engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const SEED = +(args.seed ?? 1);
const ITERS = +(args.iters ?? 20000);
const MAXN = +(args.maxn ?? 30);
const MAXF = +(args.maxf ?? 7);
const MAXS = +(args.maxs ?? 3);
const W = +(args.w ?? 5), D = +(args.d ?? 5), H = +(args.h ?? 8);
const WN = +(args.wn ?? 1.0), WT = +(args.wt ?? 1.0), WH = +(args.wh ?? 1.0);
const OUT = args.out;
const ROTW = +(args.rotw ?? 0.5), CAP = +(args.cap ?? 60), LMAX = +(args.lmax ?? 80);
const TCAP = +(args.tcap ?? 8), WR = +(args.wr ?? 0.5);
const WROT = +(args.wrot ?? 1.5), RR = +(args.rr ?? 0.4), LINK = (args.link ?? '1') === '1';
const GOALTOP = args.goaltop === '1';

let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

const key = (x, y, z) => `${x},${y},${z}`;

function toTiles(level) {
  // 시작 칸이 0번
  const arr = [];
  for (const [k, t] of level) {
    const [x, y, z] = k.split(',').map(Number);
    arr.push({ x, y, z, k: t.k, c: t.c });
  }
  arr.sort((a, b) => (a.x === 0 && a.y === 0 && a.z === 0 ? -1 : b.x === 0 && b.y === 0 && b.z === 0 ? 1 : 0));
  return arr;
}

function score(level) {
  const tiles = toTiles(level);
  // 흩어진 돌무더기가 아니라 계단·테라스로 읽히도록: 모든 칸이 이웃(가로세로 한 칸, 높이 ±1)을 가진다
  if (LINK) {
    for (const a of tiles) {
      const near = tiles.some((b) => b !== a && Math.abs(b.x - a.x) + Math.abs(b.z - a.z) === 1 && Math.abs(b.y - a.y) <= 1);
      if (!near) return { sc: -Infinity };
    }
  }
  const goal = tiles.find((t) => t.k === 'g');
  // 방 모드: 출구(문)는 맨 위층에만
  if (GOALTOP && goal.y !== H - 1) return { sc: -Infinity };
  const r = analyze(tiles);
  if (!r || !r.solvable) return { sc: -Infinity };
  // 읽을 수 있는 퍼즐: 회전은 반값, 너무 길면 벌점, 함정은 몇 개까지만, 같은 칸을 다른 상태로 다시 밟는 것에 가산
  const lw = r.moves + ROTW * r.rots - WROT * Math.max(0, r.rots - RR * r.moves);
  const sc = Math.min(lw, CAP) - 2 * Math.max(0, r.L - LMAX) - WN * tiles.length
    + WT * Math.min(r.traps, TCAP) + WH * goal.y + WR * (r.moves - r.distinct);
  return { sc, r, tiles };
}

function stackOk(level, x, y, z) {
  return !level.has(key(x, y + 1, z)) && !level.has(key(x, y - 1, z));
}

function mutate(level) {
  const next = new Map(level);
  const entries = [...next.keys()];
  const counts = { p: 0, s: 0 };
  for (const t of next.values()) if (t.k in counts) counts[t.k]++;
  const op = rnd();
  const randomKind = () => {
    const u = rnd();
    if (u < 0.55) return 'f';
    if (u < 0.85 && counts.p < MAXF) return 'p';
    if (counts.s < MAXS) return 's';
    return 'f';
  };
  if (op < 0.4 && next.size < MAXN) {
    const [x0, y0, z0] = pick(entries).split(',').map(Number);
    const x = x0 + Math.floor(rnd() * 5) - 2, y = y0 + Math.floor(rnd() * 3) - 1, z = z0 + Math.floor(rnd() * 5) - 2;
    if (x < 0 || x >= W || z > 0 || z <= -D || y < 0 || y >= H) return null;
    if (next.has(key(x, y, z)) || !stackOk(next, x, y, z)) return null;
    next.set(key(x, y, z), { k: randomKind(), c: rnd() < 0.5 ? 0 : 1 });
  } else if (op < 0.6) {
    const k = pick(entries);
    const t = next.get(k);
    if (k === '0,0,0' || t.k === 'g') return null;
    next.delete(k);
  } else if (op < 0.85) {
    const k = pick(entries);
    const t = next.get(k);
    if (k === '0,0,0') return null;
    if (t.k === 'g') next.set(k, { k: 'g', c: 1 - t.c });
    else if (rnd() < 0.5) next.set(k, { k: t.k, c: 1 - t.c });
    else next.set(k, { k: randomKind(), c: t.c });
  } else {
    // 칸 하나를 옮긴다
    const k = pick(entries);
    if (k === '0,0,0') return null;
    const t = next.get(k);
    const [x0, y0, z0] = k.split(',').map(Number);
    const x = x0 + Math.floor(rnd() * 3) - 1, y = y0 + Math.floor(rnd() * 3) - 1, z = z0 + Math.floor(rnd() * 3) - 1;
    if (x < 0 || x >= W || z > 0 || z <= -D || y < 0 || y >= H) return null;
    next.delete(k);
    if (next.has(key(x, y, z)) || !stackOk(next, x, y, z)) return null;
    next.set(key(x, y, z), t);
  }
  return next;
}

let level = GOALTOP
  ? new Map(Array.from({ length: H }, (_, j) => [`${j},${j},0`, { k: j === H - 1 ? 'g' : 'f', c: 0 }]))
  : new Map([
      ['0,0,0', { k: 'f', c: 0 }],
      ['1,0,0', { k: 'g', c: 0 }],
    ]);
let cur = score(level);
let best = cur;
for (let it = 0; it < ITERS; it++) {
  const cand = mutate(level);
  if (!cand) continue;
  const sc = score(cand);
  if (sc.sc === -Infinity) continue;
  const T = 4 * (1 - it / ITERS) + 0.15;
  if (sc.sc >= cur.sc || rnd() < Math.exp((sc.sc - cur.sc) / T)) {
    level = cand;
    cur = sc;
    if (sc.sc > best.sc) best = sc;
  }
}
const r = best.r;
const report = {
  seed: SEED, score: best.sc, L: r.L, moves: r.moves, rots: r.rots, n: r.n, flips: r.flips,
  distinct: r.distinct, traps: r.traps, R: r.R, deadFrac: +r.deadFrac.toFixed(3),
  path: r.path.map((m) => KEYS[m]).join(''), tiles: best.tiles,
};
const text = `seed ${SEED} score ${best.sc.toFixed(1)} L ${r.L} (move ${r.moves} rot ${r.rots}) n ${r.n} flips ${r.flips} distinct ${r.distinct} traps ${r.traps} R ${r.R} dead ${report.deadFrac}\n${report.path}\n${show(best.tiles)}\n`;
console.log(text);
if (OUT) writeFileSync(OUT, JSON.stringify(report));
