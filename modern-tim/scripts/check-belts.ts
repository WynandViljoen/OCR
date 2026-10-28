/**
 * Gear-train and tinkering maths (strings, pulleys, motor speed). No physics engine needed.
 *   npm run check-belts
 */
import assert from 'node:assert/strict';
import { computeGearTrain } from '../src/game/mechanics';
import { PROP_SPECS, feelOf, partProp, propValue } from '../src/game/props';
import type { PlacedPart } from '../src/game/parts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`OK ${name}`);
}
const gear = (id: number, type: PlacedPart['type'], x: number, y = 0, extra: Partial<PlacedPart> = {}): PlacedPart => ({ id, type, x, y, angle: 0, ...extra });
const string = (id: number, a: number, b: number, extra: Partial<PlacedPart> = {}): PlacedPart => ({ id, type: 'string', x: 0, y: 0, angle: 0, link: { a, b }, ...extra });
const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

check('a motor with no speed change turns at the old default', () => {
  const t = computeGearTrain([gear(1, 'motorGear', 0)]);
  near(t.speeds.get(1), 0.05);
  near(computeGearTrain([gear(1, 'motorGear', 0, 0, { flip: true })]).speeds.get(1), -0.05);
});

check('meshed gears still turn opposite ways, scaled by size (unchanged)', () => {
  const t = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'bigGear', 104)]); // 40 + 64
  near(t.speeds.get(2), (-0.05 * 40) / 64);
});

check('a string joins two far-apart gears and they turn the same way', () => {
  const t = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 400), string(3, 1, 2)]);
  near(t.speeds.get(2), 0.05);
  assert.equal(t.jammed.size, 0);
});

check('a crossed string turns the other gear the opposite way', () => {
  const t = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 400), string(3, 1, 2, { flip: true })]);
  near(t.speeds.get(2), -0.05);
});

check('a bigger second pulley turns slower, a smaller one faster', () => {
  const big = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 400), string(3, 1, 2, { props: { pulley: 2 } })]);
  near(big.speeds.get(2), 0.025);
  const small = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 400), string(3, 1, 2, { props: { pulley: 0.5 } })]);
  near(small.speeds.get(2), 0.1);
});

check('the string works in either direction and chains through meshing gears', () => {
  // motor -(string)-> A, A meshes B; the string is tied from B... order of ends does not matter
  const t = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 400), gear(3, 'gear', 464), string(4, 2, 1)]);
  near(t.speeds.get(2), 0.05);
  near(t.speeds.get(3), -0.05);
});

check('a string that disagrees with a mesh jams the gears', () => {
  // motor meshes gear 2; a straight string also joins them: mesh says opposite, string says same
  const t = computeGearTrain([gear(1, 'motorGear', 0), gear(2, 'gear', 72), string(3, 1, 2)]);
  assert.ok(t.jammed.has(1) && t.jammed.has(2));
  near(t.speeds.get(2), 0);
});

check('a string with a missing gear is ignored', () => {
  const t = computeGearTrain([gear(1, 'motorGear', 0), string(3, 1, 99)]);
  near(t.speeds.get(1), 0.05);
});

check('every slider default is a value its own slider can land on', () => {
  for (const [type, specs] of Object.entries(PROP_SPECS)) {
    for (const s of specs!) {
      assert.ok(s.min < s.max && s.def >= s.min - 1e-12 && s.def <= s.max + 1e-12, `${type}.${s.key} default out of range`);
      const steps = (s.def - s.min) / s.step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${type}.${s.key} default is between slider ticks`);
      assert.ok(s.show(s.def).length > 0 && feelOf(s, s.def).length > 0 && feelOf(s, s.min).length > 0 && feelOf(s, s.max).length > 0);
    }
  }
});

check('an untouched part reads its default; a tinkered one reads the player value', () => {
  assert.equal(propValue('ball', undefined, 'bounce'), 0.45);
  assert.equal(propValue('ball', { bounce: 0.9 }, 'bounce'), 0.9);
  assert.equal(propValue('ball', { bounce: NaN }, 'bounce'), 0.45);
  assert.equal(propValue('conveyor', undefined, 'speed'), 3.2);
  assert.equal(partProp({ type: 'spring', power: 3 }, 'power'), 3);
  assert.equal(partProp({ type: 'spring' }, 'power'), 2);
});

console.log(`\n${passed} checks passed`);
