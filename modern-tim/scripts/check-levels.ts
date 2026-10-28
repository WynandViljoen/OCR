/**
 * Headless level check (same test as the "Test all levels" button in the game).
 *
 *   npm run check-levels
 *
 * Run it after tweaking physics constants or level layouts.
 */
import { testAllLevels } from '../src/game/selftest';

let failures = 0;
for (const r of testAllLevels()) {
  if (r.skipped) {
    console.log(`-  ${r.name}: no goal or recorded solution, skipped`);
    continue;
  }
  if (!r.ok) failures++;
  console.log(
    `${r.ok ? 'OK' : 'XX'} ${r.name}: solution ${r.solutionSolves ? `solves in ${r.seconds.toFixed(1)}s` : 'FAILS'}, ` +
      `empty board ${r.solvesAlone ? 'SOLVES BY ITSELF' : 'needs parts'}`,
  );
}
process.exitCode = failures ? 1 : 0;
