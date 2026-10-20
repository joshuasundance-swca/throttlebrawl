import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_RACE_OPTIONS } from '../save';
import { firstSeed } from '../../tests/sim/batch';
import { buildSimConfig, raceField } from './config';
import { quickPlaySetup } from './quick-play-events';
import { createStreamCache, regionKeyOf, routeChoices } from './regions';

const all = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const eventId = 'region-clinton:clinton-ia136-race';
const localId = 'region-clinton:mara-vale';
const streams = createStreamCache();

describe('Iowa local rival', () => {
  it('fields a local non-cop on each Iowa route choice without changing the race terms', () => {
    const event = all.events[eventId]!;
    const rider = all.riders[localId];
    expect(rider).toMatchObject({ role: 'rival', roster: 'local', region: event.region });
    expect(event.field.riders).toContain('mara-vale');

    const choices = routeChoices(all, eventId);
    expect(choices.length).toBeGreaterThan(1);
    for (const choice of choices) {
      const config = buildSimConfig(all, streams.forEvent(all, eventId, undefined, choice.id), {
        eventId,
        seed: 1,
        ...(choice.id ? { route: choice.id } : {}),
      });
      expect(config.riders.filter((r) => r.controller.kind === 'ai').map((r) => r.contentId)).toContain(
        localId,
      );
      expect(config.riders.filter((r) => r.controller.kind === 'ai')).toHaveLength(
        event.field.riders!.length,
      );
      const mara = config.riders.find((r) => r.contentId === localId);
      expect(mara?.controller).toMatchObject({
        kind: 'ai',
        style: rider!.personality?.style,
        personality: {
          weave: rider!.personality?.weave,
          aggression: rider!.personality?.aggression,
          riskTaking: rider!.personality?.riskTaking,
        },
      });
      expect(config.event.paceMps).toBe(event.field.paceMps);
      expect(config.event.byPlaceCash).toEqual(event.rewards.byPlaceCash);
      expect(config.riders.some((r) => r.controller.kind === 'cop')).toBe(true);
    }
    const fullCastCount = Object.keys(all.riders).length;
    for (const other of Object.keys(all.events).filter(
      (id) => regionKeyOf(all, id) !== regionKeyOf(all, eventId),
    )) {
      expect(raceField(all, other, 1, true, undefined, fullCastCount)).not.toContain(localId);
    }
    expect(raceField(all, eventId, 1, true, undefined, fullCastCount)).toContain(localId);

    // Quick Play draws the usual-sized field from the whole local cast, so this rider is eligible
    // on either route without claiming that every seed includes her.
    const picked = firstSeed(
      'Iowa local in Quick Play',
      Array.from({ length: 16 }, (_, index) => index + 1),
      (seed) => raceField(all, eventId, seed, true),
      (field) => field.includes(localId),
    );
    expect(picked.seed).not.toBeNull();
    for (const choice of choices) {
      const seed = picked.seed!;
      const setup = quickPlaySetup(
        all,
        eventId,
        DEFAULT_RACE_OPTIONS,
        { owned: ['base:rustbucket-400'], current: 'base:rustbucket-400' },
        'open',
        seed,
        'normal',
        {},
      );
      expect(setup.freePlay).toBe(true);
      const config = buildSimConfig(all, streams.forEvent(all, eventId, undefined, choice.id), {
        eventId,
        seed,
        ...setup,
        ...(choice.id ? { route: choice.id } : {}),
      });
      expect(config.riders.map((r) => r.contentId)).toContain(localId);
    }
  });
});
