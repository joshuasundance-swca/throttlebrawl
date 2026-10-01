import { describe, expect, it } from 'vitest';
import { loadBasePack } from '../content';
import {
  bareRegionId,
  cleanRegions,
  DEFAULT_REGION,
  pickRegion,
  sameRegion,
  type RegionOption,
} from './regions';

const keys: RegionOption = { id: 'base:florida-keys', name: 'The Keys' };
const sf: RegionOption = { id: 'sf:san-francisco', name: 'San Francisco' };
const pnw: RegionOption = { id: 'pnw:pacific-northwest', name: 'Pacific Northwest' };

describe('region picker rules', () => {
  it('defaults to the Keys wherever it sits in the list, qualified or not', () => {
    expect(pickRegion([sf, pnw, keys])).toBe('base:florida-keys');
    expect(pickRegion([sf, { id: 'florida-keys', name: 'The Keys' }])).toBe('florida-keys');
  });

  it('keeps a wanted region that is in the list, by its own spelling', () => {
    expect(pickRegion([keys, sf, pnw], 'sf:san-francisco')).toBe('sf:san-francisco');
    expect(pickRegion([keys, sf, pnw], 'pacific-northwest')).toBe('pnw:pacific-northwest');
  });

  it('falls back to the Keys for an unknown wish, then to the first region, then to null', () => {
    expect(pickRegion([sf, keys], 'atlantis')).toBe('base:florida-keys');
    expect(pickRegion([pnw, sf], 'atlantis')).toBe('pnw:pacific-northwest');
    expect(pickRegion([])).toBeNull();
  });

  it('compares ids with or without the pack prefix', () => {
    expect(bareRegionId('base:florida-keys')).toBe('florida-keys');
    expect(bareRegionId('florida-keys')).toBe('florida-keys');
    expect(sameRegion('base:florida-keys', 'florida-keys')).toBe(true);
    expect(sameRegion('sf:san-francisco', 'florida-keys')).toBe(false);
  });

  it('drops blank and repeated regions, keeping the first', () => {
    const cleaned = cleanRegions([
      keys,
      { id: ' ', name: 'x' },
      { id: 'y', name: '' },
      sf,
      { ...keys, name: 'Again' },
    ]);
    expect(cleaned.map((o) => o.name)).toEqual(['The Keys', 'San Francisco']);
  });

  it("the default names a region the base pack really has (the Keys, today's only one)", () => {
    const reg = loadBasePack({ includeDrafts: true });
    const ids = Object.keys(reg.regions);
    expect(ids.some((id) => sameRegion(id, DEFAULT_REGION))).toBe(true);
  });
});
