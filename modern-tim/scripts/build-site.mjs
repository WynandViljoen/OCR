// Builds the standalone page for a normal web server (the repo-root index.html).
// Same game as build-single.mjs, wrapped as a complete HTML document (doctype, charset, viewport).
//   node scripts/build-site.mjs ../index.html
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, '..', 'index.html'));
const tmp = path.join(os.tmpdir(), `modern-tim-single-${process.pid}.html`);

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-single.mjs'), tmp, ...process.argv.slice(3)], { stdio: 'ignore' });
const inner = fs.readFileSync(tmp, 'utf8');
fs.rmSync(tmp, { force: true });

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${inner}</body>
</html>
`;
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
