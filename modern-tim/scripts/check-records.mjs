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
import { copyFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
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
let cookie = () => "";

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
    cookie = () => Object.values(jar).join('; ');
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
    const send2 = (name, path) => fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level: 'gears', name, pathMeters: path, seconds: 20, spare: 0 }) });
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
    await send('Eve', 5, { version: '0.4a', shot: 'data:image/jpeg;base64,AAAA' }); // junk picture: score kept, no file; Dee is no longer number one, so her picture goes
    assert.equal(shots().length, 0);
    assert.equal(records().filter((e) => e.level === 'springs').length, 2);
    await send('Fay', 4, { version: '<script>', shot: jpeg }); // bad version text is dropped, not stored
    assert.equal(shots().length, 1, 'only the current number one keeps a picture');
    const row = (await (await fetch(`${base}/scores.php?level=springs`)).json()).board.shortest[0];
    assert.equal(row.name, 'Fay');
    assert.equal(row.shot, undefined, 'players are not told the file name');
    const stored = JSON.parse(readFileSync(join(dir, 'scores-data.json'), 'utf8')).springs.shortest;
    assert.equal(stored[0].shot, shots()[0], 'the number one row keeps the picture');
    assert.equal(stored.slice(1).some((r) => r.shot), false, 'no one else keeps one');
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
    assert.ok(html.includes('<th>Now</th>'));
    assert.ok(/<b>Fay<\/b> 4 m<\/td><td><b>#1<\/b><\/td>/.test(html), 'Fay is still number one');
    assert.ok(/<b>Dee<\/b> 6 m<\/td><td><span class="mute">Beaten<\/span><\/td>/.test(html), 'Dee has been passed');
    for (const [n, v] of [['Gus', 5], ['Hal', 4], ['Ivy', 4]]) await send2(n, v);
    const gears = await (await fetch(`${base}/admin.php?view=scores&level=gears`, { headers: { cookie: cookie() } })).text();
    assert.ok(/<b>Hal<\/b> 4 m<\/td><td><b>Tied #1<\/b><\/td>/.test(gears), 'Hal is tied for number one');
    const only = async (now) => await (await fetch(`${base}/admin.php?view=scores&level=springs&now=${now}`, { headers: { cookie: cookie() } })).text();
    const top = await only('top');
    assert.ok(top.includes('<b>Fay</b> 4 m') && !top.includes('<b>Dee</b> 6 m'), 'filter: number one now');
    const beaten = await only('beaten');
    assert.ok(beaten.includes('<b>Dee</b> 6 m') && !beaten.includes('<b>Fay</b> 4 m'), 'filter: beaten since');
    assert.ok(/<b>Hal<\/b> 4 m/.test(await (await fetch(`${base}/admin.php?view=scores&level=gears&now=tied`, { headers: { cookie: cookie() } })).text()), 'filter: tied');
    const dee = await (await fetch(`${base}/admin.php?view=scores&level=springs&player=dee`, { headers: { cookie: cookie() } })).text();
    assert.ok(dee.includes('<b>Dee</b> 6 m') && !dee.includes('<b>Fay</b> 4 m'), 'filter: player');
    assert.ok(dee.includes('<option value="dee" selected>Dee</option>'), 'player list offers the name');
    assert.ok(!(await only('top')).includes('value="nobody"'), 'unknown names are ignored');
    assert.ok((gears.match(/<b>1\. /g) || []).length >= 2, 'everyone tied for number one is bold');
    assert.ok(html.includes('v0.4a'));
    assert.ok(html.includes('Dashboard v'), 'the dashboard shows its version');
    assert.match(html, /v0\.4a<\/span>(?:<\/b>)? <span class="mute">\d{4}-\d\d-\d\d \d\d:\d\d<\/span>/, 'board entries show when they were logged');
    const current = readdirSync(join(dir, 'tim-data', 'shots')).filter((f) => f.includes('-springs-'))[0]; // Fay's: Dee's was scrapped when she was beaten
    assert.ok(html.includes(`admin.php?shot=${current}`) && html.includes('>View</a>'));
    assert.ok(!html.includes(`admin.php?shot=${rec[0].shot}`), 'a scrapped picture has no link');
    const img = await fetch(`${base}/admin.php?shot=${current}`, { headers: { cookie: cookie() } });
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    // Stars on the Players page: Fay is number one on the Springs shortest-path board.
    await fetch(`${base}/admin.php?api=track`, { method: 'POST', body: JSON.stringify({ ev: 'name', name: 'Fay' }) });
    const players = await (await fetch(`${base}/admin.php?view=players`, { headers: { cookie: cookie() } })).text();
    assert.ok(players.includes('<th>Stars</th>'));
    assert.ok(/<b>Fay<\/b>.*?<b>★ 1<\/b>/s.test(players), 'Fay has 1 star (only five rows fit a board, so her tied runs are not on the others)');
    const bad = await fetch(`${base}/admin.php?shot=../scores.php`, { headers: { cookie: cookie() } });
    assert.equal(bad.status, 404);
  });
  await check('changing a level version clears that level only, serves the versions, and refuses old copies of the level', async () => {
    const before = await (await fetch(`${base}/scores.php?level=gears`)).json();
    assert.ok(before.board.shortest.length > 0 && before.rev, 'gears has scores and a version');
    assert.ok((await (await fetch(`${base}/scores.php?level=ramps`)).json()).board.shortest.length > 0);
    const file = join(dir, 'scores.php');
    writeFileSync(file, readFileSync(file, 'utf8').replace("'ramps' => '0.4g'", "'ramps' => '9.9z'"));
    const revs = (await (await fetch(`${base}/scores.php?revs=1`)).json()).revs;
    assert.equal(revs.ramps, '9.9z');
    assert.equal(revs.gears, before.rev);
    const after = await (await fetch(`${base}/scores.php?level=ramps`)).json();
    assert.deepEqual(after.board.shortest, []);
    assert.equal(after.rev, '9.9z');
    assert.deepEqual((await (await fetch(`${base}/scores.php?level=gears`)).json()).board, before.board);
    const old = await fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level: 'ramps', name: 'Zed', pathMeters: 3, seconds: 5, spare: 1, rev: '0.4g' }) });
    assert.equal(old.status, 409);
    const fresh = await fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level: 'ramps', name: 'Zed', pathMeters: 3, seconds: 5, spare: 1, rev: '9.9z' }) });
    assert.equal(fresh.status, 200);
    const page = await (await fetch(`${base}/admin.php?view=scores`, { headers: { cookie: cookie() } })).text();
    assert.ok(page.includes('Scores the server refused') && page.includes('This level has changed'), 'a refused score is listed with its reason');
  });
  await check('each number one has a picture link on the dashboard; a new number one replaces it and the old file is deleted', async () => {
    const jpeg = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, n)]).toString('base64');
    const go = (name, path, shot) => fetch(`${base}/scores.php`, { method: 'POST', body: JSON.stringify({ level: 'slalom', name, pathMeters: path, seconds: 9, spare: 1, shot }) });
    const files = () => (existsSync(join(dir, 'tim-data', 'shots')) ? readdirSync(join(dir, 'tim-data', 'shots')).filter((f) => f.includes('-slalom-')) : []);
    const board = async () => await (await fetch(`${base}/admin.php?view=scores&level=slalom`, { headers: { cookie: cookie() } })).text();
    await go('Hal', 8, jpeg(1));
    await go('Ida', 7, jpeg(2)); // breaks Hal: shortest, and fastest/spare tie
    const first = files();
    assert.equal(first.length, 1);
    assert.ok((await board()).includes(`admin.php?shot=${first[0]}`), 'the number one line links to its picture');
    await go('Jo', 6, jpeg(3));
    const second = files();
    assert.equal(second.length, 1);
    assert.notEqual(second[0], first[0], 'the old picture is gone');
    assert.ok((await board()).includes(`admin.php?shot=${second[0]}`) && !(await board()).includes(first[0]));
    await go('Kim', 6, jpeg(4)); // a tie breaks nothing: no new picture, the old one stays
    assert.deepEqual(files(), second);
  });
  console.log(`\n${passed} checks passed`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
