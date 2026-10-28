/**
 * Community score client check (fake server, no network).
 *   npm run check-community
 */
import assert from 'node:assert/strict';
import { fetchCommunity, flushPending, loadPending, savePending, submitRun, PENDING_KEY } from '../src/game/community';

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

console.log(`\n${passed} checks passed`);
