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
