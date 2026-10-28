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
  /** Tinker-lab numbers (for example a crate's weight). */
  props?: Record<string, number>;
  /** A name other parts of the same level can point at (see `link`). */
  key?: string;
  /** For a rope or string: the `key`s of the parts it joins (`via` is the pulley). */
  link?: { a: string; b: string; via?: string };
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
  /** Hint 1 nudges, hint 2 names the parts; hint 3 (the ghost of the solution) comes from `solution`. */
  hints?: [string, string];
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
    hints: [
      "Gravity pulls straight down. What could turn that fall into a sideways roll?",
      "Use a plank as a ramp under the ball, tilted down towards the basket.",
    ],
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
    hints: [
      "The ball cannot roll off its shelf by itself. What could carry it?",
      "Place the conveyors so they carry the ball off the shelf. Check the arrows; F flips the direction.",
    ],
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
    hints: [
      "Something has to push the ball up and over the wall.",
      "Put the spring on the floor where the ball lands, tilted a little towards the far side of the wall.",
    ],
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
    hints: [
      "A seesaw is a lever: weight on one end lifts the other end.",
      "Drop the heavy ball onto the high end of the seesaw so the other end flings the blue ball.",
    ],
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
    hints: [
      "One thing hitting the next makes a chain reaction.",
      "Stand the dominoes in a row between the stuck ball and the far ball, close enough to touch when they fall.",
    ],
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
    hints: [
      "The motor turns one way, and every meshed gear flips the direction.",
      "Link gears from the motor to the paddle gear. Count the gears to predict the paddle's direction; a crossed string flips it.",
    ],
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
    inventory: { gear: 3, bigGear: 2, string: 1 },
    solution: [
      { type: 'bigGear', x: 221.3, y: 250.1 },
      { type: 'bigGear', x: 349.3, y: 248.1 },
    ],
    science: {
      topic: 'Gear trains',
      text: 'Gears pass turning along. When two gears mesh, they spin in opposite directions. Bigger gears turn slower. Drop a gear near another and it clicks into place.',
      tryThis: 'Watch the arrows before you press Start. Can you predict which way the paddle will spin? There is a string too: it joins two gears across a gap, and crossing it (F) flips the direction.',
      learned: 'Every gear in a train flips the direction, so counting gears tells you which way the last one turns.',
    },
  },
  {
    id: 'spin',
    hints: [
      "Anything that hits a paddle makes the gear turn. The falling ball is your motor this time.",
      "Fill the gap between the two paddle gears. Every mesh flips the spin direction, so count the gears: the right paddle must turn the SAME way as the left one to bat its ball to the RIGHT.",
    ],
    name: 'Spin it',
    goal: 'No motor! The heavy ball spins the left paddle gear. Pass the spin along so the right paddle bats the small ball into the basket.',
    hasGoal: true,
    fixed: [
      { type: 'heavyBall', x: 126, y: 60 },
      { type: 'paddleGear', x: 137, y: 296.2 },
      { type: 'paddleGear', x: 430, y: 300 },
      { type: 'wall', x: 430, y: 418, w: 260, h: 20 },
      { type: 'ball', x: 430, y: 394 },
      ...basketWithFunnel(700),
    ],
    inventory: { gear: 3, bigGear: 2 },
    solution: [
      { type: 'bigGear', x: 210.5, y: 234.5 },
      { type: 'gear', x: 285.1, y: 174.0 },
      { type: 'bigGear', x: 356.5, y: 238.3 },
    ],
    science: {
      topic: 'Energy transfer',
      text: 'A falling ball has energy from gravity. When it hits a paddle it hands some of that energy to the gear, and the gear train carries it to the other side. Machines pass energy along, they do not make it from nothing.',
      tryThis: 'Try a chain with two big gears. Does the right paddle spin the same way or the opposite way? Why does an even number of gears give the same direction?',
      learned: 'Energy can travel through a machine: falling ball, to gears, to a bat.',
    },
  },
  {
    id: 'pulleys',
    hints: [
      "A pulley turns a downward pull into an upward lift. The crate has to go UP into the upside-down basket.",
      "Hang the pulley above the crate, a little to its right. Rope: click the crate on the floor, then the pulley, then your own crate. Then press Start. If nothing moves, click your crate and tinker with its weight.",
    ],
    name: 'Pulleys',
    goal: 'Lift the heavy crate up into the upside-down basket. Hint: the rope needs a weight on the other end that wins.',
    hasGoal: true,
    goalTargets: ['crate'],
    fixed: [
      { type: 'crate', x: 250, y: 580, key: 'load' },
      { type: 'basket', x: 250, y: 225, angle: 180 },
    ],
    inventory: { crate: 1, pulley: 1, rope: 1 },
    solution: [
      { type: 'pulley', x: 282, y: 40, key: 'pul' },
      { type: 'crate', x: 306, y: 100, key: 'weight', props: { weight: 0.012 } },
      { type: 'rope', x: 290, y: 300, link: { a: 'load', via: 'pul', b: 'weight' } },
    ],
    science: {
      topic: 'Pulleys and balance',
      text: 'A pulley changes the direction of a pull: pull down on one side and the other side goes up. Both sides feel the same rope tension, so the heavier side wins. To lift a load you need an effort that weighs MORE than the load, or a block and tackle with extra rope strands.',
      tryThis: 'Start with a crate the same weight as the load. Does anything move? Now click your crate and drag its weight slider up. Try the strands slider on the rope too.',
      learned: 'A pulley changes the direction of a force, and the heavier side wins the tug-of-war.',
    },
  },
  {
    id: 'machine',
    hints: [
      "Break it into steps: up the hill, over the wall, into the basket.",
      "Two conveyors carry the ball up the hill, then a spring on the floor flings it over the wall.",
    ],
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
      // Two belts end to end (they used to overlap by ~17 px, which solid space does not allow).
      { type: 'conveyor', x: 313.5, y: 244.8, angle: -15 },
      { type: 'conveyor', x: 458.4, y: 206.0, angle: -15 },
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
    id: 'overtop',
    name: 'Over the Top',
    goal: 'The basket sits on a high platform behind a wall, under a low ceiling. Get the ball in.',
    hasGoal: true,
    hints: [
      "A straight launch hits the ceiling or the wall. You need a high jump first, then a way to steer the ball back down.",
      "Aim the spring up and to the right so the ball sails over the wall. A plank up in the air can then turn the ball so it drops onto the platform.",
    ],
    fixed: [
      { type: 'ball', x: 150, y: 60 },
      { type: 'wall', x: 450, y: 480, w: 24, h: 240 },
      { type: 'wall', x: 800, y: 330, w: 280, h: 20 },
      { type: 'basket', x: 830, y: 285 },
      { type: 'wall', x: 760, y: 150, w: 360, h: 20 },
    ],
    inventory: { spring: 1, plank: 2 },
    solution: [
      { type: 'spring', x: 160, y: 570, angle: 35, power: 3 },
      { type: 'plank', x: 650, y: 260, angle: -10, w: 150 },
    ],
    science: {
      topic: 'Projectile motion',
      text: 'A launched ball flies in an arc. Its sideways speed never changes, but gravity keeps pulling it down, so it rises, slows, and falls. The angle you launch at decides how high and how far it goes.',
      tryThis: 'Try a steeper spring and a flatter spring. Which one clears the wall? Which one hits the ceiling?',
      learned: 'A launch angle trades height for distance, and a bounce can steer a falling ball.',
    },
  },
  {
    id: 'bridge',
    name: 'Domino Bridge',
    goal: 'A heavy ball rolls onto the left shelf. Make a chain of dominoes that crosses the gap and tips the little ball into the funnel.',
    hasGoal: true,
    hints: [
      "Dominoes cannot stand on thin air, and you only have nine. Spread them out so each one still reaches the next when it falls.",
      "Lay a plank across the gap first. Put the first domino where the heavy ball arrives and the last one right next to the small ball, with about the same space between all of them.",
    ],
    fixed: [
      { type: 'heavyBall', x: 90, y: 40 },
      { type: 'plank', x: 130, y: 130, angle: 18, w: 140 },
      { type: 'wall', x: 200, y: 330, w: 260, h: 20 },
      { type: 'wall', x: 580, y: 330, w: 260, h: 20 },
      { type: 'ball', x: 700, y: 304 },
      ...basketWithFunnel(790),
    ],
    inventory: { domino: 9, plank: 1 },
    solution: [
      { type: 'plank', x: 390, y: 312, w: 180 },
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ type: 'domino' as const, x: 275 + i * 50, y: 268 })),
    ],
    science: {
      topic: 'Chain reactions',
      text: 'A falling domino hands its energy to the next one, and that one to the next. The chain only works if every domino is close enough to be hit. Too far apart and the energy has nowhere to go.',
      tryThis: 'Move one domino a little farther away. At what gap does the chain stop?',
      learned: 'Energy passes along a chain only when each link touches the next.',
    },
  },
  {
    id: 'chain',
    name: 'Chain reaction',
    goal: 'Make a chain that carries the energy from the rolling ball to the sleeping ball, and on into the basket.',
    hasGoal: true,
    hints: [
      "The first ball rolls along the shelf and stops short of the heavy ball. Something has to carry its push across the gap.",
      "Stand three dominoes on the shelf between the two heavy balls. When the heavy ball falls it lands on the seesaw and flicks the little ball.",
    ],
    fixed: [
      { type: 'heavyBall', x: 100, y: 30 },
      { type: 'plank', x: 130, y: 120, angle: 20, w: 120 },
      { type: 'wall', x: 260, y: 190, w: 250, h: 20 },
      { type: 'heavyBall', x: 362, y: 162 },
      { type: 'seesaw', x: 370, y: 546, angle: -25, w: 220 },
      { type: 'ball', x: 285, y: 560 },
      ...basketWithFunnel(690),
    ],
    inventory: { domino: 4 },
    solution: [
      { type: 'domino', x: 250, y: 145 },
      { type: 'domino', x: 295, y: 145 },
      { type: 'domino', x: 335, y: 145 },
    ],
    science: {
      topic: 'Energy transfer',
      text: 'Energy cannot vanish, it only moves. Here it moves from a rolling ball to dominoes, to a falling ball, to a seesaw, and finally to the little ball that flies into the basket.',
      tryThis: 'Why does the heavy ball launch the little ball so well? Try it with fewer dominoes.',
      learned: 'A heavy object that falls carries more energy than a light one, and a lever can pass it on.',
    },
  },
  {
    id: 'double',
    name: 'Double dominoes',
    goal: 'Two rows of dominoes, seven in total. The first row wakes the heavy ball, the second row wakes the little ball. Share the dominoes wisely.',
    hasGoal: true,
    hints: [
      "Neither ball can reach the next one by itself: both gaps need a chain. You only have seven dominoes for the two gaps.",
      "Put three dominoes on the top shelf between the starting ball and the heavy ball, and four on the lower shelf where the heavy ball arrives.",
    ],
    fixed: [
      { type: 'heavyBall', x: 100, y: 30 },
      { type: 'plank', x: 130, y: 120, angle: 20, w: 120 },
      { type: 'wall', x: 260, y: 190, w: 250, h: 20 },
      { type: 'heavyBall', x: 362, y: 162 },
      { type: 'wall', x: 470, y: 260, angle: 10, w: 200, h: 14 },
      { type: 'wall', x: 700, y: 350, w: 300, h: 20 },
      { type: 'ball', x: 838, y: 334 },
      ...basketWithFunnel(905),
    ],
    inventory: { domino: 7 },
    solution: [
      { type: 'domino', x: 250, y: 145 },
      { type: 'domino', x: 295, y: 145 },
      { type: 'domino', x: 335, y: 145 },
      { type: 'domino', x: 620, y: 305 },
      { type: 'domino', x: 670, y: 305 },
      { type: 'domino', x: 720, y: 305 },
      { type: 'domino', x: 770, y: 305 },
    ],
    science: {
      topic: 'Energy budget',
      text: 'Every link in a chain loses a little energy to friction and sound, so a long chain needs a strong start. A heavy ball gives the second half a fresh, big push. Engineers always count their parts and decide where each one helps most.',
      tryThis: 'What happens if you put five dominoes in the first row? What is left for the second row?',
      learned: 'A limited budget of parts means you must decide where each one is most useful.',
    },
  },
  {
    id: 'reach',
    name: 'Long reach',
    goal: 'The motor and the paddle are too far apart for a gear train. Make the paddle bat the ball to the RIGHT.',
    hasGoal: true,
    hints: [
      "Gears that touch can only reach so far, and the direction flips at every touch. A string can span a bigger gap.",
      "Mesh two big gears onto the motor, then join the second one to the paddle with a string. A crossed string turns the other way from a straight one.",
    ],
    fixed: [
      { type: 'motorGear', x: 130, y: 300, key: 'm' },
      { type: 'paddleGear', x: 558, y: 300, key: 'p' },
      { type: 'wall', x: 558, y: 418, w: 260, h: 20 },
      { type: 'ball', x: 558, y: 394 },
      ...basketWithFunnel(758),
    ],
    inventory: { gear: 2, bigGear: 2, string: 1 },
    solution: [
      { type: 'bigGear', x: 221.3, y: 250.1, key: 'a' },
      { type: 'bigGear', x: 349.3, y: 248.1, key: 'b' },
      { type: 'string', x: 450, y: 300, flip: true, link: { a: 'b', b: 'p' } },
    ],
    science: {
      topic: 'Gears and belts',
      text: 'Gears pass turning along by touching, and each touch reverses the direction. A belt or string can carry turning across a gap. If it is crossed into a figure of eight, it reverses the direction like a touch does.',
      tryThis: 'Try the string straight and then crossed. Which way does the paddle turn each time?',
      learned: 'A crossed belt reverses the spin, just like meshing gears do.',
    },
  },
  {
    id: 'tackle',
    name: 'Heavy lifting',
    goal: 'The crate is far too heavy for your crate to lift one-to-one. Lift it into the basket anyway.',
    hasGoal: true,
    goalTargets: ['crate'],
    hints: [
      "One rope strand will never do it: the heavy crate wins. But a rope looped back and forth shares the load between strands.",
      "Pulley above the crate, rope from your crate over the pulley to the heavy one, then open the rope and raise the strands to 4. Make your crate as heavy as it goes.",
    ],
    fixed: [
      { type: 'crate', x: 250, y: 580, key: 'load', props: { weight: 0.036 } },
      { type: 'basket', x: 250, y: 470, angle: 180 },
    ],
    inventory: { crate: 1, pulley: 1, rope: 1 },
    solution: [
      { type: 'pulley', x: 300, y: 40, key: 'pul' },
      { type: 'crate', x: 324, y: 110, key: 'eff', props: { weight: 0.012 } },
      { type: 'rope', x: 290, y: 300, props: { strands: 4 }, link: { a: 'eff', via: 'pul', b: 'load' } },
    ],
    science: {
      topic: 'Block and tackle',
      text: 'With four rope strands holding the load, each strand carries only a quarter of the weight, so a small pull wins. The price is distance: to lift the load 1 m you pull 4 m of rope.',
      tryThis: 'Try 3 strands, then 4. What changes? How far does your crate fall compared to how far the load rises?',
      learned: 'More strands means less force but more rope: you never get something for nothing.',
    },
  },
  {
    id: 'tradeoff',
    name: 'Force or distance',
    goal: 'Lift the crate to the high basket. More strands is not always better. Think about how far the rope has to travel.',
    hasGoal: true,
    goalTargets: ['crate'],
    hints: [
      "Count the strands: one is too weak, but four would need your crate to fall farther than the room allows.",
      "Two strands is the sweet spot. Hang your crate as HIGH as you can, near the pulley, so it has a long way to fall, and make it as heavy as it goes.",
    ],
    fixed: [
      { type: 'crate', x: 250, y: 580, key: 'load', props: { weight: 0.02 } },
      { type: 'basket', x: 250, y: 360, angle: 180 },
    ],
    inventory: { crate: 1, pulley: 1, rope: 1 },
    solution: [
      { type: 'pulley', x: 310, y: 40, key: 'pul' },
      { type: 'crate', x: 334, y: 100, key: 'eff', props: { weight: 0.012 } },
      { type: 'rope', x: 290, y: 300, props: { strands: 2 }, link: { a: 'eff', via: 'pul', b: 'load' } },
    ],
    science: {
      topic: 'Trade-offs',
      text: 'A machine can trade force for distance. Two strands halve the force you need but double the rope you use. If you run out of room to pull, you cannot use that many strands. Engineers always balance the two.',
      tryThis: 'Try 1, 2, 3 and 4 strands. For each one, say whether you ran out of strength or out of rope.',
      learned: 'Machines trade force for distance, and the room you have limits the trade.',
    },
  },
  {
    id: 'crane',
    name: 'Crane',
    goal: 'Lift the heavy crate to the high basket. This time a motor does the lifting. Dropping a weight will not help!',
    hasGoal: true,
    goalTargets: ['crate'],
    hints: [
      "Click the pulley and look at its settings. A pulley with a motor can slide up on its rail and take the rope with it.",
      "Hang a crate as heavy as the load on the other end of the rope, so neither side wins. Then set the motor to Lift up and make the rail long enough to reach the basket.",
    ],
    fixed: [
      { type: 'crate', x: 250, y: 578, key: 'load', props: { weight: 0.012 } },
      { type: 'basket', x: 250, y: 340, angle: 180 },
      { type: 'wall', x: 220, y: 500, w: 8, h: 200 },
      { type: 'wall', x: 280, y: 500, w: 8, h: 200 },
    ],
    inventory: { crate: 1, pulley: 1, rope: 1 },
    solution: [
      { type: 'pulley', x: 360, y: 320, key: 'pul', props: { lift: 1, travel: 300 } },
      { type: 'crate', x: 384, y: 578, key: 'eff', props: { weight: 0.012 } },
      { type: 'rope', x: 290, y: 400, link: { a: 'eff', via: 'pul', b: 'load' } },
    ],
    science: {
      topic: 'Cranes and counterweights',
      text: 'Real cranes and lifts use a counterweight so the motor only has to move the difference between the load and the weight. When both sides weigh the same, the rope stays balanced and a small motor can lift a huge load.',
      tryThis: 'Try a lighter crate on the other end. Why does the motor not lift the load any more?',
      learned: 'A counterweight balances the load, so the motor only has to do the lifting work.',
    },
  },
  {
    id: 'skyhigh',
    name: 'Sky high',
    goal: 'A tall wall, a high platform and a low ceiling. This one needs more than a single bounce.',
    hasGoal: true,
    hints: [
      "The platform is higher than the wall, and the ceiling is in the way. Split the trip into steps: a launch, then two turns in the air.",
      "Launch with the spring at a gentle angle, put one plank in the air to bend the path upward, and a second plank near the platform to guide the ball down into the basket.",
    ],
    fixed: [
      { type: 'ball', x: 130, y: 60 },
      { type: 'wall', x: 430, y: 470, w: 24, h: 260 },
      { type: 'wall', x: 830, y: 250, w: 260, h: 20 },
      { type: 'basket', x: 850, y: 205 },
      { type: 'wall', x: 790, y: 120, w: 340, h: 20 },
    ],
    inventory: { spring: 1, plank: 3 },
    solution: [
      { type: 'spring', x: 90, y: 570, angle: 5, power: 3 },
      { type: 'plank', x: 630, y: 360, angle: -5, w: 150 },
      { type: 'plank', x: 725, y: 195, angle: -30, w: 150 },
    ],
    science: {
      topic: 'Angles and bounces',
      text: 'A ball keeps its speed when it bounces off a smooth surface, but its direction changes. Engineers plan a path as a series of short steps and check each step before joining them together.',
      tryThis: 'Test the spring on its own first. Where does the ball land? Then add one plank at a time and watch the dotted path.',
      learned: 'Split a hard problem into small steps, solve each step, then join them up.',
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
    props: p.props ? { ...p.props } : undefined,
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
  const parts = level.fixed.map((p) => toPlaced(p, nextId(), !p.movable));
  resolveLinks(level.fixed, parts, (k) => level.fixed.findIndex((p) => p.key === k) >= 0 ? parts[level.fixed.findIndex((p) => p.key === k)].id : undefined);
  return parts;
}

/** Turn a level part's `link` (made of keys) into the ids of the placed parts. */
function resolveLinks(source: LevelPart[], placed: PlacedPart[], idOf: (key: string) => number | undefined) {
  source.forEach((p, i) => {
    if (!p.link) return;
    const a = idOf(p.link.a);
    const b = idOf(p.link.b);
    const via = p.link.via ? idOf(p.link.via) : undefined;
    if (a !== undefined && b !== undefined) placed[i].link = via !== undefined ? { a, b, via } : { a, b };
  });
}

/** The recorded solution as unlocked player parts. */
export function solutionToParts(level: Level, nextId: () => number): PlacedPart[] {
  const sol = level.solution ?? [];
  const placed = sol.map((p) => toPlaced(p, nextId(), false));
  // Fixed parts are numbered 1..n when a level loads, so a key can be looked up by its position.
  resolveLinks(sol, placed, (k) => {
    const f = level.fixed.findIndex((p) => p.key === k);
    if (f >= 0) return f + 1;
    const s = sol.findIndex((p) => p.key === k);
    return s >= 0 ? placed[s].id : undefined;
  });
  return placed;
}
