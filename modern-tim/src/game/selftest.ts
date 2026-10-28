/**
 * Level self-test, shared by `npm run check-levels` and the in-game "Test all levels" button.
 * For every puzzle level it checks two things:
 *   1. the recorded `solution` reaches the goal within 30 simulated seconds
 *   2. the level does NOT solve itself when the player adds nothing
 * It uses its own Simulation, so the board the player is working on is untouched.
 */
import { LEVELS, levelToParts, solutionToParts, type Level } from './levels';
import { Simulation } from './world';

const MAX_STEPS = 60 * 30;

export interface LevelTestResult {
  id: string;
  name: string;
  skipped: boolean;
  solutionSolves: boolean;
  seconds: number;
  solvesAlone: boolean;
  ok: boolean;
}

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

export function testLevel(level: Level): LevelTestResult {
  if (!level.hasGoal || !level.solution) {
    return { id: level.id, name: level.name, skipped: true, solutionSolves: false, seconds: 0, solvesAlone: false, ok: true };
  }
  const good = run(level, true);
  const empty = run(level, false);
  return {
    id: level.id,
    name: level.name,
    skipped: false,
    solutionSolves: good.solved,
    seconds: good.seconds,
    solvesAlone: empty.solved,
    ok: good.solved && !empty.solved,
  };
}

export function testAllLevels(): LevelTestResult[] {
  return LEVELS.map(testLevel);
}
