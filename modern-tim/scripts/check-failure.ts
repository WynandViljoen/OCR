/**
 * A run that cannot succeed any more stops by itself (Simulation.failed / onFailed).
 *   npm run check-failure
 */
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { LEVELS, levelToParts, solutionToParts } from '../src/game/levels';
import { Simulation, type FailReason } from '../src/game/world';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`OK ${name}`);
};
const level = (id: string) => LEVELS.find((l) => l.id === id)!;
function make(id: string, withSolution: boolean, goal = true) {
  const l = level(id);
  let n = 1;
  const sim = new Simulation();
  sim.goalEnabled = goal;
  sim.goalTargets = l.goalTargets ?? ['ball'];
  sim.load([...levelToParts(l, () => n++), ...(withSolution ? solutionToParts(l, () => n++) : [])], true);
  const calls: FailReason[] = [];
  sim.onFailed = (r) => calls.push(r);
  return { sim, calls };
}
function runUntilDone(sim: Simulation, seconds: number) {
  let s = 0;
  while (!sim.solved && !sim.failed && s < seconds * 60) {
    sim.step();
    s++;
  }
  return s / 60;
}

check('an empty board ends by itself as a failure once everything is still, and says so once', () => {
  const { sim, calls } = make('ramps', false);
  const t = runUntilDone(sim, 30);
  assert.equal(sim.failed, 'rest');
  assert.ok(t >= 3 && t < 15, `failed after ${t}s`);
  for (let i = 0; i < 300; i++) sim.step();
  assert.deepEqual(calls, ['rest']);
});

check('a working solution is never called a failure', () => {
  for (const l of LEVELS.filter((x) => x.hasGoal && x.solution)) {
    const { sim, calls } = make(l.id, true);
    runUntilDone(sim, 30);
    assert.equal(sim.solved, true, l.id);
    assert.deepEqual(calls, [], l.id);
  }
});

check('a ball that leaves the play area is a failure at once', () => {
  const { sim, calls } = make('ramps', false);
  for (let i = 0; i < 10; i++) sim.step();
  const ball = Matter.Composite.allBodies(sim.engine.world).find((b) => b.label === 'ball')!;
  Matter.Body.setPosition(ball, { x: -500, y: 100 });
  sim.step();
  assert.equal(sim.failed, 'lost');
  assert.deepEqual(calls, ['lost']);
});

check('the sandbox (no goal) and a new run never fail', () => {
  const sandbox = make('ramps', false, false);
  for (let i = 0; i < 60 * 20; i++) sandbox.sim.step();
  assert.equal(sandbox.sim.failed, null);
  const { sim } = make('ramps', false);
  runUntilDone(sim, 30);
  assert.equal(sim.failed, 'rest');
  let n = 1;
  sim.load(levelToParts(level('ramps'), () => n++), true);
  assert.equal(sim.failed, null, 'loading again clears the failure');
});

console.log(`\n${passed} checks passed`);
