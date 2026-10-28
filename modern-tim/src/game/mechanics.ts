/**
 * Pure helpers for gear trains and geometry. No Matter or DOM state here, so
 * the editor can use them to preview a machine before it runs.
 *
 * Gear rules (the science the gear level teaches):
 *  - two gears mesh when their centres are exactly radius A + radius B apart
 *  - meshed gears turn in OPPOSITE directions
 *  - speed scales with teeth: a 16-tooth gear driven by an 8-tooth gear turns at half speed
 */
import { MOTOR_SPEED, PART_DEFS, PX_PER_TOOTH, type PlacedPart } from './parts';

export const MESH_TOLERANCE = 6;
export const SNAP_DISTANCE = 30;

export interface GearLink {
  a: number;
  b: number;
}

export interface GearTrain {
  /** Angular speed per part id (radians per step; positive = clockwise). */
  speeds: Map<number, number>;
  links: GearLink[];
  /** Gears that receive two different speeds (a locked-up train). */
  jammed: Set<number>;
}

function radiusOf(p: PlacedPart) {
  return PART_DEFS[p.type].gear?.radius ?? 0;
}

function meshes(a: PlacedPart, b: PlacedPart) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return Math.abs(d - (radiusOf(a) + radiusOf(b))) <= MESH_TOLERANCE;
}

/** Work out which gears are meshed and how fast each one turns. */
export function computeGearTrain(parts: PlacedPart[]): GearTrain {
  const gears = parts.filter((p) => PART_DEFS[p.type].gear);
  const links: GearLink[] = [];
  const neighbours = new Map<number, PlacedPart[]>();
  for (const g of gears) neighbours.set(g.id, []);
  for (let i = 0; i < gears.length; i++) {
    for (let j = i + 1; j < gears.length; j++) {
      if (meshes(gears[i], gears[j])) {
        links.push({ a: gears[i].id, b: gears[j].id });
        neighbours.get(gears[i].id)!.push(gears[j]);
        neighbours.get(gears[j].id)!.push(gears[i]);
      }
    }
  }

  const speeds = new Map<number, number>();
  const jammed = new Set<number>();
  const queue: PlacedPart[] = [];
  for (const g of gears) {
    if (PART_DEFS[g.type].gear!.motor) {
      speeds.set(g.id, g.flip ? -MOTOR_SPEED : MOTOR_SPEED);
      queue.push(g);
    }
  }
  while (queue.length) {
    const g = queue.shift()!;
    const w = speeds.get(g.id)!;
    for (const n of neighbours.get(g.id)!) {
      const next = (-w * radiusOf(g)) / radiusOf(n);
      const known = speeds.get(n.id);
      if (known === undefined) {
        speeds.set(n.id, next);
        queue.push(n);
      } else if (Math.abs(known - next) > 1e-6) {
        jammed.add(n.id);
        jammed.add(g.id);
      }
    }
  }
  // A jammed train can't turn at all (just like real gears).
  if (jammed.size) {
    for (const id of jammed) speeds.set(id, 0);
  }
  return { speeds, links, jammed };
}

/**
 * If `p` is a gear close to meshing with another gear, return the position
 * (and tooth-aligned angle) that makes it mesh exactly.
 */
export function snapGear(p: PlacedPart, parts: PlacedPart[]): { x: number; y: number; angle: number } | null {
  const spec = PART_DEFS[p.type].gear;
  if (!spec) return null;
  let best: { q: PlacedPart; err: number } | null = null;
  for (const q of parts) {
    if (q.id === p.id || !PART_DEFS[q.type].gear) continue;
    const target = spec.radius + radiusOf(q);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    const err = Math.abs(d - target);
    if (err < SNAP_DISTANCE && (!best || err < best.err)) best = { q, err };
  }
  if (!best) return null;
  const q = best.q;
  const rq = radiusOf(q);
  const rp = spec.radius;
  let dx = p.x - q.x;
  let dy = p.y - q.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const x = q.x + dx * (rq + rp);
  const y = q.y + dy * (rq + rp);

  // Align teeth so they interleave: arc positions at the contact point must
  // differ by half a tooth pitch. Pitch is the same for every gear.
  const pitch = 2 * Math.PI * PX_PER_TOOTH;
  const theta = Math.atan2(dy, dx); // direction from q to p
  const sq = rq * (theta - q.angle);
  const angle = theta + Math.PI - (pitch / 2 - sq) / rp;
  return { x, y, angle };
}

/** Distance from point to a polygon (0 if inside). */
export function pointPolygonDistance(px: number, py: number, verts: { x: number; y: number }[]) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i];
    const b = verts[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
  }
  return inside ? 0 : best;
}
