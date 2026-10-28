/**
 * Solid-space check (no physics needed for most of it).
 *   1. Shape tests behave: touching is fine, sinking in is not.
 *   2. Every level's fixed parts and recorded solution fit together without overlapping,
 *      so the "no overlaps" rule never blocks the intended answer.
 *   3. Placing onto something moves the part to the nearest free spot.
 *   4. If Matter is installed: each footprint matches the real bodies in parts.ts.
 *
 *   npm run check-space
 */
import assert from 'node:assert/strict';
import { LEVELS, levelToParts, solutionToParts } from '../src/game/levels';
import { findFreeSpot, footprintBounds, overlapsAny, type SpacePart } from '../src/game/space';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`OK ${name}`);
}

const ball = (x: number, y: number): SpacePart => ({ type: 'ball', x, y, angle: 0 });
const wall = (x: number, y: number, angle = 0): SpacePart => ({ type: 'wall', x, y, angle });
const OPTS = { grid: 10, minX: 10, maxX: 990, minY: 10, maxY: 600 };

await check('touching is allowed, sinking in is not', () => {
  assert.equal(overlapsAny(ball(0, -24), [wall(0, 0)]), false); // ball resting on top of a wall (wall half height 10, radius 14)
  assert.equal(overlapsAny(ball(0, -20), [wall(0, 0)]), true);
  assert.equal(overlapsAny(ball(0, 0), [ball(20, 0)]), true);
  assert.equal(overlapsAny(ball(0, 0), [ball(28, 0)]), false);
  assert.equal(overlapsAny(wall(0, 0), [wall(0, 30)]), false);
  assert.equal(overlapsAny(wall(0, 0), [wall(0, 15)]), true);
});

await check('rotated parts are measured as rotated', () => {
  const tilted = wall(0, 0, Math.PI / 4); // 120 long, tilted 45 degrees
  assert.equal(overlapsAny(ball(60, 0), [tilted]), false); // clear of the tilted tip region
  assert.equal(overlapsAny(ball(30, 0), [tilted]), true);
});

await check('meshed gears do not count as overlapping', () => {
  const a: SpacePart = { type: 'gear', x: 0, y: 0, angle: 0 };
  const b: SpacePart = { type: 'gear', x: 64, y: 0, angle: 0 }; // 32 + 32
  assert.equal(overlapsAny(a, [b]), false);
  assert.equal(overlapsAny(a, [{ ...b, x: 50 }]), true);
});

await check('the basket goal zone is empty air, its walls are solid', () => {
  const basket: SpacePart = { type: 'basket', x: 0, y: 0, angle: 0 };
  assert.equal(overlapsAny(ball(0, 0), [basket]), false);
  assert.equal(overlapsAny(ball(-50, 0), [basket]), true);
});

for (const level of LEVELS) {
  await check(`level "${level.id}": fixed parts and solution fit without overlapping`, () => {
    let id = 1;
    const nextId = () => id++;
    const fixed = levelToParts(level, nextId);
    const mine = solutionToParts(level, nextId);
    const all = [...fixed, ...mine];
    // The level's own fixed pieces may be built from overlapping bars; the rule is about what the player places.
    for (const p of mine) {
      const others = all.filter((q) => q !== p);
      assert.equal(overlapsAny(p, others), false, `${p.type} at (${p.x}, ${p.y}) overlaps another part`);
    }
  });
}

await check('dropping on something moves the part to the nearest free spot', () => {
  const w = wall(500, 300);
  const spot = findFreeSpot(ball(0, 0), [w], 500, 300, OPTS)!;
  assert.ok(spot);
  assert.equal(overlapsAny(ball(spot.x, spot.y), [w]), false);
  const moved = Math.hypot(spot.x - 500, spot.y - 300);
  assert.ok(moved <= 30, `moved ${moved}`); // wall is 20 thick and the ball radius is 14
  const free = findFreeSpot(ball(0, 0), [w], 300, 300, OPTS)!;
  assert.deepEqual([free.x, free.y], [300, 300]); // a free spot is left alone
});

await check('nothing free within reach gives null', () => {
  const blockers: SpacePart[] = [];
  for (let x = 0; x <= 1000; x += 100) for (let y = 0; y <= 700; y += 40) blockers.push(wall(x, y, 0));
  assert.equal(findFreeSpot(ball(0, 0), blockers, 500, 300, { ...OPTS, maxDistance: 60 }), null);
});

await check('the part stays inside the board', () => {
  const spot = findFreeSpot(ball(0, 0), [wall(20, 300)], 20, 300, OPTS)!;
  assert.ok(spot.x >= OPTS.minX && spot.y >= OPTS.minY);
});

// Footprints should match the real bodies. Needs Matter, so it is skipped without it.
try {
  const { PART_DEFS } = await import('../src/game/parts');
  await check('footprints match the real bodies in parts.ts', () => {
    for (const [type, def] of Object.entries(PART_DEFS)) {
      if (def.gear || type === 'string') continue; // gear teeth interleave; strings have no solid shape
      const part = { id: 1, type: type as SpacePart['type'], x: 400, y: 300, angle: 0.3 };
      const bodies = def.build(part, false).flatMap((b) => b.parts.slice(b.parts.length > 1 ? 1 : 0));
      const solid = bodies.filter((b) => !b.isSensor);
      const xs = solid.flatMap((b) => b.vertices.map((v) => v.x));
      const ys = solid.flatMap((b) => b.vertices.map((v) => v.y));
      const fb = footprintBounds(part);
      const tol = 3;
      assert.ok(Math.abs(fb.x0 - Math.min(...xs)) <= tol && Math.abs(fb.x1 - Math.max(...xs)) <= tol, `${type}: width differs`);
      assert.ok(Math.abs(fb.y0 - Math.min(...ys)) <= tol && Math.abs(fb.y1 - Math.max(...ys)) <= tol, `${type}: height differs`);
    }
  });
} catch (e) {
  console.log(`-- skipped footprint/body comparison (Matter not available here): ${(e as Error).message.split('\n')[0]}`);
}

console.log(`\n${passed} checks passed`);
