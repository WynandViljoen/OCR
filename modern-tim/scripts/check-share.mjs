/**
 * Server check for share.php (needs `php` on the PATH, skips if missing).
 *   npm run check-share
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (spawnSync('php', ['-v']).error) {
  console.log('-  php is not installed here, skipping check-share');
  process.exit(0);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'tim-share-'));
copyFileSync(join(root, 'share.php'), join(dir, 'share.php'));
const port = 19000 + Math.floor(Math.random() * 1000);
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/share.php`;
let passed = 0;
const post = async (body) => {
  const r = await fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const good = { id: 1, type: 'ball', x: 100, y: 50, angle: 0 };
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`OK ${name}`);
}
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  let code;
  await check('a build is stored and read back with the same parts', async () => {
    const parts = [good, { id: 2, type: 'spring', x: 5, y: 6, angle: 0.5, power: 2, flip: true, props: { mass: 3.5 } }, { id: 3, type: 'string', x: 0, y: 0, angle: 0, link: { a: 1, b: 2 } }];
    const r = await post({ title: ' My <b>build ', author: 'Ana', version: '0.3', parts });
    assert.equal(r.status, 200);
    assert.match(r.json.code, /^[A-Za-z0-9]{8}$/);
    code = r.json.code;
    const got = await (await fetch(`${url}?c=${code}`)).json();
    assert.equal(got.title, 'My b build');
    assert.equal(got.author, 'Ana');
    assert.deepEqual(got.parts, parts);
  });
  await check('unknown, bad and path-like codes are refused', async () => {
    assert.equal((await fetch(`${url}?c=Zz9Zz9Zz`)).status, 404);
    assert.equal((await fetch(`${url}?c=../../x`)).status, 400);
    assert.equal((await fetch(`${url}?c=short`)).status, 400);
  });
  await check('bad parts, empty boards and junk are refused', async () => {
    assert.equal((await post({ parts: [{ ...good, type: 'bomb' }] })).status, 400);
    assert.equal((await post({ parts: [{ ...good, x: 99999 }] })).status, 400);
    assert.equal((await post({ parts: [{ ...good, x: 'a' }] })).status, 400);
    assert.equal((await post({ parts: [{ ...good, props: { 'a b': 1 } }] })).status, 400);
    assert.equal((await post({ parts: [] })).status, 400);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post({ parts: Array.from({ length: 301 }, (_, i) => ({ ...good, id: i })) })).status, 400);
  });
  await check('extra fields are dropped, not stored', async () => {
    const r = await post({ title: 'x', parts: [{ ...good, evil: '<script>', props: undefined }] });
    const got = await (await fetch(`${url}?c=${r.json.code}`)).json();
    assert.equal(JSON.stringify(got).includes('script'), false);
  });
  await check('a huge body is refused', async () => {
    const r = await post({ title: 'x'.repeat(70000), parts: [good] });
    assert.equal(r.status, 413);
  });
  await check('data folder is closed to the web and the limit is 20 per hour', async () => {
    assert.ok(existsSync(join(dir, 'tim-data', '.htaccess')));
    assert.match(readFileSync(join(dir, 'tim-data', '.htaccess'), 'utf8'), /denied|Deny/i);
    let last;
    for (let i = 0; i < 25; i++) last = await post({ title: 'r', parts: [good] });
    assert.equal(last.status, 429);
  });
  console.log(`${passed} checks passed`);
} finally {
  server.kill();
}
