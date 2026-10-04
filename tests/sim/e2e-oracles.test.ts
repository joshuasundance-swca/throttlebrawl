import { describe, expect, it } from 'vitest';
import { realRoutes } from '../../src/app/config';
import { regionChoices, routeChoices } from '../../src/app/regions';
import { careerDefs, careerMap, careerView, garageBikes, startCareer } from '../../src/career';
import { registryFromGlob } from '../../src/content';
import { DEFAULT_PROFILE } from '../../src/save';
import { careerPicks, menuRegions, offeredRoutes } from '../e2e/packs-on-disk';

// The browser specs read what they expect from the packs on disk (tests/e2e/packs-on-disk.ts), so a
// new route or region needs no spec edit (docs/engineering.md, "Assert the rule, not today's
// content"). Those readers restate the game's rules from plain JSON; this keeps each restatement
// equal to the game's own function over the same packs, so a spec and the game cannot drift apart
// unseen, and a rule change shows up here, in seconds, before the browser tier.

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));

describe('e2e oracles: the packs on disk, read as the game reads them', () => {
  it("lists the menu's regions in the menu's order, each with the event a pick races", () => {
    const disk = menuRegions().map(({ region, event }) => ({ id: region.key, eventId: event.key }));
    const game = regionChoices(ALL).map(({ id, eventId }) => ({ id, eventId }));
    console.log(`[print] regions examined: ${disk.length}`);
    expect(disk.length).toBeGreaterThan(1);
    expect(disk).toEqual(game);
  });

  it("offers each region's routes as the route picker does: ids in order and names", () => {
    let examined = 0;
    for (const { event } of menuRegions()) {
      const offered = offeredRoutes(event);
      expect(
        offered.map((r) => r.key),
        event.key,
      ).toEqual(realRoutes(ALL, event.key));
      expect(
        [event.name ?? event.id, ...offered.map((r) => r.name ?? r.key.slice(r.key.indexOf(':') + 1))],
        event.key,
      ).toEqual(routeChoices(ALL, event.key).map((c) => c.name));
      examined += offered.length;
    }
    console.log(`[print] offered routes examined: ${examined}`);
    expect(examined).toBeGreaterThan(0);
  });

  it("the career spec's picks are what the career screens show", () => {
    const picks = careerPicks();
    const defs = careerDefs(ALL);
    const fresh = startCareer(defs, { ...DEFAULT_PROFILE });
    expect(defs.map((d) => d.regionKey)).toEqual(picks.careers.map((c) => c.region));
    const [first, next] = defs;
    if (!first || !next) throw new Error('fewer than two careers');
    expect(first.tutorialNode).toBe(picks.opening.id);
    expect(fresh.cash).toBe(picks.first.startingCash);
    const cards = careerView(ALL, defs, fresh, first.regionId).tiers.flatMap((t) => t.nodes);
    const card = (id: string) => cards.find((c) => c.id === id);
    expect(card(picks.opening.id)?.state).toBe('open');
    expect(card(picks.opening.id)?.objective).toMatch(/Finish (the race|in the top \d+)\./);
    expect(card(picks.waiting.id)).toMatchObject({
      state: 'locked',
      reason: `Win ${picks.openingEvent.name} first.`,
    });
    const bikes = garageBikes(ALL, defs, fresh);
    expect(bikes.find((b) => b.current)?.name).toBe(picks.startingBikeName);
    expect(bikes.find((b) => b.key === `${picks.first.pack}:${picks.laterBike.bike}`)?.state).toBe('locked');
    expect(careerMap(ALL, next, fresh).map((p) => p.name)).toContain(picks.nextPanel);
    console.log(
      `[print] career picks: ${picks.opening.id}, ${picks.waiting.id}, paint ${picks.paint.id}, ` +
        `bike ${picks.laterBike.bike}, ${next.regionId} panel "${picks.nextPanel}"`,
    );
  });
});
