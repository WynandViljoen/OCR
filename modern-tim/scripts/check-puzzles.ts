/** Community puzzles: a campaign level turned into a puzzle must validate; breaking it must be caught. */
import { LEVELS } from '../src/game/levels';
import { checkPuzzle, puzzleToLevel, inventoryOf, type WirePart } from '../src/game/puzzles';
import { testLevel } from '../src/game/selftest';

let bad = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? 'OK ' : 'XX ') + m);
  if (!c) bad++;
};
const wire = (list: NonNullable<(typeof LEVELS)[number]['fixed']>, from: number): WirePart[] =>
  list.map((p, i) => ({ id: from + i, type: p.type, x: p.x, y: p.y, angle: ((p.angle ?? 0) * Math.PI) / 180, ...(p.w !== undefined ? { w: p.w } : {}), ...(p.h !== undefined ? { h: p.h } : {}), ...(p.flip ? { flip: true } : {}) }));

const level = LEVELS[0];
const fixed = wire(level.fixed, 1);
const solution = wire(level.solution ?? [], 100);
ok(checkPuzzle(fixed, solution).ok, 'level 1 as a puzzle validates');
ok(!checkPuzzle(fixed, []).ok, 'a puzzle with no tray is refused');
ok(!checkPuzzle(fixed.filter((p) => p.type !== 'ball'), solution).ok, 'a puzzle without a ball is refused');
ok(!checkPuzzle(fixed, solution.map((p) => ({ ...p, x: p.x + 400, y: 20 }))).ok, 'a solution that does not solve is refused');
const lv = puzzleToLevel({ id: 7, title: 'T', creator: 'C', rev: 2, fixed, solution });
ok(lv.id === 'community-7' && lv.community?.rev === 2 && lv.hasGoal, 'level conversion keeps id, revision and goal');
ok(JSON.stringify(inventoryOf(solution)) === JSON.stringify(lv.inventory), 'tray = the solution parts');
ok(testLevel({ ...lv, solution: lv.solution?.map((p) => ({ ...p })) }).solutionSolves, 'converted level solves with its solution');
process.exit(bad ? 1 : 0);
