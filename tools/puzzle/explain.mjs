// 해답 경로를 한 수씩 재생해 사람이 읽을 수 있게 풀어 쓴다
import { readFileSync } from 'node:fs';
import { analyze, compile, show } from './engine.mjs';

const file = process.argv[2];
const rep = JSON.parse(readFileSync(file, 'utf8'));
const tiles = rep.tiles;
const r = analyze(tiles);
const C = compile(tiles);
const F = 1 << C.flips;
const dec = (st) => {
  const f = st % F; let q = (st - f) / F;
  const v = q % 4; q = (q - v) / 4;
  const c = q % 2; const i = (q - c) / 2;
  return { i, c, v, f };
};
const name = (i) => {
  const t = tiles[i];
  return `${(t.c ? 'r' : 'b') + { f: '.', p: '/', s: '!', g: '*' }[t.k]}(${t.x},${t.y},${t.z})`;
};
const flipIds = tiles.map((t, i) => [t, i]).filter(([t]) => t.k === 'p').map(([, i]) => i);
console.log(show(tiles));
console.log('flip tiles:', flipIds.map(name).join(' '));
console.log(`L ${r.L} moves ${r.moves} rots ${r.rots}`);
let line = [];
let prev = null;
for (let p = 0; p < r.states.length; p++) {
  const s = dec(r.states[p]);
  const m = ['←', '→', 'A', 'D'][r.path[p]];
  if (!prev || prev.v !== s.v) {
    if (line.length) console.log(line.join(' '));
    line = [`[v${s.v} ${s.c ? 'RED ' : 'BLUE'} flips ${s.f.toString(2).padStart(C.flips, '0')}] ${name(s.i)}`];
  } else if (prev.i !== s.i || prev.c !== s.c) {
    line.push(`${prevMove} ${name(s.i)}${prev.c !== s.c ? (s.c ? '=>RED' : '=>BLUE') : ''}`);
  }
  prev = s;
  var prevMove = m;
}
line.push(`${prevMove} GOAL`);
console.log(line.join(' '));
