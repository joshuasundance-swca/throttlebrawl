import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_RACE_OPTIONS } from '../save';
import { buildSimConfig } from './config';
import { menuBikes, menuRaceSetup } from './race-options';
import { createStreamCache, regionChoices } from './regions';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const garage = { owned: [] as string[], current: null };
const bikes = menuBikes(registry, garage.owned);
const slow = bikes[0] ?? '';

describe('Quick Play matched opposition', () => {
  it('lets a slow bike compete on every region with actual matching bikes and a reachable pace', () => {
    expect(registry.bikes[slow]).toBeDefined();
    for (const region of regionChoices(registry)) {
      const setup = menuRaceSetup(registry, { ...DEFAULT_RACE_OPTIONS, bike: slow }, garage, 'matched');
      const config = buildSimConfig(registry, streams.forEvent(registry, region.eventId), {
        seed: 3,
        eventId: region.eventId,
        freePlay: true,
        ...setup,
      });
      const player = config.riders.find((r) => r.role === 'player');
      const rivals = config.riders.filter((r) => r.role === 'rival');
      expect(rivals.length, region.id).toBeGreaterThan(0);
      for (const rival of rivals) {
        expect(rival.bike.contentId, region.id).toBe(player?.bike.contentId);
        expect(rival.bike.topSpeedMps, region.id).toBe(player?.bike.topSpeedMps);
      }
      expect(config.event.paceMps).toBeLessThanOrEqual(player?.bike.topSpeedMps ?? 0);
      expect(config.event.paceMps).toBeGreaterThan((player?.bike.topSpeedMps ?? 0) * 0.5);
      // Config is what the replay header records: the chosen bike must resolve across pack boundaries.
      expect(player?.bike.contentId).toBe(slow);
    }
  });

  it('keeps open underdog runs and the existing default byte-identical', () => {
    const options = { ...DEFAULT_RACE_OPTIONS, bike: slow };
    const usual = menuRaceSetup(registry, options, garage);
    expect(menuRaceSetup(registry, options, garage, 'open')).toEqual(usual);
    expect(usual.fieldLevel).toBeUndefined();
    const region = regionChoices(registry).find((r) => r.chapter > 1);
    expect(region).toBeDefined();
    if (!region) return;
    const config = buildSimConfig(registry, streams.forEvent(registry, region.eventId), {
      seed: 3,
      eventId: region.eventId,
      freePlay: true,
      ...usual,
    });
    const player = config.riders.find((r) => r.role === 'player');
    expect(
      config.riders.some(
        (r) => r.role === 'rival' && r.bike.topSpeedMps > (player?.bike.topSpeedMps ?? Infinity),
      ),
    ).toBe(true);
  });

  it('uses the actual default player bike when neither a menu choice nor garage bike is valid', () => {
    const options = { ...DEFAULT_RACE_OPTIONS, bike: 'missing:bike' };
    const matched = menuRaceSetup(registry, options, { owned: [], current: 'missing:garage' }, 'matched');
    const region = regionChoices(registry)[0];
    expect(region).toBeDefined();
    if (!region) return;
    const config = buildSimConfig(registry, streams.forEvent(registry, region.eventId), {
      seed: 3,
      eventId: region.eventId,
      freePlay: true,
      ...matched,
    });
    const player = config.riders.find((r) => r.role === 'player');
    expect(
      config.riders
        .filter((r) => r.role === 'rival')
        .every((r) => r.bike.contentId === player?.bike.contentId),
    ).toBe(true);
  });
});
