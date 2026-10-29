/**
 * Sandbox builds check: the 10 slots, renaming, damaged storage and the share client (fake server).
 *   npm run check-builds
 */
import assert from 'node:assert/strict';
import { addBuild, buildsKey, cleanBuildName, defaultBuildName, deleteBuild, fetchShared, loadBuilds, MAX_BUILDS, renameBuild, replaceBuild, saveBuilds, shareBuild, shareCodeFromSearch, shareUrl } from '../src/game/builds';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`OK ${name}`);
}
const memory = () => {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};
const parts = [{ id: 1, type: 'ball', x: 10, y: 20, angle: 0 }];

await check('slots are per player name', () => {
  assert.notEqual(buildsKey('Ana'), buildsKey('Ben'));
  assert.equal(buildsKey(' ANA '), buildsKey('ana'));
  assert.equal(buildsKey(''), 'modern-tim:builds:_');
});

await check('save, reload, replace, rename and delete', () => {
  const store = memory();
  let b = addBuild([], 'My ramp', parts, 1)!;
  assert.ok(saveBuilds('Ana', b, store));
  b = loadBuilds('Ana', store);
  assert.equal(b.length, 1);
  assert.equal(b[0].name, 'My ramp');
  assert.equal(loadBuilds('Ben', store).length, 0);
  b = replaceBuild(b, b[0].id, [...parts, { id: 2, type: 'plank', x: 1, y: 1, angle: 0 }], 5);
  assert.equal(b[0].parts.length, 2);
  assert.equal(b[0].name, 'My ramp');
  b = renameBuild(b, b[0].id, '  Big   jump <b> ');
  assert.equal(b[0].name, 'Big jump b');
  assert.equal(renameBuild(b, b[0].id, '   ')[0].name, 'Big jump b');
  assert.equal(deleteBuild(b, b[0].id).length, 0);
});

await check('only 10 can be saved, and a delete frees a slot', () => {
  let b: any[] = [];
  for (let i = 0; i < MAX_BUILDS; i++) b = addBuild(b, '', parts, i)!;
  assert.equal(b.length, 10);
  assert.equal(new Set(b.map((x) => x.id)).size, 10);
  assert.equal(new Set(b.map((x) => x.name)).size, 10);
  assert.equal(addBuild(b, 'eleven', parts, 99), null);
  assert.ok(addBuild(deleteBuild(b, b[3].id), 'eleven', parts, 99));
  assert.equal(defaultBuildName(deleteBuild(b, b[3].id)), 'Build 4');
});

await check('names are cleaned and capped', () => {
  assert.equal(cleanBuildName('x'.repeat(50)).length, 24);
  assert.equal(cleanBuildName('a\n\tb'), 'a b');
});

await check('damaged storage gives an empty or trimmed list, never a crash', () => {
  const s = memory();
  s.setItem(buildsKey('Ana'), '{not json');
  assert.deepEqual(loadBuilds('Ana', s), []);
  s.setItem(buildsKey('Ana'), JSON.stringify({ a: 1 }));
  assert.deepEqual(loadBuilds('Ana', s), []);
  const many = Array.from({ length: 15 }, (_, i) => ({ id: 'i' + i, name: 'n' + i, savedAt: 1, parts: [] }));
  s.setItem(buildsKey('Ana'), JSON.stringify([...many, null, 5]));
  assert.equal(loadBuilds('Ana', s).length, 10);
  s.setItem(buildsKey('Ana'), JSON.stringify([{ id: 'a', name: 'ok', parts: [] }, { id: 'a', name: 'dup', parts: [] }, { id: 'b', name: '', parts: [] }, { id: 'c', name: 'bad', parts: 'x' }]));
  assert.deepEqual(loadBuilds('Ana', s).map((x) => x.name), ['ok']);
  assert.equal(saveBuilds('Ana', [], null), false);
  assert.equal(saveBuilds('Ana', [], { getItem: () => null, setItem: () => { throw new Error('full'); } }), false);
});

await check('share links are read and made safely', () => {
  assert.equal(shareCodeFromSearch('?s=Ab3xYz9K'), 'Ab3xYz9K');
  assert.equal(shareCodeFromSearch('?x=1&s=Ab3xYz9K'), 'Ab3xYz9K');
  assert.equal(shareCodeFromSearch('?s=short'), null);
  assert.equal(shareCodeFromSearch('?s=Ab3xYz9K<script>'), null);
  assert.equal(shareCodeFromSearch(''), null);
  assert.equal(shareUrl('Ab3xYz9K', { origin: 'https://x.org', pathname: '/ocr/index.html' }), 'https://x.org/ocr/index.html?s=Ab3xYz9K');
});

await check('sharing: success, server error, and offline', async () => {
  let sent: any;
  const ok = await shareBuild({ title: 'T', author: 'A', version: '0.3', parts }, async (_u, init) => {
    sent = JSON.parse(init!.body!);
    return { ok: true, status: 200, json: async () => ({ code: 'Ab3xYz9K' }) };
  });
  assert.deepEqual(ok, { ok: true, value: 'Ab3xYz9K' });
  assert.equal(sent.parts.length, 1);
  const bad = await shareBuild({ title: 'T', author: 'A', version: '0.3', parts }, async () => ({ ok: false, status: 429, json: async () => ({ error: 'Slow down' }) }));
  assert.deepEqual(bad, { ok: false, error: 'Slow down' });
  const weird = await shareBuild({ title: 'T', author: 'A', version: '0.3', parts }, async () => ({ ok: true, status: 200, json: async () => ({ code: '../etc' }) }));
  assert.equal(weird.ok, false);
  const off = await shareBuild({ title: 'T', author: 'A', version: '0.3', parts }, async () => { throw new Error('offline'); });
  assert.equal(off.ok, false);
});

await check('opening a shared build: good, missing, odd', async () => {
  const good = await fetchShared('Ab3xYz9K', async () => ({ ok: true, status: 200, json: async () => ({ title: 'Cool <i>', author: 'Ana', parts }) }));
  assert.ok(good.ok);
  if (good.ok) {
    assert.equal(good.value.title, 'Cool i');
    assert.equal(good.value.author, 'Ana');
    assert.equal(good.value.parts.length, 1);
  }
  const gone = await fetchShared('Ab3xYz9K', async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) }));
  assert.deepEqual(gone, { ok: false, error: 'not found' });
  assert.equal((await fetchShared('bad', async () => { throw new Error('no'); })).ok, false);
  assert.equal((await fetchShared('Ab3xYz9K', async () => ({ ok: true, status: 200, json: async () => ({ title: 'x' }) }))).ok, false);
});

console.log(`${passed} checks passed`);
