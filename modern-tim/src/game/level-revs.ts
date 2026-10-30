/**
 * The game version in which each level was last changed in a way that affects scores (its layout, goal,
 * parts or the physics it relies on). When a level's version here changes, its high scores are scrubbed:
 * the server clears the community boards and every player's game clears its own copy on the next visit.
 *
 * Do not edit by hand: after changing a level run `npm run level-revs -- bump <id> ...` (or `bump all` after a
 * physics change). `npm run level-revs` checks that nothing changed without a bump.
 */
export const LEVEL_REVS: Record<string, string> = {
  ramps: '0.4g',
  conveyor: '0.4g',
  springs: '0.4g',
  levers: '0.4g',
  dominoes: '0.4g',
  gears: '0.4g',
  spin: '0.4g',
  pulleys2: '0.4g',
  machine: '0.4g',
  overtop: '0.4g',
  bridge: '0.4g',
  chain: '0.4g',
  reach: '0.4g',
  tackle2: '0.4g',
  tradeoff2: '0.4g',
  double: '0.4g',
  crane3: '0.4g',
  skyhigh: '0.4g',
  slalom: '0.4g',
  maze: '0.4g',
  energy: '0.4g',
};

/** Same idea for the November 2026 puzzle set (its levels have their own versions, so changing one wipes only that one). */
export const NOV_REVS: Record<string, string> = {
  ramps: 'nov-0.4x',
  conveyor: 'nov-0.4x',
  springs: 'nov-0.4x',
  levers: 'nov-0.4x',
  dominoes: 'nov-0.4x',
  gears: 'nov-0.4x',
  spin: 'nov-0.4x',
  pulleys2: 'nov-0.4x',
  machine: 'nov-0.4x',
  overtop: 'nov-0.4x',
  bridge: 'nov-0.4x',
  chain: 'nov-0.4x',
  reach: 'nov-0.4x',
  tackle2: 'nov-0.4x',
  tradeoff2: 'nov-0.4x',
  double: 'nov-0.4x',
  crane3: 'nov-0.4x',
  skyhigh: 'nov-0.4x',
  slalom: 'nov-0.4x',
  maze: 'nov-0.4x',
  energy: 'nov-0.4x',
};
