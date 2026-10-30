/**
 * Seasons: a season is one calendar month in Vancouver. At midnight the finished season is archived (boards,
 * screenshots, star table) and the new one starts with empty boards.
 *   npm run check-seasons
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (spawnSync('php', ['-v']).status !== 0) {
  console.log('SKIP php is not installed, so scores.php cannot be run here');
  process.exit(0);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'tim-seasons-'));
for (const f of ['scores.php', 'admin.php']) copyFileSync(join(root, f), join(dir, f));
let port = 19000 + Math.floor(Math.random() * 800);
let server = null;
const base = () => `http://127.0.0.1:${port}`;
/** (Re)start the PHP server with the clock set to this moment (UTC ms). */
async function clock(utcMs) {
  if (server) server.kill();
  port++;
  server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore', env: { ...process.env, TIM_TEST_NOW: String(Math.floor(utcMs / 1000)) } });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base()}/scores.php?revs=1`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('php server did not start');
}
const post = async (level, name, path, extra = {}) =>
  (await fetch(`${base()}/scores.php`, { method: 'POST', body: JSON.stringify({ level, name, pathMeters: path, seconds: 9, spare: 1, ...extra }) })).json();
const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 9)]).toString('base64');
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`OK ${name}`);
};
// October 2026 in Vancouver is PDT (UTC-7) until 2 am on Sunday 1 November, so midnight is 07:00 UTC.
const OCT_END = Date.UTC(2026, 10, 1, 7, 0, 0);

try {
  await clock(Date.UTC(2026, 9, 30, 20, 0, 0));
  await check('the first season is the current month, and the clock is served', async () => {
    const r = await (await fetch(`${base()}/scores.php?revs=1`)).json();
    assert.equal(r.season.id, '2026-10');
    assert.equal(r.season.label, 'October 2026');
    assert.equal(r.season.end * 1000, OCT_END);
    assert.equal(r.season.now, Math.floor(Date.UTC(2026, 9, 30, 20) / 1000));
  });

  await post('ramps', 'Ann', 8);
  await post('ramps', 'Bob', 6, { shot: jpeg }); // Bob breaks the record, with a picture
  await post('gears', 'Ann', 5);
  const s1 = await (await fetch(`${base()}/scores.php?stars=1`)).json();
  await check('stars count number ones and the current season is named', async () => {
    assert.equal(s1.season.id, '2026-10');
    assert.equal(s1.previous, null);
    assert.deepEqual(s1.stars.map((x) => [x.name, x.stars]), [['Ann', 5], ['Bob', 3]]);
  });

  await clock(OCT_END - 1000); // 23:59:59 on 31 October: still the same season
  await check('one second before midnight Vancouver time nothing changes', async () => {
    const r = await (await fetch(`${base()}/scores.php?level=ramps`)).json();
    assert.equal(r.board.shortest.length, 2);
    assert.equal(existsSync(join(dir, 'tim-data', 'seasons')), false);
  });

  await clock(OCT_END); // midnight
  await check('at midnight the season is archived and the boards start empty', async () => {
    const r = await (await fetch(`${base()}/scores.php?level=ramps`)).json();
    assert.deepEqual(r.board, { shortest: [], fastest: [], spare: [] });
    const file = join(dir, 'tim-data', 'seasons', '2026-10.json');
    assert.ok(existsSync(file));
    const a = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(a.label, 'October 2026');
    assert.equal(a.boards.ramps.shortest[0].name, 'Bob');
    assert.equal(a.boards.gears.shortest[0].name, 'Ann');
    assert.equal(a.stars.length, 2);
    assert.match(a.boards.ramps.shortest[0].shot, /\.jpg$/, 'the record picture is kept with the archive');
    assert.ok(existsSync(join(dir, 'tim-data', 'seasons', 'shots', a.boards.ramps.shortest[0].shot)), 'and moved to the archive folder');
    assert.equal(readdirSync(join(dir, 'tim-data', 'shots')).length, 0);
  });

  await check('a new run lands on the new season; last season is reported with its winners', async () => {
    const r = await post('ramps', 'Cy', 7);
    assert.equal(r.board.shortest.length, 1);
    const s = await (await fetch(`${base()}/scores.php?stars=1`)).json();
    assert.equal(s.season.id, '2026-11');
    assert.equal(s.previous.label, 'October 2026');
    assert.deepEqual(s.previous.stars.map((x) => x.name).sort(), ['Ann', 'Bob']);
    assert.deepEqual(s.stars.map((x) => [x.name, x.stars]), [['Cy', 3]]);
    const again = await (await fetch(`${base()}/scores.php?level=ramps`)).json();
    assert.equal(again.board.shortest.length, 1, 'asking again does not archive again');
  });

  await clock(Date.UTC(2027, 0, 5, 12)); // nobody played in December
  await check('a quiet month in between still archives what was there', async () => {
    await fetch(`${base()}/scores.php?level=ramps`);
    const files = readdirSync(join(dir, 'tim-data', 'seasons')).filter((f) => f.endsWith('.json')).sort();
    assert.deepEqual(files, ['2026-10.json', '2026-11.json']);
    const s = await (await fetch(`${base()}/scores.php?stars=1`)).json();
    assert.equal(s.season.id, '2027-01');
    assert.equal(s.previous.id, '2026-11');
  });
  await clock(Date.UTC(2027, 0, 5, 20)); // still January 2027: October and November are both finished
  await check('the dashboard shows the new season, the star leaders, and every finished season in full', async () => {
    const jar = {};
    const take = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) jar[c.split('=')[0]] = c.split(';')[0]; };
    const cookie = () => Object.values(jar).join('; ');
    let res = await fetch(`${base()}/admin.php`);
    take(res);
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await res.text())?.[1];
    res = await fetch(`${base()}/admin.php`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() }, body: new URLSearchParams({ csrf, password: 'HappyCampers', do: 'login' }) });
    take(res);
    const get = async (q) => await (await fetch(`${base()}/admin.php?view=scores${q}`, { headers: { cookie: cookie() } })).text();
    const now = await get('');
    assert.ok(now.includes('January 2027') && now.includes('season in progress'), 'the current season is named');
    assert.ok(now.includes('Current season: January 2027'));
    assert.ok(now.includes('<option value="2026-10">October 2026 (final)</option>') && now.includes('<option value="2026-11">November 2026 (final)</option>'), 'finished seasons are offered');
    assert.ok(now.includes('Season results') && now.includes('&#127942; Cy &#9733; 3'), 'the hall of fame names November champion');
    assert.ok(now.includes('&#127942; Ann &#9733; 5'), 'and the October one');
    const boardsPart = now.slice(now.indexOf('Current community boards'), now.indexOf('Season results'));
    assert.ok(!boardsPart.includes('Bob') && !boardsPart.includes('Cy'), 'last seasons are not mixed into this one');
    const old = await get('&season=2026-10');
    assert.ok(old.includes('Community boards at the end of October 2026') && old.includes('final results'), 'the finished season opens like the current one');
    assert.ok(old.includes('1. Bob') || old.includes('<b>1. Bob'), 'its boards are intact');
    assert.ok(old.includes('Records broken') && old.includes('<b>Bob</b> 6.000 m'), 'and its records');
    const link = /admin\.php\?shot=([0-9a-z.-]+)/.exec(old)?.[1];
    assert.ok(link, 'the number one screenshot link survives the archive');
    const img = await fetch(`${base()}/admin.php?shot=${link}`, { headers: { cookie: cookie() } });
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    const filtered = await get('&season=2026-10&player=bob&now%5B%5D=top');
    const fb = filtered.slice(filtered.indexOf('Community boards at the end'), filtered.indexOf('<h2>Records broken</h2>'));
    assert.ok(fb.includes('1. Bob') && !fb.includes('Ann'), 'filters work on a finished season');
  });
  console.log(`\n${passed} checks passed`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
}
