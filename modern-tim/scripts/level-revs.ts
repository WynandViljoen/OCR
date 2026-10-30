/**
 * Tracks which game version each level was last changed in, so its high scores can be scrubbed.
 *
 *   npm run level-revs                      check that no level changed without a bump
 *   npm run level-revs -- bump ramps maze   mark those levels as changed in the current version
 *   npm run level-revs -- bump all          same for every level (use after a physics change)
 *
 * A bump sets the level's version in src/game/level-revs.ts and scores.php, and records the level's new
 * fingerprint in level-hashes.json. scores.php then clears that level's community boards on its next request,
 * and each player's game clears its own copy of the scores the next time it can reach the server.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../src/game/levels';
import { LEVEL_REVS, NOV_REVS } from '../src/game/level-revs';
import { LEVEL_SETS } from '../src/game/seasons';
import { VERSION } from '../src/game/version';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHP = join(here, '..', 'scores.php');
const TS = join(here, 'src/game/level-revs.ts');
const HASHES = join(here, 'level-hashes.json');

const php = readFileSync(PHP, 'utf8');
const phpIds = [...(/const LEVELS = \[(.*?)\];/s.exec(php)?.[1] ?? '').matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
const phpRevs: Record<string, string> = {};
for (const m of (/const LEVEL_REVS = \[(.*?)\];/s.exec(php)?.[1] ?? '').matchAll(/'([a-z0-9]+)' => '([^']+)'/g)) phpRevs[m[1]] = m[2];

/** What counts as "the level changed": everything that affects a score, not the wording of the hint. */
function fingerprint(id: string): string {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`level ${id} is in scores.php but not in the game`);
  const { goal, hasGoal, goalTargets, fixed, inventory, presets } = l;
  return createHash('sha1').update(JSON.stringify({ goal, hasGoal, goalTargets, fixed, inventory, presets })).digest('hex').slice(0, 12);
}

const hashes: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(HASHES, 'utf8'));
  } catch {
    return {};
  }
})();

const NOV_HASHES = join(here, 'level-hashes-nov.json');
function novFingerprint(id: string): string {
  const l = LEVEL_SETS.nov.find((x) => x.id === id);
  if (!l) throw new Error(`level ${id} is not in the November set`);
  const { goal, hasGoal, goalTargets, fixed, inventory, presets } = l;
  return createHash('sha1').update(JSON.stringify({ goal, hasGoal, goalTargets, fixed, inventory, presets })).digest('hex').slice(0, 12);
}
const novHashes: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(NOV_HASHES, 'utf8'));
  } catch {
    return {};
  }
})();
const phpNov: Record<string, string> = {};
for (const m of (/const SET_REVS = \['nov' => \[(.*?)\]\];/s.exec(php)?.[1] ?? '').matchAll(/'([a-z0-9]+)' => '([^']+)'/g)) phpNov[m[1]] = m[2];

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'bump-nov') {
  const ids = args[0] === 'all' ? phpIds : args;
  if (!ids.length) throw new Error('say which levels: bump-nov <id> ... or bump-nov all');
  for (const id of ids) {
    if (!phpIds.includes(id)) throw new Error(`unknown level ${id}`);
    NOV_REVS[id] = `nov-${VERSION}`;
    novHashes[id] = novFingerprint(id);
  }
  const ts = readFileSync(TS, 'utf8');
  writeFileSync(TS, ts.replace(/export const NOV_REVS[^]*?\n};\n/, `export const NOV_REVS: Record<string, string> = {\n${phpIds.map((id) => `  ${id}: '${NOV_REVS[id]}',`).join('\n')}\n};\n`));
  writeFileSync(PHP, php.replace(/const SET_REVS = \['nov' => \[.*?\]\];/s, `const SET_REVS = ['nov' => [${phpIds.map((id) => `'${id}' => '${NOV_REVS[id]}'`).join(', ')}]];`));
  writeFileSync(NOV_HASHES, JSON.stringify(Object.fromEntries(phpIds.map((id) => [id, novHashes[id] ?? novFingerprint(id)])), null, 2) + '\n');
  console.log(`November set: bumped ${ids.join(', ')} to nov-${VERSION}`);
} else if (cmd === 'bump') {
  const ids = args[0] === 'all' ? phpIds : args;
  if (!ids.length) throw new Error('say which levels: bump <id> ... or bump all');
  for (const id of ids) {
    if (!phpIds.includes(id)) throw new Error(`unknown level ${id}`);
    LEVEL_REVS[id] = VERSION;
    hashes[id] = fingerprint(id);
  }
  writeFileSync(TS, readFileSync(TS, 'utf8').replace(/export const LEVEL_REVS[^]*?\n};\n/, `export const LEVEL_REVS: Record<string, string> = {\n${phpIds.map((id) => `  ${id}: '${LEVEL_REVS[id]}',`).join('\n')}\n};\n`));
  writeFileSync(PHP, php.replace(/const LEVEL_REVS = \[.*?\];/s, `const LEVEL_REVS = [${phpIds.map((id) => `'${id}' => '${LEVEL_REVS[id]}'`).join(', ')}];`));
  writeFileSync(HASHES, JSON.stringify(Object.fromEntries(phpIds.map((id) => [id, hashes[id] ?? fingerprint(id)])), null, 2) + '\n');
  console.log(`bumped ${ids.join(', ')} to ${VERSION}`);
} else {
  let bad = 0;
  for (const id of phpIds) {
    if (LEVEL_REVS[id] !== phpRevs[id]) {
      console.log(`XX ${id}: level-revs.ts says ${LEVEL_REVS[id]}, scores.php says ${phpRevs[id]}`);
      bad++;
    } else if (!hashes[id]) {
      console.log(`XX ${id}: no fingerprint yet (run: npm run level-revs -- bump ${id})`);
      bad++;
    } else if (hashes[id] !== fingerprint(id)) {
      console.log(`XX ${id}: changed since ${LEVEL_REVS[id]} without a bump (run: npm run level-revs -- bump ${id})`);
      bad++;
    }
  }
  for (const id of Object.keys(LEVEL_REVS)) if (!phpIds.includes(id)) { console.log(`XX ${id} is not in scores.php`); bad++; }
  for (const id of phpIds) {
    if (NOV_REVS[id] !== phpNov[id]) { console.log(`XX November ${id}: level-revs.ts says ${NOV_REVS[id]}, scores.php says ${phpNov[id]}`); bad++; }
    else if (!novHashes[id]) { console.log(`XX November ${id}: no fingerprint yet (run: npm run level-revs -- bump-nov ${id})`); bad++; }
    else if (novHashes[id] !== novFingerprint(id)) { console.log(`XX November ${id}: changed since ${NOV_REVS[id]} without a bump (run: npm run level-revs -- bump-nov ${id})`); bad++; }
  }
  if (!bad) console.log(`OK ${phpIds.length} levels: versions agree and nothing changed without a bump (original and November sets)`);
  process.exitCode = bad ? 1 : 0;
}
