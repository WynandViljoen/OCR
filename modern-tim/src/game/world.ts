/**
 * Simulation: owns the Matter engine and rebuilds the world from a list of
 * placed parts. It has no DOM dependencies, so it also runs headlessly
 * (the level checks in scripts/ use it that way).
 *
 * Edit and play mode use the same layout; `load(parts, play)` decides whether
 * dynamic and pivot parts are frozen (edit) or free (play).
 *
 * Per-step machine behaviour lives here:
 *  - conveyors push touching bodies along the belt
 *  - springs launch bodies that land on their pad
 *  - pivot parts (seesaw, wheel, gears) are held at their axle
 *  - gears connected to a motor gear are driven at their gear-ratio speed
 */
import Matter from 'matter-js';
import {
  CAT_SOLID,
  CONVEYOR_FORCE,
  CONVEYOR_SPEED,
  PART_DEFS,
  SPRING_SPEEDS,
  type PartType,
  type PlacedPart,
} from './parts';
import { computeGearTrain, pointPolygonDistance, type GearTrain } from './mechanics';

const { Engine, Composite, Bodies, Body, Events } = Matter;

export const WORLD_W = 1000;
export const WORLD_H = 620;
export const FLOOR_TOP = 600;
export const STEP_MS = 1000 / 60;

const TRAIL_EVERY = 2;
const TRAIL_MAX = 900;
const SPRING_COOLDOWN_STEPS = 12;

export interface Trail {
  label: string;
  points: { x: number; y: number }[];
}

interface PivotInfo {
  body: Matter.Body;
  /** The axle (the part's x, y). */
  x: number;
  y: number;
  /** Centre of mass relative to the axle, in the body's own frame. */
  ox: number;
  oy: number;
  /** Driven gears: fixed speed and starting angle. */
  speed?: number;
  angle0: number;
}

export class Simulation {
  readonly engine: Matter.Engine = Engine.create({
    enableSleeping: false,
    positionIterations: 10,
    velocityIterations: 8,
  });

  running = false;
  goalEnabled = true;
  /** Body labels that count for the goal. */
  goalTargets: string[] = ['ball'];
  solved = false;
  onSolved: (() => void) | null = null;
  steps = 0;
  /** Motion paths of balls during the current run. */
  trails = new Map<number, Trail>();
  gearTrain: GearTrain = { speeds: new Map(), links: [], jammed: new Set() };

  private built = new Map<number, Matter.Body[]>();
  private partsById = new Map<number, PlacedPart>();
  private pivots: PivotInfo[] = [];
  private conveyorContacts: [Matter.Body, Matter.Body][] = [];
  private springContacts: [Matter.Body, Matter.Body][] = [];
  private springCooldown = new Map<string, number>();

  constructor() {
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    Events.on(this.engine, 'beforeUpdate', () => this.beforeStep());
    Events.on(this.engine, 'afterUpdate', () => this.afterStep());
    Events.on(this.engine, 'collisionStart', (e: Matter.IEventCollision<Matter.Engine>) => {
      this.recordContacts(e);
      this.detectGoal(e);
    });
    Events.on(this.engine, 'collisionActive', (e: Matter.IEventCollision<Matter.Engine>) => this.recordContacts(e));
  }

  /** Replace the whole world with `parts`. `play` releases dynamic parts. */
  load(parts: PlacedPart[], play: boolean) {
    const world = this.engine.world;
    Composite.clear(world, false, true);
    Engine.clear(this.engine);
    this.built.clear();
    this.partsById.clear();
    this.pivots = [];
    this.conveyorContacts = [];
    this.springContacts = [];
    this.springCooldown.clear();
    this.trails.clear();
    this.running = play;
    this.solved = false;
    this.steps = 0;
    this.gearTrain = computeGearTrain(parts);

    Composite.add(world, this.boundaries());

    for (const p of parts) {
      const def = PART_DEFS[p.type];
      const bodies = def.build(p, play);
      for (const body of bodies) {
        body.plugin = { ...(body.plugin ?? {}), partId: p.id, partType: p.type, part: p };
      }
      Composite.add(world, bodies);
      this.built.set(p.id, bodies);
      this.partsById.set(p.id, p);

      if (play && def.motion === 'pivot') {
        const body = bodies[0];
        const speed = this.gearTrain.speeds.get(p.id);
        const dx = body.position.x - p.x;
        const dy = body.position.y - p.y;
        const c = Math.cos(-body.angle);
        const s = Math.sin(-body.angle);
        this.pivots.push({ body, x: p.x, y: p.y, ox: dx * c - dy * s, oy: dx * s + dy * c, speed, angle0: body.angle });
      }
    }
  }

  /** Advance the physics by one fixed 60 Hz step. */
  step() {
    this.steps++;
    Engine.update(this.engine, STEP_MS);
    if (this.steps % TRAIL_EVERY === 0) this.recordTrails();
  }

  bodiesOf(id: number): Matter.Body[] {
    return this.built.get(id) ?? [];
  }

  allBodies(): Matter.Body[] {
    return Composite.allBodies(this.engine.world);
  }

  /**
   * Find the placed part nearest to a point, within `tolerance` px of its
   * outline. Generous on purpose so thin planks are easy to grab.
   * `accept` filters candidates (e.g. only unlocked parts).
   */
  partNear(x: number, y: number, tolerance: number, accept: (p: PlacedPart) => boolean): number | undefined {
    let bestId: number | undefined;
    let bestDist = Infinity;
    for (const [id, bodies] of this.built) {
      const part = this.partsById.get(id);
      if (!part || !accept(part)) continue;
      for (const body of bodies) {
        const pieces = body.parts.length > 1 ? body.parts.slice(1) : [body];
        for (const piece of pieces) {
          const d = pointPolygonDistance(x, y, piece.vertices);
          // Prefer the part whose centre is closer when several contain the point.
          const score = d === 0 ? -1 / (1 + Math.hypot(x - part.x, y - part.y)) : d;
          if (d <= tolerance && score < bestDist) {
            bestDist = score;
            bestId = id;
          }
        }
      }
    }
    return bestId;
  }

  // -------------------------------------------------------------------------

  /** Floor, side walls and ceiling that keep everything in the playfield. */
  private boundaries(): Matter.Body[] {
    const opts = {
      label: 'bound',
      isStatic: true,
      friction: 0.5,
      restitution: 0.2,
      collisionFilter: { category: CAT_SOLID, mask: 0xffffffff, group: 0 },
      render: { fillStyle: '#c9d3e6', strokeStyle: '#1d2440', lineWidth: 2 },
    };
    return [
      Bodies.rectangle(WORLD_W / 2, FLOOR_TOP + 30, WORLD_W + 200, 60, opts),
      Bodies.rectangle(-30, WORLD_H / 2, 60, WORLD_H + 400, opts),
      Bodies.rectangle(WORLD_W + 30, WORLD_H / 2, 60, WORLD_H + 400, opts),
      Bodies.rectangle(WORLD_W / 2, -230, WORLD_W + 200, 60, opts),
    ];
  }

  private recordContacts(event: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.label === 'conveyor') this.conveyorContacts.push([a, b.parent]);
      else if (b.label === 'conveyor') this.conveyorContacts.push([b, a.parent]);
      if (a.label === 'springPad') this.springContacts.push([a, b.parent]);
      else if (b.label === 'springPad') this.springContacts.push([b, a.parent]);
    }
  }

  private isFree(body: Matter.Body) {
    return !body.isStatic && !body.isSensor && body.plugin?.partType && PART_DEFS[body.plugin.partType as PartType].motion === 'dynamic';
  }

  private beforeStep() {
    if (!this.running) return;

    // Conveyors: push touching bodies along the belt, up to a target speed.
    for (const [belt, other] of this.conveyorContacts) {
      if (!this.isFree(other)) continue;
      const part = belt.plugin?.part as PlacedPart | undefined;
      const sign = part?.flip ? -1 : 1;
      const dx = Math.cos(belt.angle) * sign;
      const dy = Math.sin(belt.angle) * sign;
      const along = other.velocity.x * dx + other.velocity.y * dy;
      if (along < CONVEYOR_SPEED) {
        const f = other.mass * CONVEYOR_FORCE;
        Body.applyForce(other, other.position, { x: dx * f, y: dy * f });
      }
    }
    this.conveyorContacts = [];

    // Driven gears turn at their gear-ratio speed.
    for (const pv of this.pivots) {
      if (pv.speed !== undefined) Body.setAngularVelocity(pv.body, pv.speed);
    }
  }

  private afterStep() {
    if (!this.running) return;

    // Hold pivot parts on their axle; gears also snap to their exact angle so
    // meshed teeth never drift apart.
    for (const pv of this.pivots) {
      if (pv.speed !== undefined) {
        Body.setAngle(pv.body, pv.angle0 + pv.speed * this.steps, false);
      }
      const c = Math.cos(pv.body.angle);
      const s = Math.sin(pv.body.angle);
      Body.setPosition(pv.body, { x: pv.x + pv.ox * c - pv.oy * s, y: pv.y + pv.ox * s + pv.oy * c }, false);
      Body.setVelocity(pv.body, { x: 0, y: 0 });
    }

    // Springs: launch bodies that are on top of the pad.
    for (const [pad, other] of this.springContacts) {
      if (!this.isFree(other)) continue;
      const key = `${pad.id}:${other.id}`;
      const last = this.springCooldown.get(key);
      if (last !== undefined && this.steps - last < SPRING_COOLDOWN_STEPS) continue;
      const nx = Math.sin(pad.angle);
      const ny = -Math.cos(pad.angle);
      const side = (other.position.x - pad.position.x) * nx + (other.position.y - pad.position.y) * ny;
      if (side <= 0) continue;
      const part = pad.plugin?.part as PlacedPart | undefined;
      const speed = SPRING_SPEEDS[part?.power ?? 2];
      const vn = other.velocity.x * nx + other.velocity.y * ny;
      if (vn >= speed) continue;
      Body.setVelocity(other, {
        x: other.velocity.x + (speed - vn) * nx,
        y: other.velocity.y + (speed - vn) * ny,
      });
      this.springCooldown.set(key, this.steps);
      pad.plugin.firedAt = this.steps;
    }
    this.springContacts = [];
  }

  private recordTrails() {
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.label !== 'ball' && body.label !== 'heavyBall') continue;
      let trail = this.trails.get(body.id);
      if (!trail) {
        trail = { label: body.label, points: [] };
        this.trails.set(body.id, trail);
      }
      if (trail.points.length < TRAIL_MAX) trail.points.push({ x: body.position.x, y: body.position.y });
    }
  }

  private detectGoal(event: Matter.IEventCollision<Matter.Engine>) {
    if (!this.running || !this.goalEnabled || this.solved) return;
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const other = a.label === 'goalSensor' ? b.parent : b.label === 'goalSensor' ? a.parent : null;
      if (other && this.goalTargets.includes(other.label)) {
        this.solved = true;
        this.onSolved?.();
        return;
      }
    }
  }
}
