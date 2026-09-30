// narrative-2's seeded-race check (docs/milestones/M2.md, narrative-2, "Automated acceptance":
// "a vetoed line never shows again in a seeded race"). One real seeded race (the bot in the player
// slot, the full field and traffic) is recorded once; the base pack's real bark sets then ride its
// events through the director with a view that only records. The most-heard line is cut and the
// same race is ridden again: the cut line never shows, and the rivals still talk.
//
// It also prints which triggers the real race fed, so a trigger the sim never fires shows up as a
// missing key here rather than as silence on the phone.
import { describe, expect, it } from 'vitest';
import { loadBasePack } from '../../src/content';
import type { SimEvent, SimSnapshot } from '../../src/sim/api';
import { createBarkDirector, type ShownBark } from '../../src/ui/narrative/director';
import { barkLinesFrom, createBarkSelector } from '../../src/ui/narrative/selector';
import { runSeededRace } from './batch';

const print = (line: string) => process.stdout.write(`${line}\n`);
const SEED = 11;

interface Tick {
  snapshot: SimSnapshot;
  events: readonly SimEvent[];
}

/** One real race, kept as the ticks that had events (a director needs nothing else). */
function record(seed: number): Tick[] {
  const ticks: Tick[] = [];
  runSeededRace(seed, {
    noReplay: true,
    onTick: (snapshot, events) => {
      if (events.length) ticks.push({ snapshot, events: [...events] });
    },
  });
  return ticks;
}

function ride(ticks: readonly Tick[], seed: number, vetoed: readonly string[] = []): ShownBark[] {
  const lines = barkLinesFrom(loadBasePack().barkSets);
  const selector = createBarkSelector(lines, undefined, 0, { vetoed });
  const shown: ShownBark[] = [];
  const director = createBarkDirector(selector, { show: (b) => shown.push(b), hide: () => {} });
  for (const t of ticks) director.onEvents(t.events, { snapshot: t.snapshot, seed });
  return shown;
}

describe('narrative-2 in a seeded race', () => {
  it('never shows a cut line again, and the race still has barks', () => {
    const lines = barkLinesFrom(loadBasePack().barkSets);
    const ticks = record(SEED);
    const before = ride(ticks, SEED);
    expect(before.length).toBeGreaterThan(0);
    // Same seed, same bubbles: the presentation stream is seeded from the race seed.
    expect(ride(ticks, SEED).map((b) => b.contentRef)).toEqual(before.map((b) => b.contentRef));

    const counts = new Map<string, number>();
    const byTrigger = new Map<string, number>();
    for (const b of before) {
      counts.set(b.contentRef, (counts.get(b.contentRef) ?? 0) + 1);
      const t = lines.find((l) => l.ref === b.contentRef)?.trigger ?? '?';
      byTrigger.set(t, (byTrigger.get(t) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const cut = ranked[0]?.[0] ?? '';
    const after = ride(ticks, SEED, [cut]);
    const cutShown = after.filter((b) => b.contentRef === cut).length;
    print(
      `seed ${SEED}: ${ticks.length} ticks with events, ${before.length} barks by trigger ` +
        `${JSON.stringify(Object.fromEntries(byTrigger))}; cut ${cut} (shown ${counts.get(cut)}x before) -> ` +
        `${after.length} barks, the cut line ${cutShown}x`,
    );
    expect(cutShown).toBe(0);
    expect(after.length).toBeGreaterThan(0);

    // Cut every line the race showed: none of them comes back.
    const afterAll = ride(ticks, SEED, [...counts.keys()]);
    print(
      `cut all ${counts.size} lines shown -> ${afterAll.length} barks, ${afterAll.filter((b) => counts.has(b.contentRef)).length} of them cut`,
    );
    expect(afterAll.filter((b) => counts.has(b.contentRef))).toEqual([]);
  });
});
