import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { bikeComparison } from './bike-comparison';
import { careerDefs, startCareer } from '../career';
import { DEFAULT_PROFILE } from '../save';
import { garageView } from './career-flow';
import { raceOptionsView } from './race-options';
import { regionChoices } from './regions';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const entries = Object.entries(ALL.bikes);
const pair = entries.flatMap(([a, bike]) =>
  entries.flatMap(([b, other]) =>
    bike.handling.accelMps2 > other.handling.accelMps2 &&
    bike.handling.brakeMps2 > other.handling.brakeMps2 &&
    bike.handling.steerRateMps > other.handling.steerRateMps
      ? [[a, b] as const]
      : [],
  ),
)[0];
if (!pair) throw new Error('Carried bikes must provide a launch/brake/steering comparison control');
const [quicker, slower] = pair;

describe('bike choice comparison', () => {
  it('names the current bike and explains all three authored differences in both directions', () => {
    expect(bikeComparison(ALL, quicker, slower)).toBe(
      `Compared with ${ALL.bikes[slower]?.name}: quicker launch · stronger brakes · quicker steering.`,
    );
    expect(bikeComparison(ALL, slower, quicker)).toBe(
      `Compared with ${ALL.bikes[quicker]?.name}: slower launch · softer brakes · slower steering.`,
    );
  });
  it('equal handling is described as equal, rather than an upgrade', () => {
    const source = ALL.bikes[quicker];
    if (!source) throw new Error('Missing comparison control');
    const reg = { ...ALL, bikes: { ...ALL.bikes, 'probe:equal': { ...source, name: 'Equal control' } } };
    expect(bikeComparison(reg, 'probe:equal', quicker)).toBe(
      `Compared with ${source.name}: same launch · same brakes · same steering.`,
    );
  });
  it('omits a comparison for the ridden bike or an unavailable baseline or candidate', () => {
    expect(bikeComparison(ALL, quicker, quicker)).toBeUndefined();
    expect(bikeComparison(ALL, quicker, null)).toBeUndefined();
    expect(bikeComparison(ALL, quicker, 'missing:bike')).toBeUndefined();
    expect(bikeComparison(ALL, 'missing:bike', quicker)).toBeUndefined();
  });
  it('omits nonfinite handling rather than inventing an equality', () => {
    const source = ALL.bikes[quicker];
    if (!source) throw new Error('Missing comparison control');
    const reg = {
      ...ALL,
      bikes: {
        ...ALL.bikes,
        [quicker]: {
          ...source,
          handling: { ...source.handling, brakeMps2: NaN },
        },
      },
    };
    expect(bikeComparison(reg, quicker, slower)).toBeUndefined();
    expect(bikeComparison(reg, slower, quicker)).toBeUndefined();
  });
  it('garage and Quick Play use the ridden bike as baseline, and update when it changes', () => {
    const defs = careerDefs(ALL);
    const initial = startCareer(defs, DEFAULT_PROFILE);
    const event = regionChoices(ALL)[0]?.eventId;
    if (!event) throw new Error('Missing menu event');
    for (const current of [quicker, slower]) {
      const profile = { ...initial, bikes: { ...initial.bikes, current, owned: [quicker, slower] } };
      const garage = garageView(ALL, defs, profile, 'mph');
      const options = raceOptionsView(ALL, event, null, profile.bikes, 'mph');
      const candidate = current === quicker ? slower : quicker;
      expect(garage.bikes.find((b) => b.key === candidate)?.handlingNote).toBe(
        bikeComparison(ALL, candidate, current),
      );
      expect(options.bikes.find((b) => b.value === candidate)?.note).toContain(
        bikeComparison(ALL, candidate, current),
      );
      expect(garage.bikes.find((b) => b.key === current)?.handlingNote).toBeUndefined();
      expect(options.bikes.find((b) => b.value === current)?.note).toMatch(/^\d+ mph$/);
    }
  });
});
