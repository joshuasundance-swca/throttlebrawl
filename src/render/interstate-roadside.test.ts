// An interstate has no mailboxes, firewood stacks, espresso huts, split-rail fences or warning signs on its
// verge (playtest 4, P4-19, run C5; sheet I1: the Pacific Northwest's kit stood them on I-5 with "no
// exception for a highway"). The check scatters the real kit over the real I-5 network: the rule is "no
// built thing of the byway stands on a side tagged `interstate`", and the same scatter with the tag taken off
// is the control that shows the checker can see them.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { inDistrict, PNW_KIT, scatterRoadside, type RoadsideItem } from './roadside';
import type { SideTag } from './scenery';

const network = Object.values(
  import.meta.glob<BakedNetwork>(
    '../../packs/region-pnw/regions/pacific-northwest/networks/osm-pnw-samish.json',
    {
      eager: true,
      import: 'default',
    },
  ),
)[0]!;
const roads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/pacific-northwest/roads/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => network.roads.includes(r.id));

const look = createFlatLook();
const road: RoadNetwork = createRoadNetwork({ network, roads });
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
/** The same dressing with the interstate tag taken off every road: today's kit on the same ground. */
const withoutTag = Object.fromEntries(
  roads.map((r) => [r.id, { ...r, tags: (r.tags ?? []).filter((t) => t.tag !== 'interstate') }]),
) as unknown as RoadDressing;
const tagsOf = (d: RoadDressing, edge: number): readonly SideTag[] => d[road.edges[edge]!.id]?.tags ?? [];
const sideOf = (it: RoadsideItem) => (it.d < 0 ? 'left' : 'right');

/**
 * The kit's variants a person made or planted for a road that is not an interstate (the kit's own list).
 * They are variants of the kit's own model: a rule with a `model` of its own (the Gorge's walls, the madrones,
 * Chuckanut's rock and Lake Samish's shore) numbers another file's variants.
 */
const BUILT = new Set([4, 5, 6, 7, 8, 9]);
const builtRules = PNW_KIT.rules.filter((r) => r.model === undefined && r.v.every((v) => BUILT.has(v)));

function scatter(d: RoadDressing, seed: number): RoadsideItem[] {
  const built = buildRoadScene(road, look, d, { seed });
  const items = scatterRoadside({
    road,
    dressing: d,
    seed,
    density: 1,
    kit: PNW_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
  });
  built.dispose();
  return items;
}

const SEEDS = [1, 7, 42];

describe("the Pacific Northwest's kit keeps its byway things off an interstate", () => {
  it('names every built rule: mailboxes, firewood, huts, fences and signs stand nowhere the district is', () => {
    expect(builtRules.map((r) => r.id).sort()).toEqual(
      ['espresso', 'espresso-town', 'firewood', 'log-fence', 'mailbox', 'sign', 'split-rail'].sort(),
    );
    for (const r of builtRules) expect(r.notDistrict, r.id).toContain('interstate');
    // The woods stay: ferns, salal, trees, stumps and rocks have no such exception.
    for (const r of PNW_KIT.rules.filter((x) => !builtRules.includes(x)))
      expect(r.notDistrict ?? [], r.id).not.toContain('interstate');
  });

  it('stands none of them on an interstate side, over the real I-5 network and three seeds', () => {
    let onInterstate = 0;
    let natural = 0;
    for (const seed of SEEDS)
      for (const it of scatter(dressing, seed)) {
        if (!inDistrict(tagsOf(dressing, it.edge), sideOf(it), it.s, ['interstate'])) continue;
        onInterstate++;
        if (builtRules.some((r) => r.id === it.rule))
          throw new Error(`${it.rule} stands on the interstate at ${it.s}`);
        natural++;
      }
    console.log(
      `[examined] ${SEEDS.length} seeds: ${onInterstate} props on interstate sides, ${natural} of the woods`,
    );
    expect(natural, 'the forest still stands there').toBeGreaterThan(200);
  });

  it('would stand some of them there without the tag (the control: the check can see them)', () => {
    let built = 0;
    for (const seed of SEEDS)
      for (const it of scatter(withoutTag, seed)) if (builtRules.some((r) => r.id === it.rule)) built++;
    console.log(`[examined] control, no interstate tag: ${built} byway things on the same roads`);
    expect(built).toBeGreaterThan(5);
  });
});
