// Playtest 3, T10.6 (wave B's punch list, item 5): Conzelman Road, Hawk Hill and the Vista Point road
// of the Golden Gate route were tagged `forest` as a stand-in for the Marin Headlands, so they drew
// dense pines, log fences and ferns, which read as the Pacific Northwest. The `headlands` tag is a
// land theme of its own now: grass to the hill's edge, no trees, no poles, a soft verge. The checks
// build the real Golden Gate network the way the game does and look at what was built, against the
// same network with the old stand-in tag as the control (it must show the pines, or "no pines" says
// nothing).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, deriveVerge, type BakedNetwork, type BakedRoad, type BakedTag } from '../road';
import { createFlatLook } from './look';
import { modelKindsFor } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { themeAt } from './scenery';

const look = createFlatLook();
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const NETWORK = 'osm-sf-golden-gate';
const found = Object.values(networkFiles).find((n) => n.id === NETWORK);
if (!found) throw new Error(`no network ${NETWORK}`);
const network: BakedNetwork = found;
const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));

/** The network with its land tags passed through `retag` (a control: the old stand-in). */
function scene(retag: (tags: readonly BakedTag[]) => BakedTag[]) {
  const edited = roads.map((r) => ({ ...r, tags: retag(r.tags ?? []) }));
  const dressing = Object.fromEntries(edited.map((r) => [r.id, r])) as unknown as RoadDressing;
  const built = buildRoadScene(createRoadNetwork({ network, roads: edited }), look, dressing, { seed: 7 });
  return { built, edited };
}
const asShipped = scene((tags) => [...tags]);
const withForest = scene((tags) => tags.map((t) => (t.tag === 'headlands' ? { ...t, tag: 'forest' } : t)));

describe('the Golden Gate route outside the bridge is the Marin Headlands, not the forest', () => {
  const land = roads.filter((r) => !(r.tags ?? []).some((t) => t.tag === 'bridge'));

  it('every land road reads as headlands on both sides, over its whole length, with no forest tag', () => {
    expect(land.length).toBeGreaterThanOrEqual(3);
    for (const r of land) {
      expect(
        (r.tags ?? []).map((t) => t.tag),
        r.id,
      ).not.toContain('forest');
      for (let s = 0; s <= r.lengthM; s += 25)
        for (const side of ['left', 'right'] as const)
          expect(themeAt(r.tags, side, Math.min(s, r.lengthM)), `${r.id} ${side} at ${s}`).toBe('headlands');
    }
  });

  it('draws no conifer, house or pole, where the same land tagged forest draws pines', () => {
    const shipped = asShipped.built.stats.scenery;
    const control = withForest.built.stats.scenery;
    console.log(
      `[examined] ${NETWORK} as shipped: conifer ${shipped.conifer}, pole ${shipped.pole}, house ${shipped.house}; ` +
        `the control with its land tagged forest: conifer ${control.conifer}`,
    );
    expect(control.conifer, 'the control draws pines').toBeGreaterThan(20);
    expect(shipped.conifer).toBe(0);
    expect(shipped.house).toBe(0);
    expect(shipped.pole).toBe(0);
  });

  it("is open ground on the sim's side: a soft grass verge, no ferns (`brush`) and no fence", () => {
    for (const r of land) {
      for (const side of ['left', 'right'] as const) {
        const v = deriveVerge(r, side, r.lengthM / 2);
        expect(v.surface, `${r.id} ${side}`).toBe('grass');
        expect(v.edge, `${r.id} ${side}`).toBe('soft');
      }
    }
  });

  it("loads none of the Pacific Northwest's roadside kit or conifers", () => {
    const tags = new Set(roads.flatMap((r) => (r.tags ?? []).map((t) => t.tag)));
    const kinds = modelKindsFor({ tags, tropical: false, palette: new Set<string>(), traffic: [] });
    expect(kinds).not.toContain('pnwRoadside');
    expect(kinds).not.toContain('conifers');
    expect(kinds).not.toContain('trestleBent');
  });
});
