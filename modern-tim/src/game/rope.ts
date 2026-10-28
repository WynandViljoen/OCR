/**
 * Rope over a pulley: the maths, with no physics engine in it.
 *
 * A rope runs from weight A up to the rim of a fixed pulley (point `pa`), over the top, and down
 * from the other side of the rim (point `pb`) to weight B. With `strands` strands on B's side
 * (a block and tackle), B moves 1/strands as far as A.
 *
 *   rope length  L = |A - pa| + strands * |B - pb|   (the bit wrapped round the pulley never changes)
 *
 * A rope can pull but not push, so it only acts when it is tight (stretched to L).
 * Then both weights are pushed along the rope: velocity and position are corrected the way a
 * real rope would, using the masses. That gives the real results:
 *   - equal weights hang still
 *   - heavier weight wins; acceleration = (mA - mB) g / (mA + mB)
 *   - with N strands the load only needs to be lighter than N times the effort to be lifted
 *   - a slack rope does nothing
 */

type Pt = { x: number; y: number };

export interface RopeBody {
  x: number;
  y: number;
  /** Velocity in px per step. */
  vx: number;
  vy: number;
  mass: number;
}

export interface RopeResult {
  /** New velocities (px per step) for A and B. */
  a: { vx: number; vy: number };
  b: { vx: number; vy: number };
  /** How far to move A and B (px) to bring the rope back to its length. */
  moveA: { x: number; y: number };
  moveB: { x: number; y: number };
  tight: boolean;
}

/** Rope length for the starting positions: it is exactly as long as the gap the player built. */
export function ropeLength(a: Pt, b: Pt, pa: Pt, pb: Pt, strands: number) {
  return Math.hypot(a.x - pa.x, a.y - pa.y) + strands * Math.hypot(b.x - pb.x, b.y - pb.y);
}

/** How tight the rope is allowed to get before it starts pulling (px of slack tolerated). */
const SLACK = 0.5;

export function solveRope(
  a: RopeBody,
  b: RopeBody,
  pa: Pt,
  pb: Pt,
  strands: number,
  length: number,
  friction = 0,
): RopeResult {
  const out: RopeResult = {
    a: { vx: a.vx, vy: a.vy },
    b: { vx: b.vx, vy: b.vy },
    moveA: { x: 0, y: 0 },
    moveB: { x: 0, y: 0 },
    tight: false,
  };
  const la = Math.hypot(a.x - pa.x, a.y - pa.y);
  const lb = Math.hypot(b.x - pb.x, b.y - pb.y);
  if (la < 1e-6 || lb < 1e-6 || !(a.mass > 0) || !(b.mass > 0)) return out;
  const nax = (a.x - pa.x) / la;
  const nay = (a.y - pa.y) / la;
  const nbx = (b.x - pb.x) / lb;
  const nby = (b.y - pb.y) / lb;
  const stretch = la + strands * lb - length; // > 0: the rope wants to be longer than it can be
  if (stretch < -SLACK) return out; // slack: nothing happens

  out.tight = true;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const k = invA + (strands * strands) * invB;

  // Velocity: take away any speed that would stretch the rope further.
  const jv = nax * a.vx + nay * a.vy + strands * (nbx * b.vx + nby * b.vy);
  if (jv > 0) {
    const lambda = -jv / k;
    out.a.vx += nax * lambda * invA;
    out.a.vy += nay * lambda * invA;
    out.b.vx += nbx * strands * lambda * invB;
    out.b.vy += nby * strands * lambda * invB;
  }

  // Position: pull the weights back until the rope is its proper length again.
  if (stretch > 0) {
    const fix = (stretch / k) * 0.8;
    out.moveA = { x: -nax * fix * invA, y: -nay * fix * invA };
    out.moveB = { x: -nbx * strands * fix * invB, y: -nby * strands * fix * invB };
  }

  // Friction in the pulley slows the whole rope a little each step.
  if (friction > 0) {
    const keep = 1 - friction;
    out.a.vx *= keep;
    out.a.vy *= keep;
    out.b.vx *= keep;
    out.b.vy *= keep;
  }
  return out;
}
