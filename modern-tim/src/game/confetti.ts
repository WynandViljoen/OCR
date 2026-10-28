/** A short burst of confetti on a full-screen canvas. Respects "reduce motion". */
interface Piece { x: number; y: number; vx: number; vy: number; r: number; spin: number; color: string; w: number; h: number }

export function burst(canvas: HTMLCanvasElement, count = 140) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const c = canvas.getContext('2d');
  if (!c) return;
  const colors = ['#2f6fed', '#f6a21a', '#1a9d5b', '#e63946', '#8a5cf6', '#14b8c4'];
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    pieces.push({
      x: canvas.width / 2 + side * canvas.width * 0.12 * Math.random(),
      y: canvas.height * 0.55,
      vx: (Math.random() * 7 + 2) * side * dpr * (Math.random() > 0.5 ? 1 : 0.4),
      vy: -(Math.random() * 13 + 7) * dpr,
      r: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length],
      w: (5 + Math.random() * 6) * dpr,
      h: (3 + Math.random() * 4) * dpr,
    });
  }
  canvas.style.display = 'block';
  const start = performance.now();
  const tick = (now: number) => {
    const t = now - start;
    c.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.vy += 0.35 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.spin;
      c.save();
      c.globalAlpha = Math.max(0, 1 - t / 2600);
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    if (t < 2600) requestAnimationFrame(tick);
    else {
      c.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  };
  requestAnimationFrame(tick);
}
