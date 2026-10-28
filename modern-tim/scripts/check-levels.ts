/**
 * Headless level check. For every puzzle level it verifies two things:
 *   1. the recorded `solution` reaches the goal within 30 simulated seconds
 *   2. the level does NOT solve itself when the player adds nothing
 *
 *   npm run check-levels
 *
 * Run it after tweaking physics constants or level layouts.
 */
import { LEVELS, levelToParts, solutionToParts, type Level } from '../src/game/levels';
import { Simulation } from '../src/game/world';

const MAX_STEPS = 60 * 30;
let failures = 0;

function run(level: Level, withSolution: boolean) {
  let id = 1;
  const nextId = () => id++;
  const parts = [...levelToParts(level, nextId), ...(withSolution ? solutionToParts(level, nextId) : [])];
  const sim = new Simulation();
  sim.goalEnabled = true;
  sim.goalTargets = level.goalTargets ?? ['ball'];
  sim.load(parts, true);
  let steps = 0;
  while (!sim.solved && steps < MAX_STEPS) {
    sim.step();
    steps++;
  }
  return { solved: sim.solved, seconds: steps / 60 };
}

for (const level of LEVELS) {
  if (!level.hasGoal) continue;
  if (!level.solution) {
    console.log(`-  ${level.name}: no recorded solution, skipped`);
    continue;
  }
  const good = run(level, true);
  const empty = run(level, false);
  const ok = good.solved && !empty.solved;
  if (!ok) failures++;
  console.log(
    `${ok ? 'OK' : 'XX'} ${level.name}: solution ${good.solved ? `solves in ${good.seconds.toFixed(1)}s` : 'FAILS'}, ` +
      `empty board ${empty.solved ? 'SOLVES BY ITSELF' : 'needs parts'}`,
  );
}

process.exitCode = failures ? 1 : 0;
