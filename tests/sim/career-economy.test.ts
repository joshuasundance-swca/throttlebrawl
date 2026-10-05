/// <reference types="vite/client" />
// The career's money, played through by modelled players (playtest 3, T7.5 balance QA; the
// maintainer, 2026-10-03: "money gentle but tighter (each new bike takes about 3-4 races of
// winnings; smaller purses, pricier bikes, repairs after crashes)"; round 3: "Six bikes", regions
// "In order"). career-model.ts plays whole seasons through the career's own code on the real packs
// (the map, the purses, the repairs, the shop); only the race's outcome is modelled, by the player
// models of progression.md section 6. Each band is over hundreds of seeded seasons, never a floor at
// a measured value, and every number comes from the packs, so a content change that breaks the
// promise turns this red.
//
// How the races are counted: a bike's wait is the races ridden from the race that put it on sale (its
// tier opened) to the race after which it was bought.
//
// Two routes through the map (the bands differ, because a player who rides every race banks more
// between bikes than one who rushes each boss):
// - `suggested`: the race the career map suggests next (the results screen's Next): every regular
//   race of a tier, then its boss, retrying a loss. This is the typical player the promise is for.
// - `rush`: each tier's boss as soon as it opens. Fewer races, less cash banked, a longer wait.
import { describe, expect, it } from 'vitest';
import { DEFS, LADDER, PLAYERS, median, playSeason, quantile, type ModelledSeason } from './career-model';

const print = (line: string) => process.stdout.write(`[career-economy] ${line}\n`);

/** `n` seeded seasons of a player on a route. */
function seasons(player: (typeof PLAYERS)[keyof typeof PLAYERS], route: 'suggested' | 'rush', n: number) {
  return Array.from({ length: n }, (_, i) => playSeason(player, 20261004 + i, { route }));
}

/** Per step-up bike: its waits over the seasons that bought it, and how many never did. */
function waits(runs: readonly ModelledSeason[]) {
  return LADDER.slice(1).map((bike, i) => {
    const bought = runs.flatMap((r) => {
      const b = r.bikes[i];
      return b && b.onSale !== null && b.bought !== null ? [b.bought - b.onSale] : [];
    });
    return { key: bike.key, waits: bought, never: runs.length - bought.length };
  });
}

const describeWaits = (rows: ReturnType<typeof waits>) =>
  rows
    .map((w) => `${w.key} ${median(w.waits)} (${quantile(w.waits, 0.25)}-${quantile(w.waits, 0.75)})`)
    .join(', ');

describe('each new bike takes about 3-4 races (the typical player, following the map)', () => {
  const runs = seasons(PLAYERS.typical, 'suggested', 300);
  const rows = waits(runs);

  it('the ladder has step-up bikes to save for, each counted', () => {
    expect(LADDER.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBe(LADDER.length - 1);
  });

  it('every step-up bike: a median of 3 to 4 races from going on sale to bought', () => {
    print(`[examined] typical player, suggested route, ${runs.length} seasons: ${describeWaits(rows)}`);
    for (const w of rows) {
      expect(w.never, `${w.key} never bought`).toBeLessThanOrEqual(runs.length * 0.05);
      expect(median(w.waits), w.key).toBeGreaterThanOrEqual(3);
      expect(median(w.waits), w.key).toBeLessThanOrEqual(4);
    }
  });

  it('the season is longer than before and nobody is stuck: every boss falls, in chapter order', () => {
    const lengths = runs.map((r) => r.races);
    print(
      `[examined] season length ${median(lengths)} races (p25 ${quantile(lengths, 0.25)}, p75 ${quantile(lengths, 0.75)}); ` +
        `about 33 before playtest 3`,
    );
    // "Longer + seasons": about twice the old career's 33 races, and not a grind.
    expect(median(lengths)).toBeGreaterThanOrEqual(60);
    expect(median(lengths)).toBeLessThanOrEqual(100);
    for (const r of runs) {
      expect(r.regionOrder).toEqual(DEFS.map((d) => d.regionId));
      expect(r.profile.bikes.current, 'the top bike by the end').toBe(LADDER.at(-1)?.key);
    }
  });
});

describe('the other players stay in reach', () => {
  it('a typical player who rushes each boss saves longer, but never more than about two tiers', () => {
    const runs = seasons(PLAYERS.typical, 'rush', 200);
    const rows = waits(runs);
    print(`[examined] typical player, rush route, ${runs.length} seasons: ${describeWaits(rows)}`);
    for (const w of rows) {
      expect(w.never, `${w.key} never bought`).toBeLessThanOrEqual(runs.length * 0.05);
      expect(median(w.waits), w.key).toBeGreaterThanOrEqual(3);
      expect(median(w.waits), w.key).toBeLessThanOrEqual(10);
    }
  });

  it('a struggling player gets every bike, slower, and finishes the season on the top bike', () => {
    const runs = seasons(PLAYERS.struggling, 'suggested', 200);
    const rows = waits(runs);
    const lengths = runs.map((r) => r.races);
    print(
      `[examined] struggling player, suggested route, ${runs.length} seasons: ${describeWaits(rows)}; ` +
        `season ${median(lengths)} races`,
    );
    for (const w of rows) {
      expect(w.never, `${w.key} never bought`).toBeLessThanOrEqual(runs.length * 0.05);
      expect(median(w.waits), w.key).toBeLessThanOrEqual(15);
    }
    const onTop = runs.filter((r) => r.profile.bikes.current === LADDER.at(-1)?.key).length;
    expect(onTop).toBeGreaterThanOrEqual(runs.length * 0.95);
  });
});
