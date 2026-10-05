// Playtest 4 (P4-12, P4-13): the menu race's options feed buildSimConfig, so they land in the
// replay header with everything else that changes the race. Each rule is checked on every carried
// region (every pack, the way the game loads them), never on a lucky seed or a copied field list.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { createSim } from '../sim/api';
import { DEFAULT_RACE_OPTIONS, MAX_RACE_RIVALS, RACE_TRAFFIC, type RaceOptions } from '../save';
import { buildSimConfig, raceField, raceTimeOfDay, realRoutes, type RaceSetup } from './config';
import { menuBikes, menuRaceSetup, raceOptionsView, TRAFFIC_SCALE } from './race-options';
import { createStreamCache, regionChoices } from './regions';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const EVENTS = regionChoices(ALL).map((r) => r.eventId);
const DENSITY = 'traffic.density';

const config = (eventId: string, setup: Omit<RaceSetup, 'eventId'>, route?: string) =>
  buildSimConfig(ALL, streams.forEvent(ALL, eventId, undefined, route), {
    eventId,
    ...(route ? { route } : {}),
    ...setup,
  });
const rivalsOf = (c: ReturnType<typeof config>) => c.riders.filter((r) => r.role === 'rival');
const lawOf = (c: ReturnType<typeof config>) => c.riders.filter((r) => r.faction === 'law');
const timesOf = (eventId: string) => {
  const event = ALL.events[eventId];
  const pack = eventId.split(':')[0] ?? 'base';
  const region = ALL.regions[event?.region.includes(':') ? event.region : `${pack}:${event?.region}`];
  return (region?.timeOfDayOptions ?? []).map((o) => o.id);
};

describe('P4-12: the menu race options reach the race config', () => {
  it('covers every carried region', () => {
    console.log(`[examined] events ${EVENTS.join(', ')}`);
    expect(EVENTS.length).toBeGreaterThan(1);
  });

  it('a chosen time of day is the race’s light in free play, whatever the seed; one the region lacks is the draw', () => {
    for (const eventId of EVENTS) {
      const times = timesOf(eventId);
      expect(times.length, eventId).toBeGreaterThan(0);
      for (const time of times)
        for (const seed of SEEDS) expect(raceTimeOfDay(ALL, eventId, seed, true, undefined, time)).toBe(time);
      for (const seed of SEEDS) {
        expect(raceTimeOfDay(ALL, eventId, seed, true, undefined, 'not-a-time')).toBe(
          raceTimeOfDay(ALL, eventId, seed, true),
        );
        // A career race keeps its event's own light.
        expect(raceTimeOfDay(ALL, eventId, seed, false, undefined, times[0])).toBe(
          raceTimeOfDay(ALL, eventId, seed, false),
        );
      }
    }
  });

  it('the chosen light picks the road events as the drawn one does (they are eligible by time of day)', () => {
    // No carried road event is limited by the light today, so each region gets a probe that is: a copy
    // of one of its modifiers, eligible only at its first light.
    const anyModifier = Object.values(ALL.modifiers)[0];
    expect(anyModifier, 'a modifier to copy').toBeDefined();
    let probed = 0;
    for (const eventId of EVENTS) {
      const times = timesOf(eventId);
      const [only, other] = times;
      if (!anyModifier || !only || !other) continue;
      const probe = `${eventId.split(':')[0]}:probe-${only}`;
      const reg = {
        ...ALL,
        modifiers: {
          ...ALL.modifiers,
          [probe]: { ...anyModifier, id: probe.split(':')[1] ?? '', eligibility: { timeOfDay: [only] } },
        },
      } as typeof ALL;
      const mods = (time: string | undefined, seed: number) =>
        buildSimConfig(reg, streams.forEvent(reg, eventId), {
          eventId,
          seed,
          freePlay: true,
          ...(time ? { timeOfDay: time } : {}),
        }).modifiers.map((m) => m.contentId);
      for (const seed of SEEDS.slice(0, 8)) {
        expect(mods(only, seed), `${eventId} chosen ${only}`).toContain(probe);
        expect(mods(other, seed), `${eventId} chosen ${other}`).not.toContain(probe);
      }
      // The same road events as a seed that draws that light by itself.
      for (const time of times) {
        const drawn = SEEDS.find((s) => raceTimeOfDay(reg, eventId, s, true) === time);
        if (drawn !== undefined)
          expect(mods(time, 7), `${eventId} at ${time}`).toEqual(mods(undefined, drawn));
      }
      probed++;
    }
    console.log(`[examined] ${probed} of ${EVENTS.length} regions probed with a light-only road event`);
    expect(probed).toBeGreaterThan(0);
  });

  it('a rival count fields that many distinct rivals from the region’s cast, the same for the same seed', () => {
    for (const eventId of EVENTS) {
      const usual = rivalsOf(config(eventId, { seed: 3, freePlay: true })).length;
      for (let n = 0; n <= MAX_RACE_RIVALS; n++) {
        for (const seed of SEEDS.slice(0, 6)) {
          const field = raceField(ALL, eventId, seed, true, undefined, n);
          expect(new Set(field).size, `${eventId} n=${n}`).toBe(field.length);
          expect(field.length).toBeLessThanOrEqual(n);
          const ids = rivalsOf(config(eventId, { seed, freePlay: true, rivals: n })).map((r) => r.contentId);
          expect(ids).toEqual(field);
          expect(ids).toEqual(
            rivalsOf(config(eventId, { seed, freePlay: true, rivals: n })).map((r) => r.contentId),
          );
        }
      }
      // The usual count is the event's own: no rivals option, no change.
      expect(raceField(ALL, eventId, 3, true, undefined, usual)).toEqual(raceField(ALL, eventId, 3, true));
      // Up to the cast's size: as many as asked, while the cast has them.
      const cast = raceField(ALL, eventId, 3, true, undefined, 99).length;
      expect(cast).toBeGreaterThanOrEqual(usual);
      for (let n = 0; n <= Math.min(cast, MAX_RACE_RIVALS); n++)
        expect(raceField(ALL, eventId, 3, true, undefined, n)).toHaveLength(n);
      // A career race keeps its event's own field.
      expect(raceField(ALL, eventId, 3, false, undefined, 0)).toEqual(raceField(ALL, eventId, 3, false));
    }
  });

  it('cops off fields no law at all; on (or left out) is the event’s law, unchanged', () => {
    let withLaw = 0;
    for (const eventId of EVENTS) {
      const usual = config(eventId, { seed: 5, freePlay: true });
      if (lawOf(usual).length > 0) withLaw++;
      expect(config(eventId, { seed: 5, freePlay: true, cops: true })).toEqual(usual);
      const off = config(eventId, { seed: 5, freePlay: true, cops: false });
      expect(lawOf(off), eventId).toEqual([]);
      expect(off.event.cops?.mode).toBe('none');
      expect(off.event.cops?.heat ?? false).toBe(false);
      expect(off.event.cops?.patrolMax ?? 0).toBe(0);
      // Nothing else about the field moves.
      expect(off.riders.filter((r) => r.faction !== 'law')).toEqual(
        usual.riders.filter((r) => r.faction !== 'law'),
      );
    }
    expect(withLaw, 'some region fields law by default, so the rule is tested').toBeGreaterThan(0);
  });

  it('cops off: a race runs with no law rider out and no heat', () => {
    const eventId = EVENTS.find((e) => lawOf(config(e, { seed: 5, freePlay: true })).length > 0) ?? '';
    const run = (cops: boolean) => {
      const sim = createSim(config(eventId, { seed: 5, freePlay: true, cops }));
      let law = 0;
      let heat = 0;
      for (let t = 0; t < 1200; t++) {
        sim.step([{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
        const s = sim.snapshot();
        law += s.entities.filter((e) => e.kind === 'rider' && e.faction === 'law').length;
        heat = Math.max(heat, s.law?.heat ?? 0);
      }
      return { law, heat };
    };
    const off = run(false);
    const on = run(true);
    console.log(
      `[examined] ${eventId}, 1200 ticks full throttle: cops off ${off.law} law sightings (peak heat ${off.heat}), cops on ${on.law}`,
    );
    // The same count sees the law when it rides, so a zero means none.
    expect(on.law).toBeGreaterThan(0);
    expect(off.law).toBe(0);
    expect(off.heat).toBe(0);
  });

  it('the traffic scale multiplies the traffic.density slider, inside its 0 to 3', () => {
    const eventId = EVENTS[0] ?? '';
    const base = config(eventId, { seed: 1 }).tuning[DENSITY] ?? 1;
    expect(config(eventId, { seed: 1, trafficScale: 0 }).tuning[DENSITY]).toBe(0);
    expect(config(eventId, { seed: 1, trafficScale: 0.5 }).tuning[DENSITY]).toBeCloseTo(base * 0.5, 6);
    expect(config(eventId, { seed: 1, trafficScale: 1 }).tuning).toEqual(config(eventId, { seed: 1 }).tuning);
    const panel = { seed: 1, tuning: { [DENSITY]: 2.5 }, trafficScale: 2 };
    expect(config(eventId, panel).tuning[DENSITY]).toBe(3);
    // Nothing but the density moves.
    const scaled = { ...config(eventId, { seed: 1, trafficScale: 0.5 }).tuning, [DENSITY]: base };
    expect(scaled).toEqual(config(eventId, { seed: 1 }).tuning);
  });

  it('every rider of the largest field starts on the road, on every region’s roads', () => {
    let checked = 0;
    for (const eventId of EVENTS) {
      for (const route of [undefined, ...realRoutes(ALL, eventId)]) {
        const c = config(eventId, { seed: 2, freePlay: true, rivals: MAX_RACE_RIVALS }, route);
        const snap = createSim(c).snapshot();
        // No two riders share a grid spot (a grid run off the road's start would stack them).
        const riders = snap.entities.filter((e) => e.kind === 'rider');
        for (const [i, a] of riders.entries())
          for (const b of riders.slice(i + 1))
            expect(
              Math.hypot(a.x - b.x, a.z - b.z),
              `${eventId} ${route ?? ''}: ${a.contentId} and ${b.contentId}`,
            ).toBeGreaterThan(1);
        for (const e of snap.entities) {
          if (e.kind !== 'rider') continue;
          const edge = c.road.edges[e.road.edge];
          const at = `${eventId} ${route ?? '(own road)'}: ${e.contentId}`;
          expect(edge, at).toBeDefined();
          expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z), at).toBe(true);
          expect(e.road.s, at).toBeGreaterThanOrEqual(0);
          expect(e.road.s, at).toBeLessThanOrEqual(edge?.length ?? 0);
          checked++;
        }
      }
    }
    console.log(`[examined] ${checked} riders on the grid at ${MAX_RACE_RIVALS} rivals`);
    expect(checked).toBeGreaterThan(EVENTS.length * MAX_RACE_RIVALS);
  });
});

describe('P4-12, P4-13: the menu race options, from the record to the race', () => {
  const garage = { owned: [] as string[], current: null as string | null };
  const opts = (o: Partial<RaceOptions>): RaceOptions => ({ ...DEFAULT_RACE_OPTIONS, ...o });

  it('the defaults change nothing: the race as it was, the garage bike riding', () => {
    expect(menuRaceSetup(ALL, DEFAULT_RACE_OPTIONS, garage)).toEqual({});
    expect(
      menuRaceSetup(ALL, DEFAULT_RACE_OPTIONS, { owned: ['base:sport-600'], current: 'base:sport-600' }),
    ).toEqual({
      playerBike: 'base:sport-600',
    });
  });

  it('a picked bike rides without the garage, and the field and the light are what was picked', () => {
    const eventId = EVENTS[0] ?? '';
    for (const bike of menuBikes(ALL, [])) {
      const setup = menuRaceSetup(
        ALL,
        opts({ bike, timeOfDay: timesOf(eventId)[0] ?? null, rivals: 2 }),
        garage,
      );
      const c = config(eventId, { seed: 4, freePlay: true, ...setup });
      expect(c.riders.find((r) => r.role === 'player')?.bike.contentId).toBe(bike);
      expect(rivalsOf(c)).toHaveLength(2);
    }
  });

  it('offers every bike but the secret joke rides, which join once the garage owns one; slowest first', () => {
    const all = Object.keys(ALL.bikes);
    const secret = all.filter((id) => (ALL.bikes[id]?.tags ?? []).includes('secret'));
    console.log(`[examined] ${all.length} bikes, secret ${secret.join(', ')}`);
    expect(secret.length, 'the joke rides are tagged secret').toBeGreaterThan(0);
    const offered = menuBikes(ALL, []);
    expect([...offered].sort()).toEqual(all.filter((id) => !secret.includes(id)).sort());
    const owned = secret[0] ?? '';
    expect(menuBikes(ALL, [owned])).toContain(owned);
    const speeds = offered.map((id) => ALL.bikes[id]?.handling.topSpeedMps ?? 0);
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
    // A secret bike the garage does not own is never ridden, whatever the record says.
    expect(menuRaceSetup(ALL, opts({ bike: owned }), garage).playerBike).toBeUndefined();
    expect(menuRaceSetup(ALL, opts({ bike: 'base:no-such-bike' }), garage).playerBike).toBeUndefined();
  });

  it('cops off, a rival count, a light and the traffic each reach the setup; usual traffic is no scale', () => {
    expect(menuRaceSetup(ALL, opts({ cops: false }), garage)).toEqual({ cops: false });
    expect(menuRaceSetup(ALL, opts({ rivals: 0 }), garage)).toEqual({ rivals: 0 });
    expect(menuRaceSetup(ALL, opts({ timeOfDay: 'dusk' }), garage)).toEqual({ timeOfDay: 'dusk' });
    for (const traffic of RACE_TRAFFIC) {
      const setup = menuRaceSetup(ALL, opts({ traffic }), garage);
      if (traffic === 'usual') expect(setup).toEqual({});
      else expect(setup).toEqual({ trafficScale: TRAFFIC_SCALE[traffic] });
    }
    // The scales climb: none, light, usual, heavy.
    const scales = RACE_TRAFFIC.map((t) => TRAFFIC_SCALE[t]);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(TRAFFIC_SCALE.none).toBe(0);
  });

  it('the screen offers what the region can field: its lights, its cast’s counts, its lengths and the bikes', () => {
    for (const eventId of EVENTS) {
      const v = raceOptionsView(ALL, eventId, null, garage, 'mph');
      const usual = raceField(ALL, eventId, 1, false).length;
      const cast = raceField(ALL, eventId, 1, true, undefined, 99).length;
      expect(v.where.length).toBeGreaterThan(0);
      expect(v.times.map((t) => t.value)).toEqual([null, ...timesOf(eventId)]);
      expect(v.rivals[0]?.value).toBeNull();
      expect(v.rivals[0]?.note).toContain(String(usual));
      const counts = v.rivals.slice(1).map((r) => r.value);
      expect(counts).toEqual(Array.from({ length: Math.min(cast, MAX_RACE_RIVALS) + 1 }, (_, i) => i));
      const event = ALL.events[eventId];
      expect(v.lengths.map((l) => l.value)).toEqual(event?.lengths.map((l) => l.id));
      expect(v.bikes[0]?.value).toBeNull();
      expect(v.bikes.slice(1).map((b) => b.value)).toEqual(menuBikes(ALL, []));
      for (const b of v.bikes.slice(1)) expect(b.note).toMatch(/^\d+ mph$/);
      // A picked real road sets the length itself.
      const road = realRoutes(ALL, eventId)[0];
      if (road) expect(raceOptionsView(ALL, eventId, road, garage, 'mph').lengths).toEqual([]);
    }
  });
});
