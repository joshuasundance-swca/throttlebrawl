import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { boardCatalog } from './regions';

const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const regionKey = 'region-pnw:pacific-northwest';
const region = reg.regions[regionKey]!;
// The selected locality policy, not a whole-game sign inventory; words come from the actual pack.
const localNotices = [
  'spur-keep-right',
  'lake-samish-keep-right',
  'ferry-bridge-out',
  'ferry-engines-off',
  'ferry-far-side',
  'stump-social-closed',
  'stump-social-end',
];
const pooledRefs = (catalog: ReturnType<typeof boardCatalog>) =>
  [...(catalog.pools?.signs ?? []), ...(catalog.pools?.billboards ?? [])].map((item) => item.ref);

describe('Northwest directions and local notices stay at their authored sites', () => {
  it.each(localNotices)('%s remains named and cannot fill a generic roadside slot', (id) => {
    const authored = region.signs?.find((item) => item.id === id);
    expect(authored, 'the selected notice exists in actual content').toBeDefined();
    const namedSlots = Object.entries(reg.roads)
      .filter(([key]) => key.startsWith('region-pnw:'))
      .flatMap(([, road]) =>
        ((road as { features?: { kind: string; item?: string }[] }).features ?? []).filter(
          (slot) => slot.kind === 'billboard' && slot.item === id,
        ),
      );
    expect(namedSlots.length, 'the notice retains an actual authored placement').toBeGreaterThan(0);
    const catalog = boardCatalog(reg, regionKey);
    const ref = `region-pnw:region/${region.id}#${id}`;
    expect(catalog.items[id]).toEqual({ ref, text: authored!.text, kind: 'sign' });
    expect(pooledRefs(catalog), 'an unrelated slot cannot select this local notice').not.toContain(ref);
  });

  it('keeps regional humor in the pool and existing site notices out', () => {
    const catalog = boardCatalog(reg, regionKey);
    for (const id of ['bigfoot-crossing', 'ferry-wait', 'parade-route']) {
      expect(catalog.items[id]).toBeDefined();
      expect(pooledRefs(catalog)).toContain(catalog.items[id]!.ref);
    }
    expect(catalog.items['morrison-keep-left']).toBeDefined();
    expect(pooledRefs(catalog)).not.toContain(catalog.items['morrison-keep-left']!.ref);
    expect(catalog.pools?.billboards?.length).toBeGreaterThan(0);
  });

  it.each(localNotices)('a device veto still removes %s without removing other notices', (id) => {
    const baseline = boardCatalog(reg, regionKey);
    const ref = baseline.items[id]!.ref;
    const cut = boardCatalog(reg, regionKey, new Set([ref]));
    expect(cut.items[id]).toBeUndefined();
    expect(pooledRefs(cut)).not.toContain(ref);
    expect(cut.items['bigfoot-crossing']).toEqual(baseline.items['bigfoot-crossing']);
  });

  it('detects a local notice deliberately returned to the regional pool', () => {
    const id = 'ferry-bridge-out';
    const withoutSite = {
      ...reg,
      regions: {
        ...reg.regions,
        [regionKey]: {
          ...region,
          signs: region.signs?.map((item) => (item.id === id ? { ...item, tags: [] } : item)),
        },
      },
    } as typeof reg;
    const catalog = boardCatalog(withoutSite, regionKey);
    expect(catalog.items[id]).toBeDefined();
    expect(pooledRefs(catalog)).toContain(catalog.items[id]!.ref);
  });
});
