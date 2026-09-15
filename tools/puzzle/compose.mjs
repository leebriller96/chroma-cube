// 퍼즐 방 여러 개를 높이별로 쌓고 계단으로 잇는다. 합친 판을 통째로 풀어 질러가는 길이 없는지 본다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { analyze, show, toCells, KEYS } from './engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const DIRS = (args.dirs ?? 'rooms').split(',');
const K = +(args.k ?? 3);
const TRIALS = +(args.trials ?? 4000);
const LO = +(args.lo ?? 55), HI = +(args.hi ?? 80);
const MINTRAPS = +(args.mintraps ?? 3);
const ONLY = args.only ? args.only.split(',') : null;
let s = +(args.seed ?? 7) >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

const pool = [];
for (const dir of DIRS) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rep = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    const id = `${dir}/${rep.seed}`;
    if (ONLY && !ONLY.includes(id)) continue;
    if (rep.traps < MINTRAPS) continue;
    pool.push({ id, L: rep.L, tiles: rep.tiles.map((t, i) => ({ ...t, start: i === 0 })) });
  }
}
console.log('pool', pool.length);

/** 방을 y 축으로 rot 번 90° 돌리고, swap 이면 두 색을 맞바꾼다 */
function transform(room, rot, swap) {
  return room.tiles.map((t) => {
    let u = t.x, w = -t.z;
    for (let r = 0; r < rot; r++) [u, w] = [w, 3 - u];
    return { ...t, x: u, z: -w, c: swap ? 1 - t.c : t.c };
  });
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (t) => `${t.x},${t.y},${t.z}`;

function build(seq) {
  const all = [];
  const cells = new Map();
  const put = (t) => {
    if (cells.has(key(t))) return false;
    if (cells.has(`${t.x},${t.y + 1},${t.z}`) || cells.has(`${t.x},${t.y - 1},${t.z}`)) return false;
    cells.set(key(t), t);
    all.push(t);
    return true;
  };
  let color = 0;
  let exit = null;
  for (let k = 0; k < seq.length; k++) {
    const { room, rot } = seq[k];
    const local = transform(room, rot, color === 1);
    const st = local.find((t) => t.start);
    let off;
    if (k === 0) off = { x: -st.x, y: 0, z: -st.z };
    else {
      const [a, b] = seq[k].d1, [c, d] = seq[k].d2;
      if (a === -c && b === -d) return null;
      const T = { x: exit.x + a, y: exit.y + 1, z: exit.z + b, k: 'f', c: exit.c, room: k - 0.5 };
      if (!put(T)) return null;
      const S = { x: T.x + c, y: T.y + 1, z: T.z + d };
      off = { x: S.x - st.x, y: S.y - st.y, z: S.z - st.z };
    }
    let goal = null;
    for (const t of local) {
      const w = { x: t.x + off.x, y: t.y + off.y, z: t.z + off.z, k: t.k, c: t.c, room: k, start: k === 0 && t.start };
      if (t.k === 'g') {
        goal = w;
        if (k < seq.length - 1) w.k = 'f';
      }
      if (!put(w)) return null;
    }
    exit = goal;
    color = goal.c;
  }
  // 지도 규칙(x ≥ 0, z ≤ 0)에 맞게 옮긴다
  const mx = Math.min(...all.map((t) => t.x)), mz = Math.max(...all.map((t) => t.z));
  for (const t of all) { t.x -= mx; t.z -= mz; }
  all.sort((p, q) => (q.start ? 1 : 0) - (p.start ? 1 : 0));
  return all;
}

const results = [];
const seen = new Set();
for (let trial = 0; trial < TRIALS; trial++) {
  const rooms = [];
  while (rooms.length < K) {
    const r = pick(pool);
    if (!rooms.includes(r)) rooms.push(r);
  }
  const seq = rooms.map((room) => ({ room, rot: Math.floor(rnd() * 4), d1: pick(DIRS4), d2: pick(DIRS4) }));
  const tiles = build(seq);
  if (!tiles) continue;
  const sig = seq.map((q) => `${q.room.id}:${q.rot}:${q.d1}:${q.d2}`).join('|');
  if (seen.has(sig)) continue;
  seen.add(sig);
  const r = analyze(tiles);
  if (!r || !r.solvable) continue;
  const expected = rooms.reduce((a, q) => a + q.L, 0) + 2 * (K - 1);
  const shortcut = expected - r.L;
  if (shortcut > 4 || r.L < LO || r.L > HI) continue;
  const W = Math.max(...tiles.map((t) => t.x)) + 1, D = Math.max(...tiles.map((t) => -t.z)) + 1;
  results.push({ sig, L: r.L, expected, moves: r.moves, rots: r.rots, traps: r.traps, W, D, H: Math.max(...tiles.map((t) => t.y)) + 1, tiles, path: r.path.map((m) => KEYS[m]).join('') });
}
// 좁고 높은 탑일수록 좋다
results.sort((a, b) => a.W * a.D - b.W * b.D || b.L - a.L);
console.log('found', results.length);
for (const res of results.slice(0, +(args.show ?? 3))) {
  console.log(`\nL ${res.L} (expected ${res.expected}) move ${res.moves} rot ${res.rots} traps ${res.traps} ${res.W}x${res.D}x${res.H}\n${res.sig}\n${res.path}`);
}
if (args.out) writeFileSync(args.out, JSON.stringify(results.slice(0, 20).map((r) => ({ ...r, cells: toCells(r.tiles) }))));
if (args.print) console.log(show(results[0].tiles));
