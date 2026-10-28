/**
 * Level data. Each level teaches one science idea.
 *
 *  - `fixed`      parts that are always present. Locked unless `movable: true`.
 *  - `inventory`  how many of each part the player may add (`null` = unlimited)
 *  - `hasGoal`    whether a ball reaching a basket sensor wins
 *  - `solution`   a known-good set of player parts; the test harness checks it
 *  - `science`    the "Science corner" text shown beside the playfield
 *
 * Coordinates are playfield pixels (1000 x 620, floor top at y = 600).
 * Angles are DEGREES here, clockwise-positive (a positive ramp slopes down to the right).
 */
import type { PartType, PlacedPart } from './parts';

export interface LevelPart {
  type: PartType;
  x: number;
  y: number;
  angle?: number;
  w?: number;
  h?: number;
  flip?: boolean;
  power?: number;
  /** Pre-placed but the player may move/rotate/delete it. */
  movable?: boolean;
}

export interface Science {
  topic: string;
  text: string;
  tryThis: string;
  learned: string;
}

export interface Level {
  id: string;
  name: string;
  goal: string;
  hasGoal: boolean;
  goalTargets?: string[];
  fixed: LevelPart[];
  inventory: Partial<Record<PartType, number>> | null;
  solution?: LevelPart[];
  science: Science;
}

/** A basket on the floor with a funnel above it: landing window about cx ± 95 at y = 445. */
function basketWithFunnel(cx: number): LevelPart[] {
  return [
    { type: 'basket', x: cx, y: 565 },
    { type: 'wall', x: cx - 60, y: 480, angle: 45, w: 100, h: 12 },
    { type: 'wall', x: cx + 60, y: 480, angle: -45, w: 100, h: 12 },
  ];
}

export const LEVELS: Level[] = [
  {
    id: 'ramps',
    name: 'Ramps',
    goal: 'Get the ball into the basket.',
    hasGoal: true,
    fixed: [{ type: 'ball', x: 300, y: 60 }, ...basketWithFunnel(560)],
    inventory: { plank: 2 },
    solution: [{ type: 'plank', x: 330, y: 300, angle: 30 }],
    science: {
      topic: 'Gravity and ramps',
      text: 'Gravity pulls everything straight down. A ramp (scientists call it an inclined plane) turns that straight-down fall into a sideways roll.',
      tryThis: 'Make the ramp steeper, then flatter. Which one gets the ball there faster?',
      learned: 'You used an inclined plane, one of the six simple machines.',
    },
  },
  {
    id: 'conveyor',
    name: 'Conveyors',
    goal: 'The ball is stuck on a shelf. Move it into the basket.',
    hasGoal: true,
    fixed: [
      { type: 'ball', x: 150, y: 200 },
      { type: 'wall', x: 240, y: 330, w: 300, h: 20 },
      ...basketWithFunnel(560),
    ],
    inventory: { conveyor: 2 },
    solution: [
      { type: 'conveyor', x: 180, y: 310 },
      { type: 'conveyor', x: 330, y: 310 },
    ],
    science: {
      topic: 'Forces and friction',
      text: 'A force is a push or a pull. Nothing starts moving without one. A conveyor belt grips the ball with friction and pushes it along.',
      tryThis: 'Select a conveyor and press F to reverse it. Which way does the ball go now?',
      learned: 'Things stay still until a force moves them. That is Newton’s first law.',
    },
  },
  {
    id: 'springs',
    name: 'Springs',
    goal: 'A wall is in the way. Bounce the ball over it.',
    hasGoal: true,
    fixed: [
      { type: 'ball', x: 150, y: 80 },
      { type: 'wall', x: 450, y: 470, w: 24, h: 260 },
      ...basketWithFunnel(740),
    ],
    inventory: { spring: 1, plank: 1 },
    solution: [{ type: 'spring', x: 150, y: 570, angle: 15, power: 2 }],
    science: {
      topic: 'Elastic energy',
      text: 'When the ball lands on a spring, the spring squashes and stores the ball’s energy. Then it springs back and gives the energy back. Tilt the spring to aim the bounce.',
      tryThis: 'Click the spring and change its strength. How high does each setting bounce?',
      learned: 'Falling energy turned into spring energy, then back into motion. Energy changes form but never disappears.',
    },
  },
  {
    id: 'levers',
    name: 'Levers',
    goal: 'Launch the blue ball into the basket using the seesaw.',
    hasGoal: true,
    fixed: [
      { type: 'seesaw', x: 260, y: 546, angle: -25, w: 220 },
      { type: 'ball', x: 175, y: 560 },
      ...basketWithFunnel(600),
    ],
    inventory: { heavyBall: 1, plank: 1 },
    solution: [{ type: 'heavyBall', x: 340, y: 100 }],
    science: {
      topic: 'Levers and fulcrums',
      text: 'A seesaw is a lever: a stiff bar that turns on a point called the fulcrum. A big push down on one end makes the other end fly up.',
      tryThis: 'Drop the bowling ball from different heights. The dotted line shows where the last throw went.',
      learned: 'A heavy push on one side of a lever lifts the other side. Catapults work this way.',
    },
  },
  {
    id: 'dominoes',
    name: 'Dominoes',
    goal: 'The ball gets stuck in the gap. Knock the far ball into the basket.',
    hasGoal: true,
    fixed: [
      { type: 'ball', x: 100, y: 60 },
      { type: 'plank', x: 140, y: 200, angle: 20, w: 150 },
      { type: 'wall', x: 195, y: 300, w: 270, h: 20 },
      { type: 'wall', x: 470, y: 284, w: 220, h: 20 },
      { type: 'ball', x: 500, y: 260 },
      ...basketWithFunnel(650),
    ],
    inventory: { domino: 6 },
    solution: [
      { type: 'domino', x: 322, y: 255 },
      { type: 'domino', x: 368, y: 239 },
      { type: 'domino', x: 408, y: 239 },
      { type: 'domino', x: 448, y: 239 },
    ],
    science: {
      topic: 'Chain reactions',
      text: 'A standing domino stores energy because it is tall and wobbly. A tiny push tips it, and as it falls it pushes the next one. The energy travels down the line.',
      tryThis: 'Spread the dominoes farther apart. How big can the gap get before the chain stops?',
      learned: 'One small push set off a whole chain reaction.',
    },
  },
  {
    id: 'gears',
    name: 'Gears',
    goal: 'Connect the motor to the paddle gear so it bats the ball to the RIGHT.',
    hasGoal: true,
    fixed: [
      { type: 'motorGear', x: 130, y: 300 },
      { type: 'paddleGear', x: 430, y: 300 },
      { type: 'wall', x: 430, y: 418, w: 260, h: 20 },
      { type: 'ball', x: 430, y: 394 },
      ...basketWithFunnel(700),
    ],
    inventory: { gear: 3, bigGear: 2 },
    solution: [
      { type: 'bigGear', x: 221.3, y: 250.1 },
      { type: 'bigGear', x: 349.3, y: 248.1 },
    ],
    science: {
      topic: 'Gear trains',
      text: 'Gears pass turning along. When two gears mesh, they spin in opposite directions. Bigger gears turn slower. Drop a gear near another and it clicks into place.',
      tryThis: 'Watch the arrows before you press Start. Can you predict which way the paddle will spin?',
      learned: 'Every gear in a train flips the direction, so counting gears tells you which way the last one turns.',
    },
  },
  {
    id: 'machine',
    name: 'Big machine',
    goal: 'Use everything you learned: get the ball up the hill, over the wall, and into the basket.',
    hasGoal: true,
    fixed: [
      { type: 'ball', x: 90, y: 60 },
      { type: 'plank', x: 140, y: 170, angle: 25, w: 150 },
      { type: 'wall', x: 330, y: 260, angle: -15, w: 260, h: 20 },
      { type: 'wall', x: 207, y: 270, w: 10, h: 40 },
      { type: 'wall', x: 730, y: 490, w: 24, h: 220 },
      ...basketWithFunnel(870),
    ],
    inventory: { conveyor: 2, spring: 1, plank: 1 },
    solution: [
      { type: 'conveyor', x: 272, y: 256, angle: -15 },
      { type: 'conveyor', x: 393, y: 224, angle: -15 },
      { type: 'spring', x: 630, y: 570, angle: 0, power: 2 },
    ],
    science: {
      topic: 'Systems',
      text: 'Real machines are systems: many simple parts working together. Each part passes energy to the next one. Engineers test each step on its own, then the whole machine.',
      tryThis: 'Build one step at a time. Press Start after each step and watch the dotted path.',
      learned: 'You built a Rube Goldberg machine: a chain of simple machines doing one job together.',
    },
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    goal: 'Free build: every part, no limits. Invent your own machine!',
    hasGoal: false,
    fixed: [],
    inventory: null,
    science: {
      topic: 'Be an engineer',
      text: 'Engineers build, test, and improve. Try an idea, press Start, watch what happens, then change one thing and test again.',
      tryThis: 'Build a machine that uses a ramp, a spring and a gear all at once.',
      learned: '',
    },
  },
];

function toPlaced(p: LevelPart, id: number, locked: boolean): PlacedPart {
  return {
    id,
    type: p.type,
    x: p.x,
    y: p.y,
    angle: ((p.angle ?? 0) * Math.PI) / 180,
    w: p.w,
    h: p.h,
    flip: p.flip,
    power: p.power,
    locked,
  };
}

/** Level fixed parts as placed parts (locked unless marked movable). */
export function levelToParts(level: Level, nextId: () => number): PlacedPart[] {
  return level.fixed.map((p) => toPlaced(p, nextId(), !p.movable));
}

/** The recorded solution as unlocked player parts. */
export function solutionToParts(level: Level, nextId: () => number): PlacedPart[] {
  return (level.solution ?? []).map((p) => toPlaced(p, nextId(), false));
}
