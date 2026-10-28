/**
 * Rope-and-pulley maths: real pulley results, no physics engine.
 *   npm run check-ropes
 */
import assert from 'node:assert/strict';
import { ropeLength, solveRope, type RopeBody } from '../src/game/rope';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`OK ${name}`);
}

const G = 0.5; // px per step per step; any positive number works for the ratios
const P = { x: 500, y: 100 };
const R = 18; // pulley radius
const PA = { x: P.x - R, y: P.y }; // where the rope leaves the rim on A's side
const PB = { x: P.x + R, y: P.y };

/** Hang weights on either side of a pulley, run the rope, report how A moved. */
function hang(massA: number, massB: number, strands = 1, steps = 60, startA = 200, startB = 200) {
  const a: RopeBody = { x: PA.x, y: startA, vx: 0, vy: 0, mass: massA };
  const b: RopeBody = { x: PB.x, y: startB, vx: 0, vy: 0, mass: massB };
  const length = ropeLength(a, b, PA, PB, strands);
  const startAy = a.y;
  let jerk = 0;
  for (let i = 0; i < steps; i++) {
    a.vy += G;
    b.vy += G;
    a.y += a.vy;
    b.y += b.vy;
    const r = solveRope(a, b, PA, PB, strands, length);
    a.vx = r.a.vx; a.vy = r.a.vy; b.vx = r.b.vx; b.vy = r.b.vy;
    a.x += r.moveA.x; a.y += r.moveA.y; b.x += r.moveB.x; b.y += r.moveB.y;
    jerk = Math.max(jerk, Math.abs(a.vy));
  }
  return { a, b, dropA: a.y - startAy, length, jerk };
}

check('equal weights hang perfectly still', () => {
  const r = hang(2, 2);
  assert.ok(Math.abs(r.dropA) < 1, `A moved ${r.dropA}`);
});

check('the heavier side drops and lifts the lighter side', () => {
  const r = hang(3, 1);
  assert.ok(r.dropA > 50, `A should fall, moved ${r.dropA}`);
  assert.ok(r.b.y < 200 - 50, `B should rise, y=${r.b.y}`);
});

check('acceleration matches (mA - mB) g / (mA + mB)', () => {
  const r = hang(3, 1, 1, 30);
  // A starts at rest, so after n steps it has fallen about a n^2 / 2 with a = G (3-1)/(3+1)
  const a = (G * (3 - 1)) / (3 + 1);
  const expected = 0.5 * a * 30 * 30;
  assert.ok(Math.abs(r.dropA - expected) / expected < 0.12, `fell ${r.dropA}, expected about ${expected}`);
});

check('the rope never stretches', () => {
  const r = hang(5, 1, 1, 16);
  const len = Math.hypot(r.a.x - PA.x, r.a.y - PA.y) + Math.hypot(r.b.x - PB.x, r.b.y - PB.y);
  assert.ok(Math.abs(len - r.length) < 1.5, `length drifted by ${len - r.length}`);
});

check('two strands: a load twice as heavy balances the effort', () => {
  const r = hang(1, 2, 2); // effort A = 1, load B = 2 on two strands
  assert.ok(Math.abs(r.dropA) < 1.5, `should balance, A moved ${r.dropA}`);
});

check('two strands: a heavier effort lifts the load, and the load moves half as far', () => {
  const r = hang(2, 2, 2, 45);
  assert.ok(r.dropA > 40, `effort should fall, moved ${r.dropA}`);
  const bRise = 200 - r.b.y;
  assert.ok(Math.abs(bRise - r.dropA / 2) / (r.dropA / 2) < 0.15, `load rose ${bRise} for effort drop ${r.dropA}`);
});

check('two strands: too heavy a load is not lifted, the effort is hauled up', () => {
  const r = hang(1, 3, 2, 45);
  assert.ok(r.dropA < -20, `effort should be hauled up, moved ${r.dropA}`);
});

check('a slack rope does nothing', () => {
  const a: RopeBody = { x: PA.x, y: 200, vx: 0, vy: 3, mass: 1 };
  const b: RopeBody = { x: PB.x, y: 200, vx: 0, vy: -3, mass: 1 };
  const r = solveRope(a, b, PA, PB, 1, 1000);
  assert.equal(r.tight, false);
  assert.equal(r.a.vy, 3);
});

check('pulley friction slows everything down', () => {
  const slick = hang(3, 1, 1, 30);
  const a: RopeBody = { x: PA.x, y: 200, vx: 0, vy: 5, mass: 3 };
  const b: RopeBody = { x: PB.x, y: 200, vx: 0, vy: -5, mass: 1 };
  const len = ropeLength(a, b, PA, PB, 1);
  const r = solveRope(a, b, PA, PB, 1, len, 0.1);
  assert.ok(slick.dropA > 0 && Math.abs(r.a.vy) < Math.abs(solveRope(a, b, PA, PB, 1, len, 0).a.vy));
});

check('a rope end with no mass or sitting on the pulley is ignored safely', () => {
  const r = solveRope({ x: PA.x, y: PA.y, vx: 0, vy: 1, mass: 1 }, { x: PB.x, y: 200, vx: 0, vy: 1, mass: 1 }, PA, PB, 1, 100);
  assert.equal(r.tight, false);
});

console.log(`\n${passed} checks passed`);
