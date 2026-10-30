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
import { copyFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
    assert.match(res.headers.get('location') ?? '', /^admin\.php\?go=\w+&view=players$/, 'login redirects to a one-off address');
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
    // Without a session cookie the page explains itself instead of silently showing the login again.
    const lost = await (await fetch(`${base}/admin.php?go=123&view=scores`)).text();
    assert.ok(lost.includes('did not keep your sign-in'), 'lost session after redirect is explained');
    const diag = await (await fetch(`${base}/admin.php?diag=1`)).text();
    assert.ok(diag.includes('Admin build') && diag.includes('Session started') && diag.includes('<b>yes</b>'), 'connection check page');
    const login = await fetch(`${base}/admin.php`);
    assert.equal(login.headers.get('x-litespeed-cache-control'), 'no-cache', 'login page is not cacheable either');
    const filtered = await (await fetch(`${base}/admin.php?view=scores&level=gears`, { headers: { cookie: cookie() } })).text();
    assert.ok(filtered.includes('No broken records yet.'));
  });
  await check('a broken record keeps the game version and the screenshot; ties and first scores do not', async () => {
    const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString('base64');
    const send = async (name, path, extra = {}) =>
      (await fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level: 'springs', name, pathMeters: path, seconds: 9, spare: 1, ...extra }) })).json();
    const shots = () => (existsSync(join(dir, 'tim-data', 'shots')) ? readdirSync(join(dir, 'tim-data', 'shots')) : []);
    await send('Ann', 8, { version: '0.4a', shot: jpeg }); // first score: nothing to break, no picture kept
    assert.equal(shots().length, 0);
    await send('Bob', 8, { version: '0.4a', shot: jpeg }); // tie: no picture
    assert.equal(shots().length, 0);
    await send('Cy', 9, { version: '0.4a', shot: jpeg }); // worse: no picture
    assert.equal(shots().length, 0);
    const res = await send('Dee', 6, { version: '0.4a', shot: jpeg }); // breaks the record
    assert.equal(shots().length, 1);
    const rec = records().filter((e) => e.level === 'springs');
    assert.equal(rec.length, 1);
    assert.equal(rec[0].version, '0.4a');
    assert.match(rec[0].shot, /^\d{8}-\d{6}-springs-[a-f0-9]{6}\.jpg$/);
    assert.equal(res.board.shortest[0].v, '0.4a', 'the board row remembers the version');
    await send('Eve', 5, { version: '0.4a', shot: 'data:image/jpeg;base64,AAAA' }); // junk picture: score kept, no file
    assert.equal(shots().length, 1);
    assert.equal(records().filter((e) => e.level === 'springs').length, 2);
    await send('Fay', 4, { version: '<script>', shot: jpeg }); // bad version text is dropped, not stored
    const row = (await (await fetch(`${base}/scores.php?level=springs`)).json()).board.shortest[0];
    assert.equal(row.name, 'Fay');
    assert.equal(row.v, undefined);
    // The admin page lists version + screenshot link, and serves the picture only when signed in.
    const jar = {};
    const take = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) jar[c.split('=')[0]] = c.split(';')[0]; };
    const cookie = () => Object.values(jar).join('; ');
    const anon = await fetch(`${base}/admin.php?shot=${rec[0].shot}`);
    assert.ok((await anon.text()).includes('name="password"'), 'not signed in: asked for the password');
    let r = await fetch(`${base}/admin.php`); take(r);
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await r.text())?.[1];
    r = await fetch(`${base}/admin.php`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() }, body: new URLSearchParams({ csrf, password: 'HappyCampers', do: 'login' }) }); take(r);
    const html = await (await fetch(`${base}/admin.php?view=scores&level=springs`, { headers: { cookie: cookie() } })).text();
    assert.ok(html.includes('<th>Version</th>') && html.includes('<th>Screenshot</th>'));
    assert.ok(html.includes('v0.4a'));
    assert.ok(html.includes('Dashboard v'), 'the dashboard shows its version');
    assert.match(html, /v0\.4a<\/span> <span class="mute">[A-Z][a-z]{2} \d+, \d\d:\d\d<\/span>/, 'board entries show when they were logged');
    assert.ok(html.includes(`admin.php?shot=${rec[0].shot}`) && html.includes('>View</a>'));
    const img = await fetch(`${base}/admin.php?shot=${rec[0].shot}`, { headers: { cookie: cookie() } });
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    // Stars on the Players page: Fay is number one on the Springs shortest-path board.
    await fetch(`${base}/admin.php?api=track`, { method: 'POST', body: JSON.stringify({ ev: 'name', name: 'Fay' }) });
    const players = await (await fetch(`${base}/admin.php?view=players`, { headers: { cookie: cookie() } })).text();
    assert.ok(players.includes('<th>Stars</th>'));
    assert.ok(/<b>Fay<\/b>.*?<b>★ 1<\/b>/s.test(players), 'Fay has 1 star (only five rows fit a board, so her tied runs are not on the others)');
    const bad = await fetch(`${base}/admin.php?shot=../scores.php`, { headers: { cookie: cookie() } });
    assert.equal(bad.status, 404);
  });
  console.log(`\n${passed} checks passed`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
