/**
 * Tinkering: every part can have a few numbers the player may change
 * (bounciness, grip, weight, belt speed...). Pure data, no Matter.
 *
 * The `def` of each one is exactly the value the physics used before sliders
 * existed, so a part nobody touched behaves identically to before.
 */
import type { PartType, PlacedPart } from './parts';

export interface PropSpec {
  key: string;
  label: string;
  icon: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** The value as a player reads it (percent, turns per second...). */
  show(v: number): string;
  /** Kid-friendly sentences, lowest first: [value at least, text]. */
  feel: [number, string][];
  /** The science idea behind it. */
  science: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const bounceSpec = (def: number): PropSpec => ({
  key: 'bounce',
  label: 'Bounciness',
  icon: '🏀',
  min: 0,
  max: 0.95,
  step: 0.05,
  def,
  show: pct,
  science: 'Elasticity: how much energy a bounce gives back.',
  feel: [
    [0, 'Thud! It lands like a lump of clay.'],
    [0.2, 'A little bounce, like a tennis ball on carpet.'],
    [0.45, 'Bouncy, like a rubber ball.'],
    [0.7, 'Super bouncy! Almost no energy is lost.'],
    [0.9, 'A superball! It bounces nearly forever.'],
  ],
});

const gripSpec = (def: number): PropSpec => ({
  key: 'grip',
  label: 'Grip',
  icon: '🧤',
  min: 0,
  max: 1,
  step: 0.01,
  def,
  show: pct,
  science: 'Friction: the rubbing force between two surfaces.',
  feel: [
    [0, 'Slippery as ice! Things slide right off.'],
    [0.15, 'Smooth, like polished wood.'],
    [0.4, 'Some grip, like a rubber mat.'],
    [0.7, 'Really grippy, like sandpaper!'],
  ],
});

const weightSpec = (def: number): PropSpec => ({
  key: 'weight',
  label: 'Weight',
  icon: '⚖️',
  min: def * 0.25,
  max: def * 3,
  step: def * 0.25,
  def,
  show: (v) => `x${Math.round((v / def) * 100) / 100}`,
  science: 'Mass: how much stuff there is. Heavier things are harder to push and push back harder.',
  feel: [
    [0, 'Light as a feather. A little push moves it.'],
    [def * 0.75, 'Normal weight.'],
    [def * 1.5, 'Heavy! It takes a big push to move it.'],
    [def * 2.5, 'Super heavy, like a bag of sand.'],
  ],
});

const dragSpec = (def: number): PropSpec => ({
  key: 'drag',
  label: 'Axle drag',
  icon: '🛢️',
  min: 0,
  max: 0.1,
  step: 0.005,
  def,
  show: (v) => `${Math.round(v * 1000) / 10}`,
  science: 'Friction in the axle slows spinning things down.',
  feel: [
    [0, 'Oiled axle: it spins and spins.'],
    [0.01, 'A little rubbing slows it gently.'],
    [0.04, 'Sticky axle! It stops quickly.'],
  ],
});

const beltSpeedSpec: PropSpec = {
  key: 'speed',
  label: 'Belt speed',
  icon: '🏃',
  min: 0.8,
  max: 8,
  step: 0.4,
  def: 3.2,
  show: (v) => `${(v * 0.6).toFixed(1)} m/s`,
  science: 'Speed: how far something moves each second.',
  feel: [
    [0, 'Slow and gentle, like a walk.'],
    [2.4, 'A brisk jog.'],
    [4.4, 'Fast! Things fly along.'],
    [6.4, 'Super fast, like a sprinter!'],
  ],
};

const motorSpeedSpec: PropSpec = {
  key: 'speed',
  label: 'Motor speed',
  icon: '⚡',
  min: 0.01,
  max: 0.12,
  step: 0.01,
  def: 0.05,
  show: (v) => `${((v * 60) / (2 * Math.PI)).toFixed(2)} turns/s`,
  science: 'Rotation speed: how many turns each second.',
  feel: [
    [0, 'A lazy crawl.'],
    [0.03, 'A steady spin.'],
    [0.07, 'Whirring along!'],
    [0.1, 'Zoom! Hold on to your hat.'],
  ],
};

const springSpec: PropSpec = {
  key: 'power',
  label: 'Strength',
  icon: '💪',
  min: 1,
  max: 3,
  step: 1,
  def: 2,
  show: (v) => ['', 'soft', 'medium', 'strong'][v] ?? '',
  science: 'Stored energy: a squashed spring is full of it. A stronger spring launches higher.',
  feel: [
    [1, 'Soft: a gentle hop.'],
    [2, 'Medium: a good boing.'],
    [3, 'Strong: launches things high!'],
  ],
};

const pulleySpec: PropSpec = {
  key: 'pulley',
  label: 'Second pulley size',
  icon: '🎡',
  min: 0.5,
  max: 2,
  step: 0.25,
  def: 1,
  show: (v) => `x${v}`,
  science: 'A bigger pulley turns slower, a smaller one faster. Crossing the string (F) turns the other gear the opposite way.',
  feel: [
    [0.5, 'Small pulley: it spins twice as fast.'],
    [0.75, 'A little smaller: a bit faster.'],
    [1, 'Same size: same speed.'],
    [1.25, 'A little bigger: a bit slower.'],
    [2, 'Twice as big: half the speed.'],
  ],
};

export const PROP_SPECS: Partial<Record<PartType, PropSpec[]>> = {
  ball: [bounceSpec(0.45), weightSpec(0.002), gripSpec(0.02)],
  heavyBall: [bounceSpec(0.05), weightSpec(0.012), gripSpec(0.05)],
  plank: [gripSpec(0.1), bounceSpec(0.1)],
  wall: [gripSpec(0.4), bounceSpec(0.1)],
  conveyor: [beltSpeedSpec],
  spring: [springSpec],
  domino: [weightSpec(0.005), gripSpec(0.6)],
  seesaw: [weightSpec(0.001), dragSpec(0.01)],
  wheel: [weightSpec(0.0015), dragSpec(0.02)],
  mouse: [bounceSpec(0.2), weightSpec(0.002), gripSpec(0.6)],
  motorGear: [motorSpeedSpec],
  string: [pulleySpec],
};

/** The value of one tinkerable number: the player's choice, else the part's default. */
export function propValue(type: PartType, props: Record<string, number> | undefined, key: string): number {
  const fromPlayer = props?.[key];
  if (typeof fromPlayer === 'number' && Number.isFinite(fromPlayer)) return fromPlayer;
  const spec = PROP_SPECS[type]?.find((p) => p.key === key);
  return spec ? spec.def : 0;
}

/** Spring strength lives in `power` (the toolbar buttons use it too); everything else is in `props`. */
export function partProp(part: Pick<PlacedPart, 'type' | 'props' | 'power'>, key: string): number {
  return key === 'power' ? (part.power ?? 2) : propValue(part.type, part.props, key);
}

/** The sentence that matches a slider value. */
export function feelOf(spec: PropSpec, v: number): string {
  let text = spec.feel[0][1];
  for (const [from, t] of spec.feel) if (v + 1e-9 >= from) text = t;
  return text;
}
