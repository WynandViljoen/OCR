/**
 * Community score client check (fake server, no network).
 *   npm run check-community
 */
import assert from 'node:assert/strict';
import { fetchCommunity, flushPending, loadPending, mayBreakRecord, savePending, submitRun, trySubmit, PENDING_KEY } from '../src/game/community';

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
  assert.deepEqual(sent, { level: 'ramps', name: 'Ana', pathMeters: 5, seconds: 4, spare: 1 });
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

console.log(`\n${passed} checks passed`);
