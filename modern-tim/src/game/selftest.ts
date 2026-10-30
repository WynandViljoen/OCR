/**
 * Level self-test, shared by `npm run check-levels` and the in-game "Test all levels" button.
 * For every puzzle level it checks two things:
 *   1. the recorded `solution` reaches the goal within 30 simulated seconds
 *   2. the level does NOT solve itself when the player adds nothing
 *   3. the solution only uses basic tools: it sets no attributes (power, weight, strands,
 *      sizes) because players cannot change attributes outside the Sandbox, and it stays
 *      within the level's inventory
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
  /** Did the run end by itself as a failure when the player adds nothing? (Informative: a ball that rolls forever never fails.) */
  emptyFails: boolean;
  /** Names what is wrong with the solution's use of attributes or inventory, or '' if fine. */
  problem: string;
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
  while (!sim.solved && !sim.failed && steps < MAX_STEPS) {
    sim.step();
    steps++;
  }
  return { solved: sim.solved, failed: sim.failed, seconds: steps / 60 };
}

/** The solution may only use tools from the inventory and must not set any attributes. */
function solutionProblem(level: Level): string {
  const used: Record<string, number> = {};
  for (const p of level.solution ?? []) {
    if (p.props || p.power !== undefined || p.w !== undefined || p.h !== undefined) {
      return `solution sets attributes on a ${p.type} (attributes are locked outside the Sandbox; use Level.presets)`;
    }
    used[p.type] = (used[p.type] ?? 0) + 1;
  }
  if (level.inventory) {
    for (const [type, n] of Object.entries(used)) {
      const have = (level.inventory as Record<string, number | undefined>)[type] ?? 0;
      if (n > have) return `solution uses ${n} ${type}, the inventory has ${have}`;
    }
  }
  return '';
}

export function testLevel(level: Level): LevelTestResult {
  if (!level.hasGoal || !level.solution) {
    return { id: level.id, name: level.name, skipped: true, solutionSolves: false, seconds: 0, solvesAlone: false, emptyFails: false, problem: '', ok: true };
  }
  const problem = solutionProblem(level);
  const good = run(level, true);
  const empty = run(level, false);
  return {
    id: level.id,
    name: level.name,
    skipped: false,
    solutionSolves: good.solved,
    seconds: good.seconds,
    solvesAlone: empty.solved,
    emptyFails: empty.failed !== null,
    problem,
    ok: good.solved && !good.failed && !empty.solved && problem === '',
  };
}

export function testAllLevels(): LevelTestResult[] {
  return LEVELS.map(testLevel);
}
