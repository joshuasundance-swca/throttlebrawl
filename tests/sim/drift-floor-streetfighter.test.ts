import { expect, it } from 'vitest';
import { memoCases } from './case-results';
import { crookedRace } from './drift-hairpins-fixture';

const BIKES = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'];
const BIKE = BIKES[1]!;
const DEFAULT = { min: 18, exit: 10 };
const LOWERED = { min: 12, exit: 6 };
const pairs = [
  DEFAULT,
  { min: 14, exit: 7 },
  LOWERED,
  { min: 10, exit: 5 },
  { min: 8, exit: 4 },
  { min: 6, exit: 3 },
];
const cases = memoCases(pairs, ({ min, exit }) => {
  const r = crookedRace(BIKE, min, exit);
  return {
    line:
      `floors ${min}/${exit}, ${BIKE}: ${r.held} of ${r.apexes} hairpins held, ${r.drifts} drifts ` +
      `(${r.driftS.toFixed(1)} s, ${r.clean} clean), ${r.crashes} crashes, banked $${Math.round(r.cash)}, ` +
      `the block in ${r.blockS.toFixed(1)} s`,
  };
});

it('prints floors 18/10 for base:streetfighter-750', () => {
  cases.get(pairs[0]!);
}, 600_000);
it('prints floors 14/7 for base:streetfighter-750', () => {
  cases.get(pairs[1]!);
}, 600_000);
it('prints floors 12/6 for base:streetfighter-750', () => {
  cases.get(pairs[2]!);
}, 600_000);
it('prints floors 10/5 for base:streetfighter-750', () => {
  cases.get(pairs[3]!);
}, 600_000);
it('prints floors 8/4 for base:streetfighter-750', () => {
  cases.get(pairs[4]!);
}, 600_000);
it('prints floors 6/3 for base:streetfighter-750', () => {
  cases.get(pairs[5]!);
}, 600_000);
it('prints all six floors that work for base:streetfighter-750: the bot per floor pair at $1 a drift second', () => {
  const lines = cases.results().map((row) => row.line);
  console.log(
    `[T2.6] Lombard Street (osm-sf-lombard-run), ${BIKE}, drift bot, banked drift cash at perDriftSecondCash 1:\n${lines.join('\n')}`,
  );
  expect(lines).toHaveLength(pairs.length);
});
