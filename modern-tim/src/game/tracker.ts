/**
 * Player tracking for the admin dashboard (admin.php). No DOM, no Matter.
 *
 * Each browser gets a device id from the server (random and signed, so it cannot
 * be invented or edited). It is kept in localStorage and a cookie. If a player
 * clears both, the server simply issues a new one: no website can prevent that.
 *
 * Everything fails soft. If admin.php is missing or offline the game carries on.
 */
import { VERSION } from './version';

export const TRACK_ENDPOINT = 'admin.php?api=track';
export const DEVICE_KEY = 'modern-tim:device';
const COOKIE = 'tim_device';
const TIMEOUT_MS = 6000;

export type TrackEvent = 'visit' | 'name' | 'level' | 'play' | 'solve' | 'hint';

function readStore(): string {
  try {
    return window.localStorage.getItem(DEVICE_KEY) || '';
  } catch {
    return '';
  }
}

function readCookie(): string {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

function saveId(id: string): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* private mode: the cookie still works */
  }
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; max-age=${60 * 60 * 24 * 730}; path=/; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

/** The id this browser holds right now ('' until the server has issued one). */
export function deviceId(): string {
  return readStore() || readCookie();
}

// Events are sent one after another so the very first call can bring back the id
// before the next one is sent (otherwise two ids could be issued at once).
let queue: Promise<void> = Promise.resolve();

export function track(ev: TrackEvent, name: string, level = '', d: Record<string, unknown> = {}): void {
  queue = queue.then(async () => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetch(TRACK_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ id: deviceId(), ev, name, level, version: VERSION, d }),
        signal: ctl?.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { id?: unknown };
      if (typeof data.id === 'string' && data.id) saveId(data.id);
    } catch {
      /* offline or no admin.php: ignore */
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
