/**
 * Checks the score rules in src/game/profile.ts (no browser and no physics needed).
 *
 *   npm run check-scores
 */
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  MAX_NAME,
  emptyBoard,
  formatValue,
  holdsBest,
  loadPlayer,
  loadScores,
  pathMeters,
  recordRun,
  sanitizeName,
  stepsToSeconds,
  savePlayer,
  saveScores,
  type AllScores,
} from '../src/game/profile';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`OK ${name}`);
};
const fakeStore = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};
const result = (list: ReturnType<typeof recordRun>, category: string) => list.find((r) => r.category === category)!;

check('names are cleaned and capped', () => {
  assert.equal(sanitizeName('  Ana   Maria '), 'Ana Maria');
  assert.equal(sanitizeName('a\u0000b\nc'), 'a b c');
  assert.equal(sanitizeName('x'.repeat(40)).length, MAX_NAME);
  assert.equal(sanitizeName('   '), '');
});

check('metres and labels', () => {
  assert.equal(pathMeters(250), 2.5);
  assert.equal(formatValue('shortest', 8.44), '8.4 m');
  assert.equal(formatValue('spare', 1), '1 spare');
  assert.equal(formatValue('spare', 3), '3 spare');
});

check('first run takes first place in every category', () => {
  const s: AllScores = {};
  const r = recordRun(s, 'ramps', 'Ana', { pathMeters: 5, seconds: 9, spare: 1 }, 1);
  assert.deepEqual(r.map((x) => [x.category, x.rank, x.record]), [['shortest', 1, true], ['fastest', 1, true], ['spare', 1, true]]);
});

check('zero spare tools is not a score', () => {
  const s: AllScores = {};
  const r = recordRun(s, 'ramps', 'Ana', { pathMeters: 5, seconds: 9, spare: 0 }, 1);
  assert.equal(result(r, 'spare').rank, null);
  assert.equal(s.ramps.spare.length, 0);
});

check('shortest wants less, spare wants more', () => {
  const s: AllScores = {};
  recordRun(s, 'L', 'Ana', { pathMeters: 5, seconds: 9, spare: 1 }, 1);
  const r = recordRun(s, 'L', 'Ben', { pathMeters: 3, seconds: 9, spare: 2 }, 2);
  assert.equal(result(r, 'shortest').rank, 1);
  assert.equal(result(r, 'spare').rank, 1);
  assert.deepEqual(s.L.shortest.map((e) => e.name), ['Ben', 'Ana']);
});

check('one row per player (case-insensitive), only strictly better runs replace it', () => {
  const s: AllScores = {};
  recordRun(s, 'L', 'Ana', { pathMeters: 5, seconds: 9, spare: 2 }, 1);
  const worse = recordRun(s, 'L', 'ANA', { pathMeters: 6, seconds: 9, spare: 1 }, 2);
  assert.equal(result(worse, 'shortest').improved, false);
  assert.equal(result(worse, 'shortest').rank, 1);
  assert.equal(s.L.shortest.length, 1);
  assert.equal(s.L.shortest[0].value, 5);
  const better = recordRun(s, 'L', 'ana', { pathMeters: 4, seconds: 9, spare: 3 }, 3);
  assert.equal(result(better, 'shortest').improved, true);
  assert.equal(s.L.shortest.length, 1);
  assert.equal(s.L.shortest[0].value, 4);
  assert.equal(s.L.spare[0].value, 3);
});

check('a tie does not push out the earlier player', () => {
  const s: AllScores = {};
  recordRun(s, 'L', 'Ana', { pathMeters: 5, seconds: 9, spare: 1 }, 1);
  const r = recordRun(s, 'L', 'Ben', { pathMeters: 5, seconds: 9, spare: 1 }, 2);
  assert.equal(result(r, 'shortest').rank, 2);
  assert.equal(result(r, 'shortest').record, false);
  assert.equal(s.L.shortest[0].name, 'Ana');
});

check(`boards keep the top ${BOARD_SIZE}`, () => {
  const s: AllScores = {};
  for (let i = 1; i <= 7; i++) recordRun(s, 'L', `P${i}`, { pathMeters: i, seconds: 9, spare: i }, i);
  assert.equal(s.L.shortest.length, BOARD_SIZE);
  assert.deepEqual(s.L.shortest.map((e) => e.name), ['P1', 'P2', 'P3', 'P4', 'P5']);
  assert.deepEqual(s.L.spare.map((e) => e.name), ['P7', 'P6', 'P5', 'P4', 'P3']);
  const late = recordRun(s, 'L', 'Zed', { pathMeters: 50, seconds: 9, spare: 1 }, 99);
  assert.equal(result(late, 'shortest').rank, null);
  assert.equal(result(late, 'shortest').improved, false);
  assert.equal(result(late, 'spare').rank, null);
});

check('levels have separate boards', () => {
  const s: AllScores = {};
  recordRun(s, 'A', 'Ana', { pathMeters: 5, seconds: 9, spare: 1 }, 1);
  assert.deepEqual(s.B ?? emptyBoard(), emptyBoard());
});

check('saving and loading round-trips; the name is stored cleaned', () => {
  const store = fakeStore();
  const s: AllScores = {};
  recordRun(s, 'L', 'Ana', { pathMeters: 5, seconds: 9, spare: 1 }, 1);
  saveScores(s, store);
  assert.deepEqual(loadScores(store), s);
  savePlayer('  Ana   M ', store);
  assert.equal(loadPlayer(store), 'Ana M');
  assert.equal(loadPlayer(fakeStore()), '');
});

check('damaged or edited storage is ignored safely', () => {
  assert.deepEqual(loadScores(fakeStore({ 'modern-tim:scores': 'not json' })), {});
  assert.deepEqual(loadScores(fakeStore({ 'modern-tim:scores': '[1,2]' })).length, undefined);
  const bad = {
    L: {
      shortest: [
        { name: 'Ok', value: 3, at: 1 },
        { name: 'Neg', value: -4, at: 1 },
        { name: 'Huge', value: 1e9, at: 1 },
        { name: '', value: 2, at: 1 },
        { name: 'Str', value: '2', at: 1 },
        { name: 'ok', value: 9, at: 2 },
        null,
      ],
      fastest: 'nope',
      longest: [{ name: 'Old', value: 9, at: 1 }],
    },
  };
  const loaded = loadScores(fakeStore({ 'modern-tim:scores': JSON.stringify(bad) }));
  assert.deepEqual(loaded.L.shortest.map((e) => e.name), ['Ok']);
  assert.deepEqual(loaded.L.fastest, []);
  assert.equal((loaded.L as Record<string, unknown>).longest, undefined);
});

check('works with no storage at all (private browsing)', () => {
  assert.equal(loadPlayer(null), '');
  assert.deepEqual(loadScores(null), {});
  savePlayer('Ana', null);
  saveScores({}, null);
});

check('fastest wants less time', () => {
  const s: AllScores = {};
  recordRun(s, 'L', 'Ana', { pathMeters: 5, seconds: 10, spare: 1 }, 1);
  const r = recordRun(s, 'L', 'Ben', { pathMeters: 5, seconds: 4, spare: 1 }, 2);
  assert.equal(result(r, 'fastest').rank, 1);
  assert.deepEqual(s.L.fastest.map((e) => e.name), ['Ben', 'Ana']);
  assert.equal(formatValue('fastest', 4.25), '4.3 s');
  assert.equal(stepsToSeconds(90), 1.5);
});

check('boards saved before time scores existed still load', () => {
  const data: Record<string, string> = { 'modern-tim:scores': JSON.stringify({ L: { shortest: [{ name: 'Old', value: 3, at: 1 }] } }) };
  const store = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  const loaded = loadScores(store);
  assert.deepEqual(loaded.L.fastest, []);
  assert.equal(loaded.L.shortest[0].name, 'Old');
});

check('a tie earns the star and the first player stays on top', () => {
  const scores: AllScores = {};
  recordRun(scores, 'L', 'Ana', { pathMeters: 5, seconds: 4, spare: 2 }, 1000);
  recordRun(scores, 'L', 'Ben', { pathMeters: 5, seconds: 6, spare: 2 }, 2000); // ties Ana on path and spare, slower on time
  recordRun(scores, 'L', 'Cy', { pathMeters: 7, seconds: 9, spare: 1 }, 3000);
  const b = scores.L;
  assert.deepEqual(b.shortest.map((e) => e.name), ['Ana', 'Ben', 'Cy']); // Ana got there first, so she stays #1
  assert.equal(holdsBest(b, 'shortest', 'Ana'), 'first');
  assert.equal(holdsBest(b, 'shortest', 'ben'), 'tied'); // names match ignoring case
  assert.equal(holdsBest(b, 'spare', 'Ben'), 'tied');
  assert.equal(holdsBest(b, 'fastest', 'Ben'), null); // slower than Ana
  assert.equal(holdsBest(b, 'shortest', 'Cy'), null); // behind
  assert.equal(holdsBest(b, 'shortest', 'Dee'), null); // not on the board
  assert.equal(holdsBest(b, 'shortest', ''), null);
  assert.equal(holdsBest(emptyBoard(), 'shortest', 'Ana'), null);
});

console.log(`\n${passed} checks passed`);
