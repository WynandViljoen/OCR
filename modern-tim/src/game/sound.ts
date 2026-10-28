/**
 * Small synthesised sound effects (no audio files). The audio context is only
 * created after the first tap or key press, as browsers require. Muting is
 * remembered in this browser.
 */
export type Sfx = 'bounce' | 'thud' | 'place' | 'start' | 'success' | 'click';

const MUTE_KEY = 'modern-tim:muted';
let ctx: AudioContext | null = null;
let muted = false;
let lastBounce = 0;

try {
  muted = window.localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* ignore */
}

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    window.localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** `strength` (0 to 1) is how hard something hit, for bounce and thud. */
export function playSound(kind: Sfx, strength = 0.5) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const s = Math.max(0.1, Math.min(1, strength));
  switch (kind) {
    case 'bounce':
      if (t - lastBounce < 0.06) return; // many contacts in one frame sound like one
      lastBounce = t;
      tone(c, 300 + 300 * s, t, 0.12, 0.05 + 0.1 * s, 'sine', 160);
      break;
    case 'thud':
      if (t - lastBounce < 0.06) return;
      lastBounce = t;
      tone(c, 110, t, 0.14, 0.06 + 0.12 * s, 'triangle', 60);
      break;
    case 'place':
      tone(c, 520, t, 0.07, 0.07, 'square', 380);
      break;
    case 'click':
      tone(c, 800, t, 0.03, 0.04, 'square');
      break;
    case 'start':
      tone(c, 330, t, 0.1, 0.07, 'triangle');
      tone(c, 440, t + 0.09, 0.14, 0.07, 'triangle');
      break;
    case 'success':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.11, 0.25, 0.09, 'triangle'));
      break;
  }
}
