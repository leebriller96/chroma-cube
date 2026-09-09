/**
 * dist 를 파일 하나짜리 HTML 로 접는다.
 * 아티팩트는 <head>/<body> 를 스스로 씌우므로 여기서는 알맹이만 뽑아 낸다.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const assets = join(dist, 'assets');
const files = readdirSync(assets);
const js = files.find((f) => f.endsWith('.js'));
const css = files.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('dist/assets 에서 js/css 를 못 찾았다');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();

const out = `<title>Chroma Cube</title>
<style>
html, body { height: 100%; }
${readFileSync(join(assets, css), 'utf8')}
</style>
${body}
<script type="module">
${readFileSync(join(assets, js), 'utf8')}
</script>
`;

const target = process.argv[2];
if (!target) throw new Error('내보낼 경로를 인자로 달라');
writeFileSync(target, out, 'utf8');
console.log(`${target} — ${(out.length / 1024).toFixed(0)}KB`);
