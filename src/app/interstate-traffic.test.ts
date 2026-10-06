// The interstate's traffic (playtest 4, P4-19, sheet I2; run C, C5): a road tagged `interstate` runs
// the semis an interstate has, in place of the byway's cyclists, hay trucks and espresso stands in
// tow. The checks read the real region pack through the game's own config builder, so a pack edit
// that breaks a rule fails here: the rule is "an interstate's big traffic is mostly semis, and the
// slow byway oddities stay off it", not a list of types.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { buildSimConfig, streamForEvent } from './config';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
/** The career event that races the I-5 route (the weigh-station cop escape). */
const EVENT = 'region-pnw:pnw-t4-weigh-station';
const AREA = 'interstate';
const config = () => buildSimConfig(ALL, streamForEvent(ALL, EVENT), { seed: 3, eventId: EVENT });

describe('the interstate traffic area', () => {
  it('exists, and its weights put semis ahead of every other big vehicle', () => {
    const types = config().trafficTypes;
    const inArea = types.filter((t) => (t.areaWeights?.[AREA] ?? 0) > 0);
    console.log(
      `[examined] ${inArea.length} types in the ${AREA} area: ${inArea.map((t) => t.contentId).join(', ')}`,
    );
    expect(inArea.length).toBeGreaterThanOrEqual(4);
    const semi = inArea.find((t) => t.contentId === 'region-pnw:semi');
    expect(semi, 'a semi type is in the area').toBeDefined();
    const big = inArea.filter((t) => t.hazard === 'big');
    const others = big.filter((t) => t.contentId !== 'region-pnw:semi');
    for (const t of others)
      expect(semi?.areaWeights?.[AREA] ?? 0, `semi outweighs ${t.contentId}`).toBeGreaterThan(
        t.areaWeights?.[AREA] ?? 0,
      );
    // Most of the area's weight is cars: an interstate is not a convoy of trucks.
    const total = inArea.reduce((n, t) => n + (t.areaWeights?.[AREA] ?? 0), 0);
    const semiShare = (semi?.areaWeights?.[AREA] ?? 0) / total;
    expect(semiShare).toBeGreaterThan(0.1);
    expect(semiShare).toBeLessThan(0.4);
  });

  it('keeps the byway oddities and the cyclists off it', () => {
    const slow = new Set([
      'espresso-stand-in-tow',
      'rain-cape-cyclist',
      'pnw-hay-truck',
      'pnw-logging-float',
    ]);
    const found = config().trafficTypes.filter((t) => slow.has(t.contentId.replace('region-pnw:', '')));
    // The control: the race does carry some of them (on the byway), so a zero here is a real zero.
    expect(found.length, 'the race carries byway oddities').toBeGreaterThan(0);
    for (const t of found) expect(t.areaWeights?.[AREA] ?? 0, t.contentId).toBe(0);
  });

  it('is no bigger than the largest vehicle the region already has, so no rival rides round a car differently', () => {
    const c = config();
    const semi = c.trafficTypes.find((t) => t.contentId === 'region-pnw:semi');
    expect(semi?.hazard).toBe('big');
    // The rival AI sizes every vehicle by the largest traffic type of the race (`vehicleSize`, sim/ai/sense.ts).
    const largest = (types: typeof c.trafficTypes) =>
      types
        .filter((t) => t.category !== 'pedestrian' && t.category !== 'animal')
        .reduce((m, t) => ({ l: Math.max(m.l, t.lengthM), w: Math.max(m.w, t.widthM) }), { l: 0, w: 0 });
    const without = c.trafficTypes.filter((t) => t.contentId !== 'region-pnw:semi');
    expect(largest(c.trafficTypes)).toEqual(largest(without));
    expect(largest(without).l, 'the control: the region has longer trucks than cars').toBeGreaterThan(10);
  });
});
