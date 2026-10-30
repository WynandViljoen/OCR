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
  PULLEY_RADIUS,
  SPRING_SPEEDS,
  type PartType,
  type PlacedPart,
} from './parts';
import { propValue } from './props';
import { ropeLength, solveRope } from './rope';
import { computeGearTrain, pointPolygonDistance, type GearTrain } from './mechanics';

const { Engine, Composite, Bodies, Body, Events } = Matter;

/** A run that did not solve the level: see Simulation.checkFailure. */
export type FailReason = 'rest' | 'lost';
const REST_SPEED = 0.5;    // px per step (30 px per second: a ball creeping along the floor counts as still)
const REST_SPIN = 0.01;    // radians per step
export const REST_STEPS = 75;      // 1.25 s of stillness (the longest pause in any recorded solution is 0.9 s: see check-failure)
const MIN_RUN_STEPS = 60;  // never fail in the first second

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

/** What the simulation reports when a ball reaches the goal. */
export interface SolveInfo {
  /** Body label of the ball that scored (e.g. 'ball'). */
  label: string;
  /** Distance that ball travelled since the run started, in world pixels. */
  pathPx: number;
  /** Simulation steps from Start to the goal (60 per second). */
  steps: number;
}

/** A motorless gear train. It turns as one: `omega` is the speed of the first gear, in radians per step. */
interface Flywheel {
  members: { pivot: PivotInfo; factor: number }[];
  omega: number;
  theta: number;
}

/** A rope running from weight `a` over a pulley to weight `b`. */
interface RopeInfo {
  a: Matter.Body;
  b: Matter.Body;
  /** Where the rope leaves the pulley rim on each side. */
  pa: { x: number; y: number };
  pb: { x: number; y: number };
  /** The pulley body and which side weight `a` hangs on, so a moving pulley moves the rim anchors. */
  pulley: Matter.Body;
  aOnLeft: boolean;
  strands: number;
  length: number;
  friction: number;
}

/** How quickly a free-spinning train loses speed (fraction per step), like a little friction in the axles. */
const FLYWHEEL_DRAG = 0.004;
/**
 * A real toy gear is far lighter than the solid disc the physics engine models, so a hit on a free
 * train (a ball landing on a paddle) is multiplied by this. 1 would be the engine's own heavy disc.
 */
const FLYWHEEL_LEVERAGE = 95;

interface PivotInfo {
  body: Matter.Body;
  id: number;
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
  solvedInfo: SolveInfo | null = null;
  /** A run that can no longer succeed: 'rest' = everything came to rest without the goal, 'lost' = the ball left the play area. */
  failed: FailReason | null = null;
  onFailed: ((reason: FailReason) => void) | null = null;
  private restSteps = 0;
  private poses = new Map<number, { x: number; y: number; a: number }>();
  onSolved: ((info: SolveInfo) => void) | null = null;
  /** Called for a noticeable hit; `speed` is the closing speed in px per step. Used for sound effects. */
  onImpact: ((speed: number, a: string, b: string) => void) | null = null;
  steps = 0;
  /** Motion paths of balls during the current run. */
  trails = new Map<number, Trail>();
  gearTrain: GearTrain = { speeds: new Map(), links: [], jammed: new Set(), free: [] };

  private built = new Map<number, Matter.Body[]>();
  private partsById = new Map<number, PlacedPart>();
  private pivots: PivotInfo[] = [];
  /** Motorless gear trains that a ball can set turning (see stepFlywheels). */
  private flywheels: Flywheel[] = [];
  /** Ropes over pulleys (see stepRopes). */
  private ropes: RopeInfo[] = [];
  /** Pulleys on a rail: they slide up or down once the simulation runs. */
  private lifts: { body: Matter.Body; x: number; y0: number; dir: number; speed: number; travel: number }[] = [];
  private conveyorContacts: [Matter.Body, Matter.Body][] = [];
  private springContacts: [Matter.Body, Matter.Body][] = [];
  private springCooldown = new Map<string, number>();
  /** Distance travelled so far by each ball (read-only bookkeeping, it never moves anything). */
  private paths = new Map<number, { x: number; y: number; length: number }>();

  constructor() {
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    Events.on(this.engine, 'beforeUpdate', () => this.beforeStep());
    Events.on(this.engine, 'afterUpdate', () => this.afterStep());
    Events.on(this.engine, 'collisionStart', (e: Matter.IEventCollision<Matter.Engine>) => {
      this.recordContacts(e);
      this.detectGoal(e);
      if (this.onImpact && this.running) {
        for (const pair of e.pairs) {
          const dx = pair.bodyA.velocity.x - pair.bodyB.velocity.x;
          const dy = pair.bodyA.velocity.y - pair.bodyB.velocity.y;
          const speed = Math.hypot(dx, dy);
          if (speed > 2 && !pair.bodyA.isSensor && !pair.bodyB.isSensor) this.onImpact(speed, pair.bodyA.label, pair.bodyB.label);
        }
      }
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
    this.flywheels = [];
    this.ropes = [];
    this.lifts = [];
    this.conveyorContacts = [];
    this.springContacts = [];
    this.springCooldown.clear();
    this.trails.clear();
    this.paths.clear();
    this.running = play;
    this.solved = false;
    this.solvedInfo = null;
    this.failed = null;
    this.restSteps = 0;
    this.poses.clear();
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
        this.pivots.push({ id: p.id, body, x: p.x, y: p.y, ox: dx * c - dy * s, oy: dx * s + dy * c, speed, angle0: body.angle });
      }
    }

    // Motorless gear trains: let a ball set them turning (and carry that turn along gears and strings).
    if (play) {
      for (const group of this.gearTrain.free) {
        const members = group.flatMap(({ id, factor }) => {
          const pivot = this.pivots.find((pv) => pv.id === id);
          return pivot ? [{ pivot, factor }] : [];
        });
        if (members.length) this.flywheels.push({ members, omega: 0, theta: 0 });
      }
    }

    // Ropes over pulleys: the rope is exactly as long as the gap the player built.
    if (play) {
      for (const p of parts) {
        if (p.type !== 'rope' || !p.link || p.link.via === undefined) continue;
        const a = this.built.get(p.link.a)?.[0];
        const b = this.built.get(p.link.b)?.[0];
        const pulley = this.partsById.get(p.link.via);
        if (!a || !b || !pulley || a === b) continue;
        const left = { x: pulley.x - PULLEY_RADIUS, y: pulley.y };
        const right = { x: pulley.x + PULLEY_RADIUS, y: pulley.y };
        const aOnLeft = a.position.x <= b.position.x;
        const pa = aOnLeft ? left : right;
        const pb = aOnLeft ? right : left;
        const strands = propValue('rope', p.props, 'strands');
        this.ropes.push({
          a,
          b,
          pa,
          pb,
          pulley: this.built.get(p.link.via)?.[0] ?? a,
          aOnLeft,
          strands,
          length: ropeLength(a.position, b.position, pa, pb, strands),
          friction: propValue('pulley', pulley.props, 'friction'),
        });
      }
    }

    // Pulleys with a motor slide along a vertical rail.
    if (play) {
      for (const p of parts) {
        if (p.type !== 'pulley') continue;
        const dir = Math.sign(propValue('pulley', p.props, 'lift'));
        const body = this.built.get(p.id)?.[0];
        if (!dir || !body) continue;
        this.lifts.push({
          body,
          x: p.x,
          y0: p.y,
          dir: -dir, // "Lift up" means the y value gets smaller
          speed: propValue('pulley', p.props, 'liftSpeed'),
          travel: propValue('pulley', p.props, 'travel'),
        });
      }
    }

    // Balls start their path where the player placed them.
    for (const body of Composite.allBodies(world)) {
      if (body.label === 'ball' || body.label === 'heavyBall' || body.label === 'crate' || body.label === 'mouse') {
        this.paths.set(body.id, { x: body.position.x, y: body.position.y, length: 0 });
      }
    }
  }

  /** Advance the physics by one fixed 60 Hz step. */
  step() {
    this.steps++;
    Engine.update(this.engine, STEP_MS);
    this.trackPaths();
    if (this.steps % TRAIL_EVERY === 0) this.recordTrails();
    this.checkFailure();
  }

  /**
   * A run fails when it cannot succeed any more: every ball that could solve the level has left the play area,
   * or everything that can move (balls, crates, dominoes... not the gears, which a motor keeps turning) has been still for
   * REST_STEPS in a row, after the first MIN_RUN_STEPS. Belts, motors and gears turning do not count as motion.
   */
  private checkFailure() {
    if (!this.running || !this.goalEnabled || this.solved || this.failed) return;
    const bodies = Composite.allBodies(this.engine.world);
    const targets = bodies.filter((b) => this.goalTargets.includes(b.label));
    if (!targets.length) return;
    if (targets.every((b) => b.position.x < -120 || b.position.x > WORLD_W + 120 || b.position.y > WORLD_H + 200)) {
      return this.fail('lost');
    }
    // Anything free to move that is still moving, or any fixed part that a mechanism is moving (a lift, a pulley,
    // a spinner), means the run is not over. Gears are left out: a motor keeps them turning for ever.
    let moving = false;
    for (const b of bodies) {
      if (/gear$/i.test(b.label)) continue;
      if (b.isStatic) {
        const prev = this.poses.get(b.id);
        if (prev && (Math.hypot(b.position.x - prev.x, b.position.y - prev.y) > 0.05 || Math.abs(b.angle - prev.a) > 0.0005)) moving = true;
        this.poses.set(b.id, { x: b.position.x, y: b.position.y, a: b.angle });
      } else if (b.speed > REST_SPEED || Math.abs(b.angularSpeed) > REST_SPIN) {
        moving = true;
      }
    }
    this.restSteps = moving ? 0 : this.restSteps + 1;
    if (this.steps >= MIN_RUN_STEPS && this.restSteps >= REST_STEPS) this.fail('rest');
  }

  private fail(reason: FailReason) {
    this.failed = reason;
    this.onFailed?.(reason);
  }

  /** Add this step's movement to each ball's travelled distance. */
  private trackPaths() {
    for (const [id, path] of this.paths) {
      const body = this.engine.world.bodies.find((b) => b.id === id);
      if (!body) continue;
      path.length += Math.hypot(body.position.x - path.x, body.position.y - path.y);
      path.x = body.position.x;
      path.y = body.position.y;
    }
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
      const maxSpeed = part ? propValue('conveyor', part.props, 'speed') : CONVEYOR_SPEED;
      if (along < maxSpeed) {
        const f = other.mass * CONVEYOR_FORCE;
        Body.applyForce(other, other.position, { x: dx * f, y: dy * f });
      }
    }
    this.conveyorContacts = [];

    // Driven gears turn at their gear-ratio speed.
    for (const pv of this.pivots) {
      if (pv.speed !== undefined) Body.setAngularVelocity(pv.body, pv.speed);
    }
    for (const fw of this.flywheels) {
      for (const m of fw.members) Body.setAngularVelocity(m.pivot.body, m.factor * fw.omega);
    }
  }

  /**
   * A motorless gear train turns as one. Whatever the collisions did to each gear this step
   * (a ball landing on a paddle) is pooled into one speed for the whole train, weighted by how
   * hard each gear is to turn, then handed back to every gear in proportion to its gear ratio.
   */
  private stepFlywheels() {
    for (const fw of this.flywheels) {
      // The engine derives each gear's angular velocity from how far we turned it, so first take away the
      // turning we asked for ourselves (factor * last omega). What is left was pushed by a collision.
      let push = 0;
      let stiffness = 0;
      for (const m of fw.members) {
        const inertia = m.pivot.body.inertia;
        const hit = Body.getAngularVelocity(m.pivot.body) - m.factor * fw.omega;
        push += inertia * m.factor * hit;
        stiffness += inertia * m.factor * m.factor;
      }
      const kick = stiffness > 0 && Number.isFinite(stiffness) && Number.isFinite(push) ? (push / stiffness) * FLYWHEEL_LEVERAGE : 0;
      let omega = (fw.omega + kick) * (1 - FLYWHEEL_DRAG);
      if (!Number.isFinite(omega)) omega = 0;
      omega = Math.max(-0.15, Math.min(0.15, omega));
      if (Math.abs(omega) < 1e-4) omega = 0;
      fw.omega = omega;
      fw.theta += omega;
      for (const m of fw.members) Body.setAngle(m.pivot.body, m.pivot.angle0 + m.factor * fw.theta, false);
    }
  }

  /** Ropes pull the weights along, so the heavier side drops and lifts the lighter one. */
  private stepLifts() {
    for (const l of this.lifts) {
      const d = Math.min(l.travel, l.speed * this.steps);
      const y = Math.max(PULLEY_RADIUS + 4, Math.min(WORLD_H - 40, l.y0 + l.dir * d));
      Body.setPosition(l.body, { x: l.x, y }, false);
    }
  }

  private stepRopes() {
    for (const r of this.ropes) {
      const px = r.pulley.position.x;
      const py = r.pulley.position.y;
      r.pa.x = px + (r.aOnLeft ? -PULLEY_RADIUS : PULLEY_RADIUS);
      r.pa.y = py;
      r.pb.x = px + (r.aOnLeft ? PULLEY_RADIUS : -PULLEY_RADIUS);
      r.pb.y = py;
      const va = Body.getVelocity(r.a);
      const vb = Body.getVelocity(r.b);
      const res = solveRope(
        { x: r.a.position.x, y: r.a.position.y, vx: va.x, vy: va.y, mass: r.a.mass },
        { x: r.b.position.x, y: r.b.position.y, vx: vb.x, vy: vb.y, mass: r.b.mass },
        r.pa,
        r.pb,
        r.strands,
        r.length,
        r.friction,
      );
      if (!res.tight) continue;
      if (res.moveA.x || res.moveA.y) Body.setPosition(r.a, { x: r.a.position.x + res.moveA.x, y: r.a.position.y + res.moveA.y }, false);
      if (res.moveB.x || res.moveB.y) Body.setPosition(r.b, { x: r.b.position.x + res.moveB.x, y: r.b.position.y + res.moveB.y }, false);
      Body.setVelocity(r.a, { x: res.a.vx, y: res.a.vy });
      Body.setVelocity(r.b, { x: res.b.vx, y: res.b.vy });
    }
  }

  private afterStep() {
    if (!this.running) return;
    this.stepLifts();
    this.stepRopes();

    this.stepFlywheels();

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
        this.solvedInfo = { label: other.label, pathPx: this.paths.get(other.id)?.length ?? 0, steps: this.steps };
        this.onSolved?.(this.solvedInfo);
        return;
      }
    }
  }
}
