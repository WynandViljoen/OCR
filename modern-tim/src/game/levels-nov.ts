/**
 * The November 2026 puzzle set: the same 21 puzzles (same ids and names), each changed a little and made harder.
 * A level here starts from its October version and says what is different; `solution` is the recorded way to
 * solve the November version (check-levels plays every one on the real physics).
 */
import { LEVELS, basketWithFunnel, type Level, type LevelPart } from './levels';

const base = (id: string): Level => {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`no base level ${id}`);
  return l;
};

/** The October level with some changes. `fixed` is a function from the October fixed parts to the new ones. */
function nov(id: string, change: { goal?: string; hint?: string; fixed?: (f: LevelPart[]) => LevelPart[]; inventory?: Level['inventory']; presets?: Level['presets']; solution?: LevelPart[]; goalTargets?: string[] }): Level {
  const b = base(id);
  return {
    ...b,
    goal: change.goal ?? b.goal,
    hint: change.hint ?? b.hint,
    fixed: change.fixed ? change.fixed(b.fixed.map((p) => ({ ...p }))) : b.fixed.map((p) => ({ ...p })),
    inventory: change.inventory === undefined ? b.inventory : change.inventory,
    presets: change.presets ?? b.presets,
    solution: change.solution ?? b.solution?.map((p) => ({ ...p })),
    goalTargets: change.goalTargets ?? b.goalTargets,
  };
}

/** Replace the basket and its funnel (the three parts basketWithFunnel makes) with ones at a new place. */
const moveBasket = (f: LevelPart[], cx: number): LevelPart[] => [...f.filter((p, i, a) => !(p.type === 'basket' || (p.type === 'wall' && p.h === 12 && Math.abs(Math.abs(p.angle ?? 0) - 45) < 1))), ...basketWithFunnel(cx)];

export const NOV_BY_ID: Record<string, Level> = {
  ramps: nov('ramps', {
    inventory: { plank: 3 },
    solution: [{ type: 'plank', x: 210, y: 260, angle: 30 }, { type: 'plank', x: 370, y: 330, angle: 15 }],
    goal: 'A wall now stands between you and the basket. Get the ball into it.',
    fixed: (f) => [{ type: 'ball', x: 180, y: 60 }, { type: 'wall', x: 520, y: 500, w: 20, h: 200 }, ...basketWithFunnel(680)],
  }),
  conveyor: nov('conveyor', {
    inventory: { conveyor: 3 },
    solution: [{ type: 'conveyor', x: 180, y: 310 }, { type: 'conveyor', x: 435, y: 360 }],
    fixed: (f) => [{ type: 'ball', x: 130, y: 200 }, ...f.filter((p) => p.type === 'wall' && p.w === 300), ...basketWithFunnel(660)],
  }),
  springs: nov('springs', {
    solution: [{ type: 'spring', x: 115, y: 485, angle: 20 }],
    fixed: (f) => [{ type: 'ball', x: 120, y: 80 }, { type: 'wall', x: 450, y: 450, w: 24, h: 300 }, ...basketWithFunnel(800)],
  }),
  levers: nov('levers', {
    solution: [{ type: 'heavyBall', x: 345, y: 45 }],
    fixed: (f) => [...moveBasket(f, 720)],
  }),
  dominoes: nov('dominoes', {
    solution: [{ type: 'domino', x: 322, y: 255 }, { type: 'domino', x: 385, y: 239 }, { type: 'domino', x: 430, y: 239 }, { type: 'domino', x: 475, y: 239 }],
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 470 ? { ...p, x: 490 } : p.type === 'ball' && p.x === 500 ? { ...p, x: 520 } : p)),
  }),
  gears: nov('gears', {
    solution: [{ type: 'bigGear', x: 182, y: 209.9 }, { type: 'gear', x: 276.5, y: 226.6 }, { type: 'bigGear', x: 371.1, y: 243.3 }, { type: 'gear', x: 463.1, y: 270.8 }],
    goal: 'The paddle is farther away and you have no string. Connect the motor to the paddle gear so it bats the ball to the RIGHT.',
    fixed: () => [{ type: 'motorGear', x: 130, y: 300 }, { type: 'paddleGear', x: 520, y: 300 }, { type: 'wall', x: 520, y: 418, w: 260, h: 20 }, { type: 'ball', x: 520, y: 394 }, ...basketWithFunnel(790)],
    inventory: { gear: 3, bigGear: 2 },
  }),
  spin: nov('spin', {
    inventory: { gear: 4, bigGear: 2 },
    solution: [{ type: 'bigGear', x: 227.2, y: 263.4 }, { type: 'gear', x: 243.9, y: 168.8 }, { type: 'bigGear', x: 339.9, y: 168.8 }, { type: 'gear', x: 413.4, y: 230.5 }, { type: 'gear', x: 470.6, y: 259.4 }],
    goal: 'No motor, and the right paddle is much farther away! The heavy ball spins the left paddle gear. Pass the spin along so the right paddle bats the small ball into the basket.',
    fixed: (f) => [{ type: 'heavyBall', x: 126, y: 60 }, { type: 'paddleGear', x: 137, y: 296.2 }, { type: 'paddleGear', x: 520, y: 300 }, { type: 'wall', x: 520, y: 418, w: 260, h: 20 }, { type: 'ball', x: 520, y: 394 }, ...basketWithFunnel(850)],
  }),
  pulleys2: nov('pulleys2', {
    inventory: { pulley: 1, rope: 1, plank: 2, spring: 1 },
    solution: [{ type: 'pulley', x: 305, y: 25, key: 'pul' }, { type: 'rope', x: 290, y: 300, link: { a: 'eff', via: 'pul', b: 'load' } }, { type: 'plank', x: 130, y: 95, angle: 15 }, { type: 'spring', x: 160, y: 550, angle: 25 }],
    fixed: (f) => f.map((p) => (p.type === 'wall' || (p.type === 'crate' && p.key === 'eff') ? { ...p, x: p.x + 15 } : p)),
    goal: 'Lift the load crate up into the upside-down basket. The heavy crate on the high ledge would do it, but it is stuck there. You have only one plank to help the bowling ball free it.',
  }),
  machine: nov('machine', {
    solution: [{ type: 'conveyor', x: 313.5, y: 244.8, angle: -15 }, { type: 'conveyor', x: 450, y: 270, angle: -15 }, { type: 'spring', x: 630, y: 570 }],
    fixed: (f) => [...f.filter((p) => !(p.type === 'basket' || (p.type === 'wall' && (p.h === 12 || p.x === 730)))), { type: 'wall', x: 730, y: 470, w: 24, h: 260 }, ...basketWithFunnel(900)],
  }),
  overtop: nov('overtop', {
    solution: [{ type: 'spring', x: 160, y: 570, angle: 35 }, { type: 'plank', x: 660, y: 280, angle: -25 }],
    goal: 'The basket sits on a higher platform behind a taller wall, under a lower ceiling. Get the ball in.',
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 450 ? { ...p, y: 450, h: 300 } : p.type === 'wall' && p.x === 800 ? { ...p, y: 305 } : p.type === 'basket' ? { ...p, y: 260 } : p.type === 'wall' && p.y === 150 ? { ...p, y: 130 } : p)),
  }),
  bridge: nov('bridge', {
    inventory: { domino: 10, plank: 1 },
    solution: [{ type: 'plank', x: 440, y: 312 }, { type: 'domino', x: 275, y: 268 }, { type: 'domino', x: 325, y: 268 }, { type: 'domino', x: 375, y: 268 }, { type: 'domino', x: 425, y: 268 }, { type: 'domino', x: 475, y: 268 }, { type: 'domino', x: 525, y: 268 }, { type: 'domino', x: 575, y: 268 }, { type: 'domino', x: 625, y: 268 }, { type: 'domino', x: 675, y: 268 }],
    fixed: (f) => [...f.filter((p) => !(p.type === 'basket' || (p.type === 'wall' && p.h === 12) || p.type === 'ball' || (p.type === 'wall' && p.x === 580))), { type: 'wall', x: 640, y: 330, w: 260, h: 20 }, { type: 'ball', x: 760, y: 304 }, ...basketWithFunnel(850)],
  }),
  chain: nov('chain', {
    inventory: { domino: 4 },
    solution: [{ type: 'domino', x: 250, y: 145 }, { type: 'domino', x: 295, y: 145 }, { type: 'domino', x: 335, y: 145 }],
    fixed: (f) => moveBasket(f, 710),
  }),
  double: nov('double', {
    inventory: { domino: 8 },
    solution: [{ type: 'domino', x: 250, y: 145 }, { type: 'domino', x: 295, y: 145 }, { type: 'domino', x: 335, y: 145 }, { type: 'domino', x: 620, y: 305 }, { type: 'domino', x: 675, y: 305 }, { type: 'domino', x: 730, y: 305 }, { type: 'domino', x: 785, y: 305 }],
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 470 ? { ...p, x: 510, angle: 14 } : p)),
  }),
  reach: nov('reach', {
    goal: 'The motor and the paddle are even farther apart, and you have only one big gear. Make the paddle bat the ball to the RIGHT.',
    fixed: () => [{ type: 'motorGear', x: 130, y: 300, key: 'm' }, { type: 'paddleGear', x: 640, y: 300, key: 'p' }, { type: 'wall', x: 640, y: 418, w: 260, h: 20 }, { type: 'ball', x: 640, y: 394 }, ...basketWithFunnel(840)],
    inventory: { gear: 2, bigGear: 1, string: 1 },
    solution: [{ type: 'bigGear', x: 221.3, y: 250.1, key: 'a' }, { type: 'gear', x: 313.1, y: 222, key: 'b' }, { type: 'string', x: 450, y: 300, flip: true, link: { a: 'b', b: 'p' } }],
  }),
  tackle2: nov('tackle2', {
    inventory: { pulley: 1, rope: 1, conveyor: 1, plank: 2, spring: 1 },
    solution: [{ type: 'pulley', x: 282, y: 40, key: 'pul' }, { type: 'rope', x: 290, y: 300, link: { a: 'eff', via: 'pul', b: 'load' } }, { type: 'conveyor', x: 110, y: 105 }, { type: 'plank', x: 170, y: 145, angle: -15 }, { type: 'spring', x: 220, y: 540 }],
    fixed: (f) => f.map((p) => (p.type === 'basket' ? { ...p, y: 420 } : p)),
  }),
  tradeoff2: nov('tradeoff2', {
    inventory: { pulley: 1, rope: 1, plank: 3, spring: 1 },
    solution: [{ type: 'pulley', x: 718, y: 40, key: 'pul' }, { type: 'rope', x: 710, y: 300, link: { a: 'eff', via: 'pul', b: 'load' } }, { type: 'plank', x: 875, y: 105, angle: -15 }, { type: 'plank', x: 880, y: 220, angle: 35 }, { type: 'spring', x: 840, y: 515, angle: 15 }],
    fixed: (f) => f.map((p) => (p.type === 'basket' ? { ...p, y: 295 } : p)),
  }),
  crane3: nov('crane3', {
    solution: [{ type: 'pulley', x: 605, y: 280, key: 'pul' }, { type: 'crate', x: 585, y: 515, key: 'eff' }, { type: 'rope', x: 290, y: 400, link: { a: 'eff', via: 'pul', b: 'load' } }],
    fixed: (f) => [...f.filter((p) => !(p.type === 'basket' || (p.type === 'wall' && p.h === 12 && Math.abs(Math.abs(p.angle ?? 0) - 45) < 1))), ...basketWithFunnel(480)],
  }),
  skyhigh: nov('skyhigh', {
    solution: [{ type: 'spring', x: 120, y: 510, angle: 20 }, { type: 'plank', x: 680, y: 345, angle: -10 }, { type: 'plank', x: 705, y: 195, angle: -20 }],
    goal: 'An even taller wall, a higher platform and a lower ceiling. This one needs more than a single bounce.',
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 430 ? { ...p, x: 460, y: 410, h: 360 } : p.type === 'wall' && p.x === 830 ? { ...p, y: 235 } : p.type === 'basket' ? { ...p, y: 190 } : p.type === 'wall' && p.y === 120 ? { ...p, y: 118 } : p)),
  }),
  slalom: nov('slalom', {
    solution: [{ type: 'plank', x: 115, y: 415, angle: 25 }, { type: 'spring', x: 390, y: 570, angle: -10 }, { type: 'plank', x: 580, y: 380, angle: 25 }, { type: 'plank', x: 805, y: 370, angle: 35 }],
    goal: 'Weave through the gates: under the first wall, over the second (it is taller now), then under the third and on to the basket. You have one strong spring.',
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 470 ? { ...p, y: 425, h: 340 } : p.type === 'wall' && p.x === 650 ? { ...p, y: 172, h: 344 } : p)),
  }),
  maze: nov('maze', {
    solution: [{ type: 'plank', x: 250, y: 380, angle: 30 }, { type: 'spring', x: 350, y: 540, angle: 10 }, { type: 'plank', x: 635, y: 320, angle: 10 }, { type: 'plank', x: 685, y: 420, angle: -20 }],
    fixed: (f) => f.map((p) => (p.type === 'wall' && p.x === 450 ? { ...p, y: 150, h: 380 } : p.type === 'wall' && p.x === 590 ? { ...p, y: 465, h: 270 } : p)),
  }),
  energy: nov('energy', {
    solution: [{ type: 'plank', x: 140, y: 130, angle: 25 }, { type: 'plank', x: 285, y: 205, angle: 5 }, { type: 'plank', x: 575, y: 360, angle: -30 }],
    fixed: (f) => [...f.filter((p) => !(p.type === 'wall' && (p.x === 740 || p.x === 440))), { type: 'wall', x: 440, y: 400, w: 110, h: 16 }, { type: 'wall', x: 740, y: 460, w: 20, h: 280 }, { type: 'wall', x: 620, y: 250, w: 220, h: 16 }].map((p) => (p.type === 'ball' ? { ...p, x: 460 } : p)),
  }),
  sandbox: base('sandbox'),
};

/** In game order (the order of the October set). */
export const NOV_LEVELS: Level[] = LEVELS.map((l) => NOV_BY_ID[l.id] ?? l);
