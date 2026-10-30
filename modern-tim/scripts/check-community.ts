/**
 * Community score client check (fake server, no network).
 *   npm run check-community
 */
import assert from 'node:assert/strict';
import { LEVEL_REVS } from '../src/game/level-revs';
import { scrubChangedLevels, loadScores, saveScores, REVS_KEY } from '../src/game/profile';
import { fetchStars, syncLocalBests, fetchRevs, scrubPending, fetchCommunity, flushPending, loadPending, mayBreakRecord, savePending, submitRun, trySubmit, PENDING_KEY } from '../src/game/community';

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`OK ${name}`);
}
const memory = () => {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};
const okJson = (body: unknown) => async () => ({ ok: true, json: async () => body });
const run = { pathMeters: 5, seconds: 4, spare: 1 };

await check('a good board is cleaned and returned', async () => {
  const board = await fetchCommunity('ramps', okJson({ board: { shortest: [{ name: 'Ana', value: 5, at: 1 }, { name: '', value: 3 }, { name: 'Bad', value: 'x' }] } }));
  assert.ok(board);
  assert.deepEqual(board.shortest.map((e) => e.name), ['Ana']);
  assert.deepEqual(board.fastest, []);
});

await check('no server, bad status or broken JSON all give null', async () => {
  assert.equal(await fetchCommunity('ramps', async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchCommunity('ramps', async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await fetchCommunity('ramps', async () => ({ ok: true, json: async () => { throw new Error('html'); } })), null);
});

await check('a submission sends the run and reads the ranks back', async () => {
  let sent: any;
  const sub = await submitRun('ramps', '  Ana  ', run, async (_u, init) => {
    sent = JSON.parse(init!.body!);
    return { ok: true, json: async () => ({ board: { spare: [{ name: 'Ana', value: 1, at: 1 }] }, results: { spare: { rank: 1, improved: true, record: true } } }) };
  });
  assert.deepEqual(sent, { level: 'ramps', name: 'Ana', pathMeters: 5, seconds: 4, spare: 1, rev: LEVEL_REVS.ramps });
  assert.equal(sub?.results.spare.record, true);
  assert.equal(sub?.results.shortest.rank, null);
});

await check('waiting runs are kept, tampered storage is ignored', async () => {
  const store = memory();
  savePending([{ levelId: 'ramps', name: 'Ana', run }], store);
  assert.equal(loadPending(store).length, 1);
  store.data[PENDING_KEY] = JSON.stringify([{ levelId: 5 }, 'x', { levelId: 'a', name: 'b', run: { pathMeters: 'no' } }]);
  assert.deepEqual(loadPending(store), []);
  store.data[PENDING_KEY] = 'not json';
  assert.deepEqual(loadPending(store), []);
});

await check('flushing sends in order, and stops at the first failure', async () => {
  const store = memory();
  savePending([1, 2, 3].map((n) => ({ levelId: 'ramps', name: `P${n}`, run })), store);
  let calls = 0;
  const flaky = async () => {
    calls++;
    return calls === 3 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ board: {}, results: {} }) };
  };
  assert.equal(await flushPending(store, flaky), 2);
  assert.deepEqual(loadPending(store).map((r) => r.name), ['P3']);
});

await check('a run the server refuses for good is dropped and does not block the runs behind it', async () => {
  const store = memory();
  savePending([1, 2, 3].map((n) => ({ levelId: 'ramps', name: `P${n}`, run })), store);
  let calls = 0;
  const f = async () => {
    calls++;
    // 1st: unknown level (400). 2nd: server crashed (500). 3rd would be fine but is never reached.
    return calls === 1 ? { ok: false, status: 400, json: async () => ({ error: 'Unknown level.' }) } : { ok: false, status: 500, json: async () => ({}) };
  };
  assert.equal(await flushPending(store, f), 0);
  assert.deepEqual(loadPending(store).map((r) => r.name), ['P2', 'P3']); // P1 dropped, P2 kept for a retry
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ board: {}, results: {} }) });
  assert.equal(await flushPending(store, ok), 2);
  assert.deepEqual(loadPending(store), []);
});

await check('a screenshot is only worth sending when a record could be broken; version and picture go in the request', async () => {
  const e = (value: number) => [{ name: 'Ana', value, at: 1 }];
  const board = { shortest: e(5), fastest: e(4), spare: e(1) };
  assert.equal(mayBreakRecord(board, { pathMeters: 5, seconds: 4, spare: 1 }), false); // ties do not count
  assert.equal(mayBreakRecord(board, { pathMeters: 4.9, seconds: 4, spare: 1 }), true);
  assert.equal(mayBreakRecord(board, { pathMeters: 5, seconds: 3.9, spare: 1 }), true);
  assert.equal(mayBreakRecord(board, { pathMeters: 5, seconds: 4, spare: 2 }), true);
  assert.equal(mayBreakRecord({ shortest: [], fastest: [], spare: [] }, run), false); // an empty board has no record yet
  assert.equal(mayBreakRecord(null, run), false);
  let sent: Record<string, unknown> = {};
  const f = async (_u: string, init?: { body?: string }) => {
    sent = JSON.parse(init?.body ?? '{}');
    return { ok: true, status: 200, json: async () => ({ board: {}, results: {} }) };
  };
  await trySubmit('ramps', 'Ana', run, f, { version: '0.4a', shot: 'data:image/jpeg;base64,AAAA' });
  assert.equal(sent.version, '0.4a');
  assert.equal(sent.shot, 'data:image/jpeg;base64,AAAA');
  await trySubmit('ramps', 'Ana', run, f);
  assert.equal('shot' in sent, false);
});

await check('a changed level loses its local scores and waiting runs; unchanged and first-seen levels keep theirs', async () => {
  const store = memory();
  const mine = { shortest: [{ name: 'Ana', value: 5, at: 1 }], fastest: [], spare: [] };
  saveScores({ ramps: mine, gears: mine }, store);
  assert.deepEqual(scrubChangedLevels({ ramps: '1', gears: '1' }, loadScores(store), store), []); // first visit: only noted
  assert.ok(store.data[REVS_KEY]);
  const scores = loadScores(store);
  assert.deepEqual(scrubChangedLevels({ ramps: '2', gears: '1', maze: '1' }, scores, store), ['ramps']);
  assert.equal('ramps' in scores, false);
  assert.equal('ramps' in loadScores(store), false);
  assert.equal('gears' in loadScores(store), true);
  assert.deepEqual(scrubChangedLevels({ ramps: '2', gears: '1' }, scores, store), []); // once only
  savePending([{ levelId: 'ramps', name: 'Ana', run }, { levelId: 'gears', name: 'Ana', run }], store);
  scrubPending(['ramps'], store);
  assert.deepEqual(loadPending(store).map((r) => r.levelId), ['gears']);
  assert.deepEqual(await fetchRevs(okJson({ revs: { ramps: '2', bad: 3 } })), { ramps: '2' });
  assert.equal(await fetchRevs(async () => { throw new Error('offline'); }), null);
});

await check('on start, local bests that belong on a community board are sent; others are not', async () => {
  const row = (name: string, value: number) => ({ name, value, at: 1 });
  const mk = (s: number, f: number, p: number) => ({ shortest: [row('Ana', s)], fastest: [row('Ana', f)], spare: p ? [row('Ana', p)] : [] });
  const full = (v: number[]) => v.map((x, i) => row('P' + i, x));
  const boards: Record<string, unknown> = {
    ramps: { shortest: full([2, 3, 4, 6, 7]), fastest: full([2, 3, 4, 6, 7]), spare: full([3, 3, 2, 2, 1]) },   // Ana 5/5 would be 4th on both
    gears: { shortest: full([2, 3, 4, 5, 6]), fastest: full([2, 3, 4, 5, 6]), spare: full([3, 3, 2, 2, 2]) },   // Ana 9/9/1 is below fifth everywhere
    springs: { shortest: [row('Ana', 5)], fastest: [row('Ana', 5)], spare: [] },                              // already there with the same numbers
  };
  const posts: Record<string, unknown>[] = [];
  const f = async (url: string, init?: { body?: string }) => {
    if (init?.body) {
      const b = JSON.parse(init.body);
      posts.push(b);
      return { ok: true, status: 200, json: async () => ({ board: boards[b.level], results: {} }) };
    }
    const level = /level=([a-z0-9]+)/.exec(url)![1];
    return { ok: true, status: 200, json: async () => ({ board: boards[level] }) };
  };
  const scores = { ramps: mk(5, 5, 1), gears: mk(9, 9, 1), springs: mk(5, 5, 0), maze: mk(5, 5, 1), nolevel: mk(1, 1, 1) };
  boards.maze = { shortest: [], fastest: [], spare: [] };
  const n = await syncLocalBests(scores, 'ana', f);
  assert.equal(n, 2);
  assert.deepEqual(posts.map((p) => p.level).sort(), ['maze', 'ramps']);
  assert.equal(posts.every((p) => p.name === 'ana' && !('version' in p) && !('shot' in p)), true);
  assert.equal(await syncLocalBests(scores, '', f), 0);
  assert.equal(await syncLocalBests(scores, 'Ana', async () => { throw new Error('offline'); }), 0);
});

await check('the star table is cleaned: bad rows dropped, five at most', async () => {
  const r = await fetchStars(okJson({ max: 63, stars: [{ name: 'Ana', stars: 5 }, { name: '', stars: 4 }, { name: 'Bad', stars: 'x' }, { name: 'Zero', stars: 0 }, ...['B', 'C', 'D', 'E', 'F'].map((n) => ({ name: n, stars: 1 }))] }));
  assert.ok(r);
  assert.equal(r.max, 63);
  assert.deepEqual(r.rows.map((x) => x.name), ['Ana', 'B', 'C', 'D', 'E']);
  assert.equal(await fetchStars(async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchStars(okJson({ nope: 1 })), null);
});

console.log(`\n${passed} checks passed`);
