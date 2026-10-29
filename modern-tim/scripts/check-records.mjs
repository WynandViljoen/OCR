/**
 * Server check for the admin "High scores" page (needs `php` on the PATH, skips if missing).
 *
 *   npm run check-records
 *
 * Copies scores.php and admin.php into a temp folder, starts PHP's built-in server and checks that
 * a record is logged only when it is BROKEN (strictly better than the old number one): not on the
 * first score, not on a tie. Then it signs in to the admin page and looks for the entries.
 * The admin password is the one hashed in admin.php ("HappyCampers").
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (spawnSync('php', ['-v']).error) {
  console.log('-  php is not installed here, skipping check-records');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'tim-records-'));
for (const f of ['scores.php', 'admin.php']) copyFileSync(join(root, f), join(dir, f));
const port = 18000 + Math.floor(Math.random() * 1000);
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
let passed = 0;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/scores.php?level=ramps`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('php server did not start');
}

const post = async (name, pathMeters, seconds, spare, level = 'ramps') =>
  (await fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level, name, pathMeters, seconds, spare }) })).json();
const records = () => {
  const p = join(dir, 'tim-data', 'records.log');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
function check(name, fn) {
  return fn().then(() => {
    passed++;
    console.log(`OK ${name}`);
  });
}

try {
  await waitUp();
  await check('the first score on an empty board is not a broken record', async () => {
    await post('Ana', 5, 9, 1);
    assert.equal(records().length, 0);
  });
  await check('a strictly better number one is logged, a tie is not', async () => {
    await post('Ben', 3, 12, 1); // shortest broken; fastest slower; spare ties Ana's 1
    let r = records();
    assert.equal(r.length, 1);
    assert.deepEqual([r[0].category, r[0].name, r[0].value, r[0].prevName, r[0].prevValue, r[0].level], ['shortest', 'Ben', 3, 'Ana', 5, 'ramps']);
    await post('Cat', 3, 20, 1); // ties Ben on shortest: no entry
    assert.equal(records().length, 1);
  });
  await check('improving your own record counts, and several boards can break at once', async () => {
    await post('Ana', 2, 8, 2); // shortest, fastest and spare all beaten
    const r = records();
    assert.equal(r.length, 4);
    assert.deepEqual(r.slice(1).map((e) => e.category).sort(), ['fastest', 'shortest', 'spare']);
  });
  await check('a worse run adds nothing', async () => {
    await post('Ana', 9, 30, 1);
    assert.equal(records().length, 4);
  });
  await check('the data folder is closed to the web', async () => {
    assert.ok(readFileSync(join(dir, 'tim-data', '.htaccess'), 'utf8').includes('Deny'));
  });
  await check('the admin High scores page lists the broken records and the boards', async () => {
    const jar = {};
    const take = (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) jar[c.split('=')[0]] = c.split(';')[0];
    };
    const cookie = () => Object.values(jar).join('; ');
    let res = await fetch(`${base}/admin.php`);
    take(res);
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await res.text())?.[1];
    assert.ok(csrf);
    res = await fetch(`${base}/admin.php`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body: new URLSearchParams({ csrf, password: 'HappyCampers', do: 'login' }),
    });
    take(res);
    const html = await (await fetch(`${base}/admin.php?view=scores`, { headers: { cookie: cookie() } })).text();
    assert.ok(html.includes('High scores'));
    assert.ok(html.includes('Records broken'));
    assert.ok(html.includes('<b>4</b> broken in total'));
    assert.ok(html.includes('Ramps'));
    assert.ok(html.includes('<b>Ana</b> 2 m'), 'new shortest record row');
    assert.ok(html.includes('Ben 3 m'), 'the record it beat');
    assert.ok(html.includes('Current community boards'));
    // Several clicks in a row stay signed in, and every page tells caches to keep out.
    for (const v of ['players', 'levels', 'log', 'scores']) {
      const r = await fetch(`${base}/admin.php?view=${v}`, { headers: { cookie: cookie() } });
      const t = await r.text();
      assert.ok(!t.includes('name="password"'), `${v}: asked for the password again`);
      assert.ok(t.includes('Refresh') && t.includes('id="clock"'), `${v}: refresh button and clock`);
      assert.equal(r.headers.get('x-litespeed-cache-control'), 'no-cache', `${v}: LiteSpeed header`);
      assert.match(r.headers.get('cache-control') ?? '', /no-store/);
      const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(r.headers.get('content-security-policy') ?? '')?.[1];
      assert.ok(nonce && t.includes(`<script nonce="${nonce}">`), `${v}: clock script allowed by its nonce`);
    }
    const login = await fetch(`${base}/admin.php`);
    assert.equal(login.headers.get('x-litespeed-cache-control'), 'no-cache', 'login page is not cacheable either');
    const filtered = await (await fetch(`${base}/admin.php?view=scores&level=gears`, { headers: { cookie: cookie() } })).text();
    assert.ok(filtered.includes('No broken records yet.'));
  });
  console.log(`\n${passed} checks passed`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
