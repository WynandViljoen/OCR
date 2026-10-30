/**
 * The standalone page (index.html) is bundled by scripts/build-single.mjs from an explicit list of files.
 * A new module that is missing from that list breaks the live game while `tsc` and the tests still pass,
 * so every module in src/game must be listed (selftest is test-only).
 *
 *   npm run check-bundle
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(root, 'scripts/build-single.mjs'), 'utf8');
const listed = new Set([...(/const order = \[(.*?)\];/s.exec(script)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]));
const missing = readdirSync(join(root, 'src/game'))
  .filter((f) => f.endsWith('.ts') && f !== 'selftest.ts')
  .filter((f) => !listed.has(`game/${f}`));
assert.deepEqual(missing, [], `these modules are not in build-single.mjs, so the live game would break: ${missing.join(', ')}`);
console.log(`OK all ${listed.size} game modules are in the standalone bundle`);
