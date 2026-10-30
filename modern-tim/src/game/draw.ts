/**
 * Custom canvas rendering. We draw every body ourselves (instead of using
 * Matter.Render) so parts look the same on the playfield, in the editor ghost
 * and in the palette thumbnails.
 */
import type Matter from 'matter-js';
import { COLORS, CRATE_SIZE, PART_DEFS, PULLEY_RADIUS, type PartType, type PlacedPart } from './parts';
import type { GearTrain } from './mechanics';
import { propValue } from './props';

export interface DrawState {
  steps: number;
  playing: boolean;
  train: GearTrain | null;
}

const INK = COLORS.ink;

function pieces(body: Matter.Body) {
  return body.parts.length > 1 ? body.parts.slice(1) : [body];
}

function pathPiece(ctx: CanvasRenderingContext2D, piece: Matter.Body, dx = 0, dy = 0) {
  if (piece.circleRadius) {
    ctx.moveTo(piece.position.x + dx + piece.circleRadius, piece.position.y + dy);
    ctx.arc(piece.position.x + dx, piece.position.y + dy, piece.circleRadius, 0, Math.PI * 2);
    return;
  }
  const v = piece.vertices;
  ctx.moveTo(v[0].x + dx, v[0].y + dy);
  for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x + dx, v[i].y + dy);
  ctx.closePath();
}

/** Add every piece of `bodies` to the current path (for outlines and ghosts). */
export function traceBodies(ctx: CanvasRenderingContext2D, bodies: Matter.Body[]) {
  ctx.beginPath();
  for (const body of bodies) for (const piece of pieces(body)) pathPiece(ctx, piece);
}

/**
 * Sandbox: a part the creator marked as fixed (part of the puzzle, locked in place for players). It gets a grey
 * diagonal hatch, a dashed orange outline and a padlock, so it can never be mistaken for a part to build with.
 */
export function drawFixedMark(ctx: CanvasRenderingContext2D, bodies: Matter.Body[], zoom = 1) {
  if (!bodies.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  for (const b of bodies) {
    minX = Math.min(minX, b.bounds.min.x);
    minY = Math.min(minY, b.bounds.min.y);
    maxX = Math.max(maxX, b.bounds.max.x);
  }
  const maxY = Math.max(...bodies.map((b) => b.bounds.max.y));
  const z = Math.max(0.4, zoom);
  ctx.save();
  traceBodies(ctx, bodies);
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,52,76,0.55)';
  ctx.lineWidth = 2 / z;
  ctx.beginPath();
  const gap = 9 / z;
  for (let x = minX - (maxY - minY); x < maxX; x += gap) {
    ctx.moveTo(x, maxY);
    ctx.lineTo(x + (maxY - minY), minY);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 2.5 / z;
  ctx.setLineDash([6 / z, 4 / z]);
  ctx.strokeStyle = '#d9730d';
  traceBodies(ctx, bodies);
  ctx.stroke();
  ctx.setLineDash([]);
  // The padlock sits just above the part, on a small white disc.
  const cx = (minX + maxX) / 2;
  const cy = Math.max(14, minY - 12 / z);
  ctx.beginPath();
  ctx.arc(cx, cy, 11 / z, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 2 / z;
  ctx.strokeStyle = '#d9730d';
  ctx.stroke();
  ctx.font = `${13 / z}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText('\u{1F512}', cx, cy + 1 / z);
  ctx.restore();
}

/** How far the spring pad is pushed out (local y, negative = up) right after it fires. */
function springKick(body: Matter.Body, state: DrawState) {
  const fired = body.plugin?.firedAt as number | undefined;
  if (fired === undefined || !state.playing) return 0;
  const t = state.steps - fired;
  if (t > 14) return 0;
  return Math.sin((t / 14) * Math.PI) * -10;
}

function springOffset(body: Matter.Body, state: DrawState) {
  const amount = springKick(body, state);
  return { x: -Math.sin(body.angle) * amount, y: Math.cos(body.angle) * amount };
}

/** Fill and outline bodies using their render styles. */
export function drawBodies(ctx: CanvasRenderingContext2D, bodies: Matter.Body[], state: DrawState) {
  for (const body of bodies) {
    if (body.render?.visible === false) continue;
    const off = body.label === 'springPad' ? springOffset(body, state) : { x: 0, y: 0 };
    for (const piece of pieces(body)) {
      const r = piece.render?.fillStyle ? piece.render : body.render;
      ctx.beginPath();
      pathPiece(ctx, piece, off.x, off.y);
      ctx.fillStyle = (r.fillStyle as string) ?? '#999';
      ctx.fill();
      if (body.isSensor) ctx.setLineDash([5, 4]);
      ctx.lineWidth = (r.lineWidth as number) ?? 2;
      ctx.strokeStyle = (r.strokeStyle as string) ?? INK;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Things drawn behind bodies: seesaw fulcrums, spring coils, wheel stands. */
export function drawUnderlay(ctx: CanvasRenderingContext2D, body: Matter.Body, state: DrawState) {
  const part = body.plugin?.part as PlacedPart | undefined;
  if (!part) return;
  if (body.label === 'seesaw' || body.label === 'wheel' || PART_DEFS[part.type].gear) {
    // Fulcrum / stand: a triangle from the axle to below.
    const h = body.label === 'seesaw' ? 30 : 0;
    if (h) {
      ctx.beginPath();
      ctx.moveTo(part.x, part.y);
      ctx.lineTo(part.x - 18, part.y + h);
      ctx.lineTo(part.x + 18, part.y + h);
      ctx.closePath();
      ctx.fillStyle = '#6b7690';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
  if (body.label === 'springPad') {
    // Coil between the pad (local y -14) and the base (local y +16) of the part.
    ctx.save();
    ctx.translate(part.x, part.y);
    ctx.rotate(part.angle);
    const top = -8 + springKick(body, state);
    const bottom = 11;
    const turns = 5;
    ctx.beginPath();
    for (let i = 0; i <= turns * 2; i++) {
      const y = top + ((bottom - top) * i) / (turns * 2);
      const x = i === 0 || i === turns * 2 ? 0 : i % 2 ? -20 : 20;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#d7dbe6';
    ctx.stroke();
    ctx.restore();
  }
}

/** Details drawn on top of bodies. */
export function drawDecoration(ctx: CanvasRenderingContext2D, body: Matter.Body, state: DrawState) {
  const part = body.plugin?.part as PlacedPart | undefined;
  const { x, y } = body.position;
  ctx.save();
  switch (body.label) {
    case 'ball': {
      ctx.beginPath();
      ctx.arc(x - 5, y - 5, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
      break;
    }
    case 'heavyBall': {
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('10kg', 0, 1);
      break;
    }
    case 'conveyor': {
      const len = part?.w ?? 150;
      const sign = part?.flip ? -1 : 1;
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      const spacing = 26;
      const span = len - 36;
      const beltScale = part ? propValue('conveyor', part.props, 'speed') / 3.2 : 1;
      const offset = state.playing ? (state.steps * 0.9 * beltScale) % spacing : 0;
      ctx.strokeStyle = 'rgba(29,36,64,0.7)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let k = 0; k * spacing < span; k++) {
        const t = (k * spacing + offset) % span;
        const xx = sign * (-span / 2 + t);
        ctx.beginPath();
        ctx.moveTo(xx - 4 * sign, -4);
        ctx.lineTo(xx + 2 * sign, 0);
        ctx.lineTo(xx - 4 * sign, 4);
        ctx.stroke();
      }
      for (const ex of [-len / 2 + 9, len / 2 - 9]) {
        ctx.beginPath();
        ctx.arc(ex, 0, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff4d6';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      break;
    }
    case 'crate': {
      // Wooden planks and a weight label.
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      const h = CRATE_SIZE / 2;
      ctx.strokeStyle = 'rgba(29,36,64,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-h + 3, -h + 3);
      ctx.lineTo(h - 3, h - 3);
      ctx.moveTo(h - 3, -h + 3);
      ctx.lineTo(-h + 3, h - 3);
      ctx.stroke();
      const kg = Math.round(propValue('crate', part?.props, 'weight') * 1250);
      ctx.rotate(-body.angle);
      ctx.fillStyle = '#fff4d6';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-14, -7, 28, 14, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = '800 10px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${kg}kg`, 0, 1);
      break;
    }
    case 'pulley': {
      // A wheel with a groove, spokes and a hook to hang it from.
      ctx.translate(x, y);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -PULLEY_RADIUS);
      ctx.lineTo(0, -PULLEY_RADIUS - 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -PULLEY_RADIUS - 17, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, PULLEY_RADIUS - 5, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (PULLEY_RADIUS - 5), Math.sin(a) * (PULLEY_RADIUS - 5));
        ctx.lineTo(-Math.cos(a) * (PULLEY_RADIUS - 5), -Math.sin(a) * (PULLEY_RADIUS - 5));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      // Motor: show the rail the pulley rides on, and which way it goes.
      const lift = Math.sign(propValue('pulley', part?.props, 'lift'));
      if (lift) {
        const travel = propValue('pulley', part?.props, 'travel');
        const homeY = (part?.y ?? y) - y;
        const endY = homeY - lift * travel;
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = '#2f6fed';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, homeY);
        ctx.lineTo(0, endY);
        ctx.stroke();
        ctx.setLineDash([]);
        const tip = endY;
        const dirY = lift > 0 ? 1 : -1; // arrowhead points from the tip back toward home
        ctx.fillStyle = '#2f6fed';
        ctx.beginPath();
        ctx.moveTo(0, tip);
        ctx.lineTo(-7, tip + dirY * 11);
        ctx.lineTo(7, tip + dirY * 11);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'domino': {
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      ctx.fillStyle = INK;
      for (const yy of [-17, 17]) {
        ctx.beginPath();
        ctx.arc(0, yy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(-4, -0.75, 8, 1.5);
      break;
    }
    case 'seesaw':
    case 'wheel': {
      ctx.beginPath();
      ctx.arc(part?.x ?? x, part?.y ?? y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    }
    case 'mouse': {
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      ctx.fillStyle = '#f7a8b8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-6, -12, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(10, -2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.quadraticCurveTo(-30, 0, -28, -10);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();

  if (part && PART_DEFS[part.type].gear) drawGearMarks(ctx, body, part, state);
}

function drawGearMarks(ctx: CanvasRenderingContext2D, body: Matter.Body, part: PlacedPart, state: DrawState) {
  const spec = PART_DEFS[part.type].gear!;
  const { x, y } = part;
  ctx.save();
  // A spoke so you can see it turning.
  ctx.translate(x, y);
  ctx.rotate(body.angle);
  ctx.strokeStyle = 'rgba(29,36,64,0.55)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(spec.radius - 9, 0);
  ctx.stroke();
  ctx.rotate(-body.angle);
  ctx.beginPath();
  ctx.arc(0, 0, spec.motor ? 10 : 6, 0, Math.PI * 2);
  ctx.fillStyle = spec.motor ? INK : '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (spec.motor) {
    // Lightning bolt: "this one has power".
    ctx.fillStyle = COLORS.gear;
    ctx.beginPath();
    ctx.moveTo(2, -7);
    ctx.lineTo(-4, 1);
    ctx.lineTo(0, 1);
    ctx.lineTo(-2, 7);
    ctx.lineTo(4, -1);
    ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Direction arrows while editing: preview how the train will turn.
  if (!state.playing && state.train) {
    const speed = state.train.speeds.get(part.id);
    const jammed = state.train.jammed.has(part.id);
    if (jammed) drawJam(ctx, x, y);
    else if (speed) drawSpinArrow(ctx, x, y, spec.radius + 14, speed > 0 ? 1 : -1, spec.motor ? COLORS.motor : COLORS.goal);
  }
}

/**
 * A rope from weight A up to a pulley, over it, and down to weight B. `top` is where the rope
 * ties on (the top of each weight). With several strands the load side is drawn as several lines.
 */
export function drawRope(
  ctx: CanvasRenderingContext2D,
  a: { x: number; top: number },
  b: { x: number; top: number },
  pulley: { x: number; y: number },
  aOnLeft: boolean,
  strands: number,
  selected = false,
) {
  const left = { x: pulley.x - PULLEY_RADIUS, y: pulley.y };
  const right = { x: pulley.x + PULLEY_RADIUS, y: pulley.y };
  const pa = aOnLeft ? left : right;
  const pb = aOnLeft ? right : left;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.top);
    ctx.lineTo(pa.x, pa.y);
    ctx.arc(pulley.x, pulley.y, PULLEY_RADIUS, aOnLeft ? Math.PI : 0, aOnLeft ? Math.PI * 2 : Math.PI, !aOnLeft);
    ctx.lineTo(b.x, b.top);
    for (let i = 1; i < strands; i++) {
      // Extra strands share the load: fan them out along the top of the weight.
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 7;
      ctx.moveTo(pb.x, pb.y);
      ctx.lineTo(b.x + off, b.top);
    }
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (selected) {
    ctx.strokeStyle = 'rgba(47,125,246,0.45)';
    ctx.lineWidth = 10;
    trace();
    ctx.stroke();
  }
  ctx.strokeStyle = COLORS.rope;
  ctx.lineWidth = 3.5;
  trace();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,236,200,0.8)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 5]);
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  for (const t of [a, b]) {
    ctx.beginPath();
    ctx.arc(t.x, t.top, 3, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A string between two gear hubs: a belt around two little pulleys, with dashes that
 * travel along it while the machine runs. Crossed strings make a figure of eight.
 */
export function drawBelt(ctx: CanvasRenderingContext2D, part: PlacedPart, state: DrawState, selected = false) {
  const belt = part.belt;
  if (!belt) return;
  const { ax, ay, ar, bx, by, br, crossed } = belt;
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1) return;
  const theta = Math.atan2(dy, dx);
  const cosPhi = crossed ? (ar + br) / d : (ar - br) / d;
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
  const at = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });

  const trace = () => {
    ctx.beginPath();
    if (!crossed) {
      const a1 = at(ax, ay, ar, theta + phi);
      const b1 = at(bx, by, br, theta + phi);
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.arc(bx, by, br, theta + phi, theta - phi, true);
      ctx.lineTo(at(ax, ay, ar, theta - phi).x, at(ax, ay, ar, theta - phi).y);
      ctx.arc(ax, ay, ar, theta - phi, theta + phi - Math.PI * 2, true);
    } else {
      const a1 = at(ax, ay, ar, theta + phi);
      const b1 = at(bx, by, br, theta + phi + Math.PI);
      const a2 = at(ax, ay, ar, theta - phi);
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.arc(bx, by, br, theta + phi + Math.PI, theta - phi + Math.PI + Math.PI * 2, false);
      ctx.lineTo(a2.x, a2.y);
      ctx.arc(ax, ay, ar, theta - phi, theta + phi + Math.PI * 2, false);
    }
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (selected) {
    ctx.strokeStyle = 'rgba(47,125,246,0.45)';
    ctx.lineWidth = 12;
    trace();
    ctx.stroke();
  }
  ctx.strokeStyle = COLORS.string;
  ctx.lineWidth = 6;
  trace();
  ctx.stroke();
  // Light dashes that crawl along the string show which way it travels.
  const w = state.train?.speeds.get(part.link?.a ?? -1) ?? 0;
  ctx.strokeStyle = 'rgba(255,236,200,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 11]);
  ctx.lineDashOffset = state.playing ? -(w * ar * state.steps) : 0;
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  // The two little pulleys.
  for (const [cx, cy, r] of [[ax, ay, ar], [bx, by, br]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f3d9b1';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  ctx.restore();
}

/** Curved arrow around (x, y). dir 1 = clockwise. */
export function drawSpinArrow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: 1 | -1, color: string) {
  const start = -Math.PI * 0.85;
  const end = -Math.PI * 0.15;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, start, end);
  ctx.stroke();
  const tipAngle = dir > 0 ? end : start;
  const tx = x + Math.cos(tipAngle) * r;
  const ty = y + Math.sin(tipAngle) * r;
  // Tangent direction of travel at the tip.
  const tang = tipAngle + (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  ctx.translate(tx, ty);
  ctx.rotate(tang);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-4, -7);
  ctx.lineTo(-4, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawJam(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 10);
  ctx.lineTo(x + 10, y + 10);
  ctx.moveTo(x + 10, y - 10);
  ctx.lineTo(x - 10, y + 10);
  ctx.stroke();
  ctx.restore();
}

/** Graph-paper background. */
export function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number, floorTop: number) {
  ctx.fillStyle = '#f4f8fd';
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += 20) {
    ctx.strokeStyle = gx % 100 === 0 ? 'rgba(47,125,246,0.20)' : 'rgba(47,125,246,0.08)';
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, floorTop);
    ctx.stroke();
  }
  for (let gy = 0; gy <= floorTop; gy += 20) {
    ctx.strokeStyle = gy % 100 === 0 ? 'rgba(47,125,246,0.20)' : 'rgba(47,125,246,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(w, gy + 0.5);
    ctx.stroke();
  }
}

/** Draw a part type into a small canvas for the palette. */
export function drawThumbnail(canvas: HTMLCanvasElement, type: PartType) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 64;
  const ch = canvas.clientHeight || 40;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const def = PART_DEFS[type];
  const geom = { x: 0, y: 0, angle: type === 'plank' ? -0.35 : 0, power: 2 };
  const bodies = def.build(geom, false);
  const fake: PlacedPart = { id: -1, type, ...geom };
  for (const b of bodies) b.plugin = { partId: -1, partType: type, part: fake };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bodies) {
    for (const piece of pieces(b)) {
      for (const v of piece.vertices) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    }
  }
  const pad = 5;
  const scale = Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxY - minY), 1.1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  const state: DrawState = { steps: 0, playing: false, train: null };
  if (type === 'rope') {
    drawRope(ctx, { x: -26, top: 14 }, { x: 26, top: 4 }, { x: 0, y: -8 }, true, 1);
    return;
  }
  if (type === 'string') {
    drawBelt(ctx, { ...fake, belt: { ax: -22, ay: 0, ar: 9, bx: 22, by: 0, br: 9, crossed: false } }, state);
    return;
  }
  for (const b of bodies) drawUnderlay(ctx, b, state);
  drawBodies(ctx, bodies, state);
  for (const b of bodies) drawDecoration(ctx, b, state);
}

