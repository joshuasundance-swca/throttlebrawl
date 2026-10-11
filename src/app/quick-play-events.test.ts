import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_RACE_OPTIONS } from '../save';
import { createRaceLog, eventPlan } from '../career';
import { createSim } from '../sim/api';
import { buildSimConfig, qualifyIn } from './config';
import {
  huntMinimum,
  quickPlayEvents,
  quickPlayEvent,
  quickPlaySetup,
  quickPlayObjective,
} from './quick-play-events';
import { createStreamCache, regionChoices } from './regions';

const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const garage = { owned: [], current: null };

describe('loaded Quick Play events and workable setups', () => {
  it('keeps future named Hunt targets and resolves every matched rival from the actual selected bike', () => {
    const region = regionChoices(reg).find((r) => quickPlayEvents(reg, r.id).some((e) => e.kind === 'hunt'))!;
    const choice = quickPlayEvent(reg, region.id, 'hunt')!;
    const event = reg.events[choice.eventId]!;
    const targets = (event.field.riders ?? []).slice(0, huntMinimum(reg, choice.eventId));
    expect(targets.length).toBeGreaterThan(0);
    const probe = {
      ...reg,
      events: { ...reg.events, [choice.eventId]: { ...event, rules: { ...event.rules, targets } } },
    };
    const setup = quickPlaySetup(
      probe,
      choice.eventId,
      { ...DEFAULT_RACE_OPTIONS, rivals: 0 },
      garage,
      'open',
      1,
      'normal',
      {},
    );
    const c = buildSimConfig(probe, streams.forEvent(probe, choice.eventId), {
      seed: 1,
      eventId: choice.eventId,
      ...setup,
    });
    for (const target of targets)
      expect(c.riders.map((r) => r.contentId)).toContain(qualifyIn(choice.eventId.split(':')[0]!, target));
    for (const target of targets)
      expect(quickPlayObjective(probe, choice.eventId)).toContain(
        reg.riders[qualifyIn(choice.eventId.split(':')[0]!, target)]?.name,
      );
    const bike =
      Object.keys(reg.bikes).find((id) => reg.bikes[id]?.class === 'dirt') ?? Object.keys(reg.bikes)[0]!;
    for (const region of regionChoices(reg))
      for (const event of quickPlayEvents(reg, region.id)) {
        const c = buildSimConfig(reg, streams.forEvent(reg, event.eventId), {
          seed: 4,
          eventId: event.eventId,
          ...quickPlaySetup(
            reg,
            event.eventId,
            { ...DEFAULT_RACE_OPTIONS, bike },
            garage,
            'matched',
            4,
            'normal',
            {},
          ),
        });
        const player = c.riders.find((r) => r.role === 'player')!;
        expect(player.bike.contentId).toBe(bike);
        for (const rival of c.riders.filter((r) => r.role === 'rival'))
          expect(rival.bike).toEqual(player.bike);
      }
  });
  it('judges actual carried Hunt objectives as met at the count and missed at a clean finish with no takedowns', () => {
    const region = regionChoices(reg).find((r) => quickPlayEvents(reg, r.id).some((e) => e.kind === 'hunt'))!;
    const choice = quickPlayEvent(reg, region.id, 'hunt')!;
    const c = buildSimConfig(reg, streams.forEvent(reg, choice.eventId), {
      seed: 1,
      eventId: choice.eventId,
      ...quickPlaySetup(reg, choice.eventId, DEFAULT_RACE_OPTIONS, garage, 'open', 1, 'normal', {}),
    });
    const snap = createSim(c).snapshot();
    const player = snap.entities[c.riders.findIndex((r) => r.role === 'player')]!;
    const victim = snap.entities.find(
      (e) => e.kind === 'rider' && e.faction !== 'law' && e.id !== player.id,
    )!;
    const plan = eventPlan(reg, choice.eventId);
    const make = () =>
      createRaceLog({
        playerId: player.id,
        rules: plan.rules,
        objectives: plan.objectives,
        routeId: c.event.routeId ?? '',
        roadIds: c.road.edges.map((e) => e.id),
      });
    const win = make();
    win.note([], snap);
    for (let n = 0; n < huntMinimum(reg, choice.eventId); n++)
      win.note([{ type: 'takedown', actor: player.id, target: victim.id, tick: n, data: {} }], snap);
    expect(win.status().state).toBe('won');
    expect(win.status().endNow).toBe(plan.rules.endOnCount === true);
    const miss = make();
    miss.note([], snap);
    miss.note([{ type: 'finish', actor: player.id, tick: 1, data: { place: 1 } }], snap);
    expect(miss.status().state).toBe('lost');
    expect(miss.status().objectives.find((o) => o.kind === 'takedowns')?.met).toBe(false);
  });
  it('offers existing families per region, chooses lowest-tier non-finales and falls back safely', () => {
    for (const region of regionChoices(reg)) {
      const offered = quickPlayEvents(reg, region.id);
      expect(offered.find((e) => e.kind === 'race')).toBeDefined();
      for (const choice of offered) {
        expect(reg.events[choice.eventId]?.finale).not.toBe(true);
        const candidates = Object.entries(reg.events).filter(
          ([id, e]) =>
            !e.finale &&
            e.kind === reg.events[choice.eventId]?.kind &&
            qualifyIn(id.split(':')[0]!, e.region) === region.id,
        );
        expect(reg.events[choice.eventId]?.tier ?? 0).toBe(
          Math.min(...candidates.map(([, e]) => e.tier ?? 0)),
        );
        expect(quickPlayEvent(reg, region.id, choice.kind)).toEqual(choice);
      }
      const stripped = {
        ...reg,
        events: Object.fromEntries(Object.entries(reg.events).filter(([, e]) => e.kind === 'classic-race')),
      };
      expect(quickPlayEvent(stripped, region.id, 'hunt')?.kind).toBe('race');
    }
  });

  it('config preserves hunt targets, the named grudge rival and active escape law despite conflicting picks', () => {
    for (const region of regionChoices(reg))
      for (const choice of quickPlayEvents(reg, region.id)) {
        for (const seed of [1, 2, 3, 4]) {
          const setup = quickPlaySetup(
            reg,
            choice.eventId,
            { ...DEFAULT_RACE_OPTIONS, rivals: 0, cops: false },
            garage,
            'open',
            seed,
            'easy',
            { 'difficulty.easy.copFrequency': 0 },
          );
          const c = buildSimConfig(reg, streams.forEvent(reg, choice.eventId), {
            seed,
            eventId: choice.eventId,
            ...setup,
          });
          const event = reg.events[choice.eventId]!;
          if (choice.kind === 'hunt')
            expect(c.riders.filter((r) => r.role === 'rival').length).toBeGreaterThanOrEqual(
              Number(event.rules?.['targetCount'] ?? 1),
            );
          if (choice.kind === 'grudge')
            expect(c.riders.map((r) => r.contentId)).toContain(
              qualifyIn(choice.eventId.split(':')[0]!, String(event.rules?.['rival'])),
            );
          if (choice.kind === 'escape') {
            expect(c.riders.some((r) => r.faction === 'law')).toBe(true);
            expect(c.event.cops?.mode).not.toBe('none');
            expect(c.difficulty.copFrequency).toBeGreaterThan(0);
          }
        }
      }
  });
});
