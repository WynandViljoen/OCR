// Bundles the game into ONE self-contained HTML file (no npm needed).
// Matter.js comes from a CDN, or from a local file with --matter=<path>.
//   node scripts/build-single.mjs out.html [--matter=path/to/matter.min.js]
import { stripTypeScriptTypes } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] ?? path.join(root, 'dist-single', 'modern-tim.html');
const matterArg = process.argv.find((a) => a.startsWith('--matter='));
const order = ['game/parts.ts', 'game/mechanics.ts', 'game/levels.ts', 'game/version.ts', 'game/space.ts', 'game/profile.ts', 'game/draw.ts', 'game/world.ts', 'game/ui.ts', 'main.ts'];

let js = '';
for (const f of order) {
  let code = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  code = stripTypeScriptTypes(code, { mode: 'transform' });
  code = code.replace(/^import[\s\S]*?;\s*$/gm, '');
  const names = [];
  code = code.replace(/^export\s+(const|function|class|let)\s+(\w+)/gm, (_m, kw, n) => {
    names.push(n);
    return `${kw} ${n}`;
  });
  js += `\n// ---- ${f} ----\n`;
  js += names.length
    ? `const { ${names.join(', ')} } = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();\n`
    : `(() => {\n${code}\n})();\n`;
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>')).trim();
const body = html.slice(html.indexOf('<div id="app">'), html.indexOf('<script type="module"')).trim();
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const matterTag = matterArg
  ? `<script>${fs.readFileSync(matterArg.slice(9), 'utf8')}</script>`
  : '<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script>';

const page = `${head}
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
${body}
${matterTag}
<script>
${js}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
