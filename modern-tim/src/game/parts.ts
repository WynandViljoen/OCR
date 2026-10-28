/**
 * Part definitions and factories.
 *
 * To add a new part:
 *   1. add its name to `PartType`
 *   2. add a `PartDef` entry to `PART_DEFS` (and to `PALETTE_ORDER`)
 *   3. if it needs per-step behaviour, handle its body label in world.ts
 *   4. if it needs custom drawing, add a case in draw.ts `drawDecoration()`
 *
 * Every part is rebuilt from a plain `PlacedPart` record whenever the layout
 * changes, so a factory only has to turn (x, y, angle, options, play?) into
 * Matter bodies.
 *
 * Motion kinds:
 *   static  - never moves (walls, ramps, conveyors, springs, baskets)
 *   dynamic - falls and bounces in play mode (balls, dominoes)
 *   pivot   - pinned at its centre but free to rotate (seesaw, wheel, gears)
 * Dynamic and pivot parts are frozen (static) while editing.
 */
import Matter from 'matter-js';

const { Bodies, Body } = Matter;

export type PartType =
  | 'ball'
  | 'heavyBall'
  | 'plank'
  | 'wall'
  | 'basket'
  | 'conveyor'
  | 'spring'
  | 'domino'
  | 'seesaw'
  | 'wheel'
  | 'motorGear'
  | 'gear'
  | 'bigGear'
  | 'paddleGear'
  | 'mouse';

/** A part as stored in a level or in the player's layout. Angle is radians. */
export interface PlacedPart {
  id: number;
  type: PartType;
  x: number;
  y: number;
  angle: number;
  /** Optional size overrides (wall / plank / conveyor length, seesaw width). */
  w?: number;
  h?: number;
  /** Locked parts come from the level and can't be moved or deleted. */
  locked?: boolean;
  /** Reverse direction (conveyor belt, motor gear). */
  flip?: boolean;
  /** Spring strength: 1 (soft) .. 3 (strong). */
  power?: number;
}

export type Motion = 'static' | 'dynamic' | 'pivot';

export interface GearSpec {
  teeth: number;
  /** Pitch radius: where gears touch. Always 4 px per tooth so any two gears mesh. */
  radius: number;
  motor: boolean;
}

export interface PartDef {
  type: PartType;
  label: string;
  /** One-line, kid-friendly description shown as a tooltip. */
  blurb: string;
  color: string;
  rotatable: boolean;
  /** Can be reversed with F / the flip button. */
  flippable: boolean;
  /** Has adjustable strength (springs). */
  hasPower: boolean;
  motion: Motion;
  gear?: GearSpec;
  build(p: PartGeometry, play: boolean): Matter.Body[];
}

export type PartGeometry = Pick<PlacedPart, 'x' | 'y' | 'angle' | 'w' | 'h' | 'flip' | 'power'>;

// ---------------------------------------------------------------------------
// Physics tuning (all speeds are px per 60 Hz step)
// ---------------------------------------------------------------------------

export const CAT_SOLID = 0x0001;
export const CAT_SENSOR = 0x0002;
/** Bodies sharing a negative group never collide: gears overlap visually where they mesh. */
export const GROUP_GEARS = -1;

export const CONVEYOR_SPEED = 3.2;
export const CONVEYOR_FORCE = 0.0009; // per unit mass
export const MOTOR_SPEED = 0.05; // radians per step (about 0.5 turns per second)
export const SPRING_SPEEDS = [0, 10, 13, 16]; // launch speed for power 1..3
export const PX_PER_TOOTH = 4;

export const COLORS = {
  ink: '#1d2440',
  ball: '#2f7df6',
  heavy: '#5b4a9e',
  wood: '#c98a45',
  wall: '#8a96ad',
  goal: '#1fae6a',
  conveyor: '#ffb21e',
  spring: '#ef476f',
  domino: '#fdfdfd',
  seesaw: '#9a7bea',
  wheel: '#14b8c4',
  motor: '#ff7a1a',
  gear: '#f5c400',
  mouse: '#c7ccd8',
};

const solid = { category: CAT_SOLID, mask: 0xffffffff, group: 0 };
const gearFilter = { category: CAT_SOLID, mask: 0xffffffff, group: GROUP_GEARS };

function look(fill: string, extra: Record<string, unknown> = {}) {
  return { fillStyle: fill, strokeStyle: COLORS.ink, lineWidth: 2, ...extra };
}

/** Rotate a local offset by `angle` and translate to (x, y). */
export function toWorld(x: number, y: number, angle: number, lx: number, ly: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x + lx * c - ly * s, y: y + lx * s + ly * c };
}

function localRect(
  x: number,
  y: number,
  angle: number,
  lx: number,
  ly: number,
  w: number,
  h: number,
  options: Matter.IChamferableBodyDefinition,
) {
  const pos = toWorld(x, y, angle, lx, ly);
  return Bodies.rectangle(pos.x, pos.y, w, h, { angle, ...options });
}

/**
 * A gear: hub circle plus rectangular teeth, built as one compound body.
 * `arms` adds long paddles (used by the paddle gear to bat balls).
 */
function buildGear(
  x: number,
  y: number,
  angle: number,
  spec: GearSpec,
  fill: string,
  label: string,
  play: boolean,
  arms = 0,
) {
  const parts: Matter.Body[] = [
    Bodies.circle(x, y, spec.radius - 3, { render: look(fill) }),
  ];
  for (let i = 0; i < spec.teeth; i++) {
    const a = angle + (i * Math.PI * 2) / spec.teeth;
    const pos = toWorld(x, y, a, spec.radius + 2, 0);
    parts.push(Bodies.rectangle(pos.x, pos.y, 12, 8, { angle: a, render: look(fill) }));
  }
  for (let i = 0; i < arms; i++) {
    const a = angle + (i * Math.PI * 2) / arms;
    const pos = toWorld(x, y, a, spec.radius + 34, 0);
    parts.push(Bodies.rectangle(pos.x, pos.y, 64, 12, { angle: a, chamfer: { radius: 5 }, render: look(COLORS.motor) }));
  }
  const body = Body.create({
    parts,
    label,
    friction: 0.4,
    frictionAir: 0,
    restitution: 0.2,
    collisionFilter: gearFilter,
  });
  // Set mass before freezing: a static body's mass must stay Infinity.
  Body.setDensity(body, 0.02);
  if (!play) Body.setStatic(body, true);
  return body;
}

function gearDef(
  type: PartType,
  label: string,
  blurb: string,
  teeth: number,
  motor: boolean,
  color: string,
  arms = 0,
): PartDef {
  const spec: GearSpec = { teeth, radius: teeth * PX_PER_TOOTH, motor };
  return {
    type,
    label,
    blurb,
    color,
    rotatable: false,
    flippable: motor,
    hasPower: false,
    motion: 'pivot',
    gear: spec,
    build: ({ x, y, angle }, play) => [buildGear(x, y, angle, spec, color, type, play, arms)],
  };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const PART_DEFS: Record<PartType, PartDef> = {
  ball: {
    type: 'ball',
    label: 'Ball',
    blurb: 'A light, bouncy ball. Gravity pulls it down.',
    color: COLORS.ball,
    rotatable: false,
    flippable: false,
    hasPower: false,
    motion: 'dynamic',
    build: ({ x, y }, play) => [
      Bodies.circle(x, y, 14, {
        label: 'ball',
        isStatic: !play,
        restitution: 0.45,
        friction: 0.02,
        frictionAir: 0.0005,
        density: 0.002,
        collisionFilter: solid,
        render: look(COLORS.ball),
      }),
    ],
  },

  heavyBall: {
    type: 'heavyBall',
    label: 'Bowling ball',
    blurb: 'Ten times heavier than a ball. Heavy things push harder.',
    color: COLORS.heavy,
    rotatable: false,
    flippable: false,
    hasPower: false,
    motion: 'dynamic',
    build: ({ x, y }, play) => [
      Bodies.circle(x, y, 18, {
        label: 'heavyBall',
        isStatic: !play,
        restitution: 0.05,
        friction: 0.05,
        frictionAir: 0.0005,
        density: 0.012,
        collisionFilter: solid,
        render: look(COLORS.heavy),
      }),
    ],
  },

  plank: {
    type: 'plank',
    label: 'Ramp',
    blurb: 'A tilted plank. Ramps turn falling into rolling.',
    color: COLORS.wood,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'static',
    build: ({ x, y, angle, w, h }) => [
      Bodies.rectangle(x, y, w ?? 170, h ?? 12, {
        label: 'plank',
        angle,
        isStatic: true,
        friction: 0.1,
        restitution: 0.1,
        collisionFilter: solid,
        render: look(COLORS.wood),
      }),
    ],
  },

  wall: {
    type: 'wall',
    label: 'Wall',
    blurb: 'A solid block. Use it as a floor, a shelf or a stopper.',
    color: COLORS.wall,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'static',
    build: ({ x, y, angle, w, h }) => [
      Bodies.rectangle(x, y, w ?? 120, h ?? 20, {
        label: 'wall',
        angle,
        isStatic: true,
        friction: 0.4,
        restitution: 0.1,
        collisionFilter: solid,
        render: look(COLORS.wall),
      }),
    ],
  },

  basket: {
    type: 'basket',
    label: 'Basket',
    blurb: 'The goal. Get a ball into the green zone.',
    color: COLORS.goal,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'static',
    build: ({ x, y, angle }) => {
      const wall = { isStatic: true, friction: 0.4, restitution: 0.05, collisionFilter: solid, render: look(COLORS.goal) };
      const sensorPos = toWorld(x, y, angle, 0, 6);
      return [
        Bodies.rectangle(sensorPos.x, sensorPos.y, 80, 36, {
          label: 'goalSensor',
          angle,
          isStatic: true,
          isSensor: true,
          collisionFilter: { category: CAT_SENSOR, mask: CAT_SOLID, group: 0 },
          render: { fillStyle: 'rgba(31, 174, 106, 0.18)', strokeStyle: COLORS.goal, lineWidth: 1.5 },
        }),
        localRect(x, y, angle, -50, 0, 10, 70, { label: 'basketWall', ...wall }),
        localRect(x, y, angle, 50, 0, 10, 70, { label: 'basketWall', ...wall }),
        localRect(x, y, angle, 0, 30, 110, 10, { label: 'basketWall', ...wall }),
      ];
    },
  },

  conveyor: {
    type: 'conveyor',
    label: 'Conveyor',
    blurb: 'A moving belt. It pushes things along the arrows. Press F to reverse.',
    color: COLORS.conveyor,
    rotatable: true,
    flippable: true,
    hasPower: false,
    motion: 'static',
    build: ({ x, y, angle, w, h }) => [
      Bodies.rectangle(x, y, w ?? 150, h ?? 18, {
        label: 'conveyor',
        angle,
        isStatic: true,
        friction: 0.8,
        restitution: 0,
        chamfer: { radius: 8 },
        collisionFilter: solid,
        render: look(COLORS.conveyor),
      }),
    ],
  },

  spring: {
    type: 'spring',
    label: 'Spring',
    blurb: 'Squash it and it pushes back! Stronger springs launch higher.',
    color: COLORS.spring,
    rotatable: true,
    flippable: false,
    hasPower: true,
    motion: 'static',
    // The coil is drawn in draw.ts; physically it is a base plate plus a top pad
    // that launches whatever lands on it (see world.ts).
    build: ({ x, y, angle }) => [
      localRect(x, y, angle, 0, 16, 64, 10, {
        label: 'springBase',
        isStatic: true,
        collisionFilter: solid,
        render: look(COLORS.wall),
      }),
      localRect(x, y, angle, 0, -14, 70, 12, {
        label: 'springPad',
        isStatic: true,
        friction: 0.3,
        restitution: 0,
        chamfer: { radius: 4 },
        collisionFilter: solid,
        render: look(COLORS.spring),
      }),
    ],
  },

  domino: {
    type: 'domino',
    label: 'Domino',
    blurb: 'Tall and wobbly. Knock one over and it knocks the next.',
    color: COLORS.domino,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'dynamic',
    build: ({ x, y, angle }, play) => [
      Bodies.rectangle(x, y, 12, 70, {
        label: 'domino',
        angle,
        isStatic: !play,
        density: 0.005,
        friction: 0.6,
        frictionAir: 0,
        restitution: 0,
        chamfer: { radius: 2 },
        collisionFilter: solid,
        render: look(COLORS.domino),
      }),
    ],
  },

  seesaw: {
    type: 'seesaw',
    label: 'Seesaw',
    blurb: 'A lever on a pivot. Push one end down and the other goes up.',
    color: COLORS.seesaw,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'pivot',
    // A plank with a small lip at each end so a ball can sit on it, like a catapult.
    build: ({ x, y, angle, w }, play) => {
      const len = w ?? 200;
      const style = { render: look(COLORS.seesaw) };
      const body = Body.create({
        parts: [
          Bodies.rectangle(x, y, len, 14, { angle, chamfer: { radius: 4 }, ...style }),
          localRect(x, y, angle, -len / 2 + 5, -12, 10, 14, { chamfer: { radius: 3 }, ...style }),
          localRect(x, y, angle, len / 2 - 5, -12, 10, 14, { chamfer: { radius: 3 }, ...style }),
        ],
        label: 'seesaw',
        friction: 0.6,
        frictionAir: 0.01,
        restitution: 0.05,
        collisionFilter: solid,
      });
      Body.setDensity(body, 0.001);
      if (!play) Body.setStatic(body, true);
      return [body];
    },
  },

  wheel: {
    type: 'wheel',
    label: 'Paddle wheel',
    blurb: 'Spins freely on its axle when something pushes a paddle.',
    color: COLORS.wheel,
    rotatable: true,
    flippable: false,
    hasPower: false,
    motion: 'pivot',
    build: ({ x, y, angle }, play) => {
      const parts: Matter.Body[] = [Bodies.circle(x, y, 16, { render: look(COLORS.wheel) })];
      for (let i = 0; i < 6; i++) {
        const a = angle + (i * Math.PI) / 3;
        const pos = toWorld(x, y, a, 36, 0);
        parts.push(Bodies.rectangle(pos.x, pos.y, 46, 9, { angle: a, chamfer: { radius: 3 }, render: look(COLORS.wheel) }));
      }
      const body = Body.create({
        parts,
        label: 'wheel',
        friction: 0.3,
        frictionAir: 0.02,
        restitution: 0.1,
        collisionFilter: solid,
      });
      Body.setDensity(body, 0.0015);
      if (!play) Body.setStatic(body, true);
      return [body];
    },
  },

  motorGear: gearDef('motorGear', 'Motor gear', 'Has a motor inside, so it turns by itself. Press F to reverse.', 10, true, COLORS.motor),
  gear: gearDef('gear', 'Small gear', 'Turns when a gear next to it turns, in the opposite direction.', 8, false, COLORS.gear),
  bigGear: gearDef('bigGear', 'Big gear', 'More teeth means it turns slower, but it reaches farther.', 16, false, COLORS.gear),
  paddleGear: gearDef('paddleGear', 'Paddle gear', 'A gear with two paddles that bat things away.', 8, false, COLORS.gear, 2),

  mouse: {
    type: 'mouse',
    label: 'Mouse',
    blurb: 'Squeak! Just for fun.',
    color: COLORS.mouse,
    rotatable: false,
    flippable: false,
    hasPower: false,
    motion: 'dynamic',
    build: ({ x, y }, play) => [
      Bodies.rectangle(x, y, 36, 24, {
        label: 'mouse',
        isStatic: !play,
        chamfer: { radius: 10 },
        friction: 0.6,
        restitution: 0.2,
        density: 0.002,
        collisionFilter: solid,
        render: look(COLORS.mouse),
      }),
    ],
  },
};

/** Order the parts appear in the palette. */
export const PALETTE_ORDER: PartType[] = [
  'ball',
  'heavyBall',
  'plank',
  'wall',
  'conveyor',
  'spring',
  'domino',
  'seesaw',
  'wheel',
  'motorGear',
  'gear',
  'bigGear',
  'paddleGear',
  'basket',
  'mouse',
];

export function isGear(type: PartType) {
  return !!PART_DEFS[type].gear;
}
