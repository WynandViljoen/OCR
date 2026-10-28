/**
 * Solid space: two real objects cannot occupy the same place.
 *
 * Pure geometry (no Matter, no DOM) so it can be tested on its own. Each part
 * has a footprint of circles and rotated rectangles that mirrors the bodies built
 * in parts.ts (scripts/check-space.ts compares them when Matter is installed).
 *
 * Only solid shapes count. The basket's green goal zone is empty air, and the
 * sweep of a spinning wheel, gear tooth or paddle is not reserved, only the
 * part as it is placed.
 *
 * Touching is fine (a ball resting on a ramp, gears meshing); sinking into
 * each other by more than OVERLAP_TOLERANCE pixels is not.
 */
import type { PartType } from './parts';

export interface SpacePart {
  type: PartType;
  x: number;
  y: number;
  angle: number;
  w?: number;
  h?: number;
}

type Pt = { x: number; y: number };
export type Shape = { kind: 'circle'; x: number; y: number; r: number } | { kind: 'poly'; pts: Pt[] };

/** How far (px) shapes may sink into each other before it counts as overlap. */
export const OVERLAP_TOLERANCE = 1.5;

/** Pitch radius per gear type (teeth x 4 px, see parts.ts). The body of a gear is a little smaller. */
const GEAR_RADIUS: Partial<Record<PartType, number>> = { motorGear: 40, gear: 32, bigGear: 64, paddleGear: 32 };
/** Gear teeth interleave when meshed, so only the core counts as solid. */
const GEAR_CORE_INSET = 2;

function rect(cx: number, cy: number, w: number, h: number, angle: number): Shape {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([lx, ly]) => ({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }));
  return { kind: 'poly', pts };
}

/** A rectangle placed in the part's own frame (like localRect in parts.ts). */
function local(p: SpacePart, lx: number, ly: number, w: number, h: number): Shape {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return rect(p.x + lx * c - ly * s, p.y + lx * s + ly * c, w, h, p.angle);
}

export function footprint(p: SpacePart): Shape[] {
  switch (p.type) {
    case 'ball':
      return [{ kind: 'circle', x: p.x, y: p.y, r: 14 }];
    case 'heavyBall':
      return [{ kind: 'circle', x: p.x, y: p.y, r: 18 }];
    case 'plank':
      return [rect(p.x, p.y, p.w ?? 170, p.h ?? 12, p.angle)];
    case 'wall':
      return [rect(p.x, p.y, p.w ?? 120, p.h ?? 20, p.angle)];
    case 'conveyor':
      return [rect(p.x, p.y, p.w ?? 150, p.h ?? 18, p.angle)];
    case 'domino':
      return [rect(p.x, p.y, 12, 70, p.angle)];
    case 'crate':
      return [rect(p.x, p.y, 40, 40, p.angle)];
    case 'pulley':
      return [{ kind: 'circle', x: p.x, y: p.y, r: 24 }];
    case 'mouse':
      return [rect(p.x, p.y, 36, 24, 0)];
    case 'basket':
      return [local(p, -50, 0, 10, 70), local(p, 50, 0, 10, 70), local(p, 0, 30, 110, 10)];
    case 'spring':
      return [local(p, 0, 16, 64, 10), local(p, 0, -14, 70, 12)];
    case 'seesaw': {
      const len = p.w ?? 200;
      return [rect(p.x, p.y, len, 14, p.angle), local(p, -len / 2 + 5, -12, 10, 14), local(p, len / 2 - 5, -12, 10, 14)];
    }
    case 'wheel': {
      const out: Shape[] = [{ kind: 'circle', x: p.x, y: p.y, r: 16 }];
      for (let i = 0; i < 6; i++) {
        const a = p.angle + (i * Math.PI) / 3;
        out.push(rect(p.x + 36 * Math.cos(a), p.y + 36 * Math.sin(a), 46, 9, a));
      }
      return out;
    }
    default: {
      const r = GEAR_RADIUS[p.type];
      return r ? [{ kind: 'circle', x: p.x, y: p.y, r: r - GEAR_CORE_INSET }] : [];
    }
  }
}

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

function project(pts: Pt[], ax: number, ay: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const q of pts) {
    const d = q.x * ax + q.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

function polysOverlap(a: Pt[], b: Pt[], tol: number): boolean {
  for (const pts of [a, b]) {
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      let ax = p2.y - p1.y;
      let ay = p1.x - p2.x;
      const len = Math.hypot(ax, ay) || 1;
      ax /= len;
      ay /= len;
      const pa = project(a, ax, ay);
      const pb = project(b, ax, ay);
      if (Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min) <= tol) return false;
    }
  }
  return true;
}

/** Signed distance from a point to a polygon edge loop: negative when inside. */
function signedDistance(px: number, py: number, pts: Pt[]): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
  }
  return inside ? -best : best;
}

export function shapesOverlap(a: Shape, b: Shape, tol = OVERLAP_TOLERANCE): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - tol;
  if (a.kind === 'circle' && b.kind === 'poly') return a.r - signedDistance(a.x, a.y, b.pts) > tol;
  if (a.kind === 'poly' && b.kind === 'circle') return shapesOverlap(b, a, tol);
  if (a.kind === 'poly' && b.kind === 'poly') return polysOverlap(a.pts, b.pts, tol);
  return false;
}

function bounds(shapes: Shape[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    const pts = s.kind === 'circle' ? [{ x: s.x - s.r, y: s.y - s.r }, { x: s.x + s.r, y: s.y + s.r }] : s.pts;
    for (const q of pts) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  }
  return { x0, y0, x1, y1 };
}

export function footprintBounds(p: SpacePart) {
  return bounds(footprint(p));
}

/** True when `a` shares solid space with any part in `others`. */
export function overlapsAny(a: SpacePart, others: SpacePart[], tol = OVERLAP_TOLERANCE): boolean {
  const mine = footprint(a);
  if (!mine.length) return false;
  const bm = bounds(mine);
  for (const o of others) {
    const theirs = footprint(o);
    if (!theirs.length) continue;
    const bo = bounds(theirs);
    if (bo.x1 < bm.x0 - tol || bo.x0 > bm.x1 + tol || bo.y1 < bm.y0 - tol || bo.y0 > bm.y1 + tol) continue;
    for (const s of mine) for (const t of theirs) if (shapesOverlap(s, t, tol)) return true;
  }
  return false;
}

export interface FreeSpotOptions {
  /** Grid size the part should land on. */
  grid: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** How far from the wanted spot to look, in px. */
  maxDistance?: number;
  /** Extra rule for a candidate position (for example gears clicking into mesh). Return the position to use, or null. */
  adjust?: (x: number, y: number) => { x: number; y: number; angle?: number } | null;
}

/**
 * Where should `part` go if the player wants it at (wantX, wantY)? If that spot
 * is free it is used. Otherwise the closest free grid spot is returned, or null
 * when there is no room within reach. `others` must not include the part itself.
 */
export function findFreeSpot(
  part: SpacePart,
  others: SpacePart[],
  wantX: number,
  wantY: number,
  opts: FreeSpotOptions,
): { x: number; y: number; angle?: number } | null {
  const { grid, minX, maxX, minY, maxY } = opts;
  const reach = opts.maxDistance ?? 260;
  const clampX = (v: number) => Math.max(minX, Math.min(maxX, v));
  const clampY = (v: number) => Math.max(minY, Math.min(maxY, v));

  const tryAt = (x: number, y: number) => {
    const spot = opts.adjust ? opts.adjust(x, y) : { x, y };
    if (!spot) return null;
    return overlapsAny({ ...part, x: spot.x, y: spot.y, angle: spot.angle ?? part.angle }, others) ? null : spot;
  };

  const wx = clampX(wantX);
  const wy = clampY(wantY);
  const first = tryAt(Math.round(wx / grid) * grid, Math.round(wy / grid) * grid);
  if (first) return first;

  const cands: { x: number; y: number; d: number }[] = [];
  const gx0 = Math.ceil(Math.max(minX, wx - reach) / grid);
  const gx1 = Math.floor(Math.min(maxX, wx + reach) / grid);
  const gy0 = Math.ceil(Math.max(minY, wy - reach) / grid);
  const gy1 = Math.floor(Math.min(maxY, wy + reach) / grid);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const d = Math.hypot(gx * grid - wx, gy * grid - wy);
      if (d <= reach) cands.push({ x: gx * grid, y: gy * grid, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const spot = tryAt(c.x, c.y);
    if (spot) return spot;
  }
  return null;
}
