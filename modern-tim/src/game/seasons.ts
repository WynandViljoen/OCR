/**
 * Puzzle sets. The game ships every set; the server (scores.php, SEASON_SETS) says which one is live this
 * month, so a new month's puzzles appear at midnight Vancouver time with no new release. The sets share the
 * level ids and names, so a month with no set of its own simply keeps the one before it.
 *
 *   base   the original 21 puzzles (October 2026 and before)
 *   nov    the November 2026 puzzles: the same ones, changed a little and harder
 */
import { LEVELS, type Level } from './levels';
import { NOV_LEVELS } from './levels-nov';

const BASE_LEVELS: Level[] = LEVELS.slice();

export const LEVEL_SETS: Record<string, Level[]> = { base: BASE_LEVELS, nov: NOV_LEVELS };
export const SET_KEY = 'modern-tim:set';

let current = 'base';

export function currentSet(): string {
  return current;
}

/** Put a set's levels into LEVELS (the array the whole game reads). Returns false for an unknown set. */
export function applyLevelSet(name: string): boolean {
  const set = LEVEL_SETS[name];
  if (!set) return false;
  LEVELS.splice(0, LEVELS.length, ...set);
  current = name;
  return true;
}

/** The set this browser used last time, for starting up before the server has answered. */
export function rememberedSet(): string {
  try {
    const v = window.localStorage.getItem(SET_KEY) ?? 'base';
    return LEVEL_SETS[v] ? v : 'base';
  } catch {
    return 'base';
  }
}

export function rememberSet(name: string) {
  try {
    window.localStorage.setItem(SET_KEY, name);
  } catch {
    /* next visit asks the server again */
  }
}
