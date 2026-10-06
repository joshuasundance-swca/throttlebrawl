// Smathers Beach reads as a beach (playtest 4, P4-19, run B's live check, punch item 3: "Smathers Beach still
// reads as a resort strip. It has hotels on both sides and the sea on both sides"; the identity sheets' K2:
// "Make the seaward side `beach` with no hotels. The inland side gets salt-pond water (`water-shallow`)").
// South Roosevelt Boulevard has the Atlantic on its left, the whole way, and the airport and its salt ponds on
// its right. What is asked, from the real baked road and the real kit, each rule with a control:
// - the seaward (left) side is `beach` with no `key-resort` district anywhere on it, so no hotel, pool, tiki
//   bar or scooter rack stands on it; with the district on both sides, as it was, they do (control);
// - the inland (right) side keeps the district, so the resort still stands there, and over at least a quarter
//   of the road its land is salt-pond water (`water-shallow`), where nothing stands: no hotel, and no board
//   slot of the road stands in the water.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideItem } from './roadside';
import { themeAt, type SideTag } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

const NETWORK = 'osm-keys-key-west';
const BEACH = 'osm-kw-smathers-beach';
const SEEDS = [1, 7, 42, 99];
/** The rules whose props are the resort district's (roadside.ts `RESORT`). */
const RESORT_RULES = ['hotel', 'pool', 'tiki', 'scooters'];

const keysRoadside = await bakeRepoModel('keysRoadside');

function track(tags?: (own: readonly SideTag[]) => readonly SideTag[]): {
  road: RoadNetwork;
  dressing: RoadDressing;
  tags: readonly SideTag[];
} {
  const network = Object.values(networkFiles).find((n) => n.id === NETWORK);
  if (!network) throw new Error(`no network ${NETWORK}`);
  const roads = Object.values(roadFiles)
    .filter((r) => network.roads.includes(r.id))
    .map((r): BakedRoad =>
      r.id === BEACH && tags
        ? ({ ...r, tags: tags((r.tags ?? []) as SideTag[]) } as unknown as BakedRoad)
        : r,
    );
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const road = createRoadNetwork({ network, roads });
  const own = (roads.find((r) => r.id === BEACH)?.tags ?? []) as SideTag[];
  return { road, dressing, tags: own };
}

function scatter(seed: number, t: ReturnType<typeof track>): RoadsideItem[] {
  const built = buildRoadScene(t.road, look, t.dressing, { seed });
  return scatterRoadside({
    road: t.road,
    dressing: t.dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models: { keysRoadside },
  });
}

/** The resort's props that stand on the beach road, by the side they stand on. */
function resortProps(items: readonly RoadsideItem[], t: ReturnType<typeof track>) {
  const edge = t.road.edgeIndex(BEACH);
  const mine = items.filter((it) => it.edge === edge && RESORT_RULES.includes(it.rule));
  return { left: mine.filter((it) => it.d < 0), right: mine.filter((it) => it.d > 0) };
}

const covers = (t: SideTag, side: 'left' | 'right', s: number) =>
  s >= t.s0 && s <= t.s1 && (t.side === side || t.side === 'both');

describe('Smathers Beach: the sea side is a beach, the inland side the airport`s salt ponds and a few hotels', () => {
  const t = track();
  const length = Object.values(roadFiles).find((r) => r.id === BEACH)!.lengthM;

  it('has `beach` and no resort district on its left, and the district on its right', () => {
    const left = t.tags.filter((x) => x.side === 'left' || x.side === 'both');
    expect(left.some((x) => x.tag === 'beach')).toBe(true);
    expect(left.filter((x) => x.tag === 'key-resort')).toEqual([]);
    const right = t.tags.filter((x) => x.side === 'right' || x.side === 'both');
    const resort = right.filter((x) => x.tag === 'key-resort').reduce((n, x) => n + (x.s1 - x.s0), 0);
    print(
      `${BEACH}: ${length.toFixed(0)} m, the resort district covers ${resort.toFixed(0)} m of the right side, none of the left`,
    );
    expect(resort).toBeGreaterThan(length * 0.8);
  });

  it('has salt ponds (`water-shallow`) over a quarter or more of the right side, never on the left or under a bridge', () => {
    const ponds = t.tags.filter((x) => x.tag === 'water-shallow');
    expect(ponds.every((x) => x.side === 'right')).toBe(true);
    const bridge = t.tags.filter((x) => x.tag === 'bridge');
    const total = ponds.reduce((n, x) => n + (x.s1 - x.s0), 0);
    print(
      `${ponds.length} salt-pond runs, ${total.toFixed(0)} m of ${length.toFixed(0)} m (${((100 * total) / length).toFixed(0)} %)`,
    );
    expect(ponds.length).toBeGreaterThanOrEqual(2);
    expect(total).toBeGreaterThanOrEqual(length * 0.25);
    for (const p of ponds)
      for (const b of bridge)
        expect(p.s1 <= b.s0 || p.s0 >= b.s1, `pond ${p.s0}-${p.s1} vs bridge`).toBe(true);
  });

  it('draws the ponds as water, and the land between them stays land', () => {
    const ponds = t.tags.filter((x) => x.tag === 'water-shallow');
    for (const p of ponds) expect(themeAt(t.tags, 'right', (p.s0 + p.s1) / 2)).toBe('water');
    // Control: the left never turns to water, and the right is land (palms) outside the ponds.
    for (let s = 700; s < length; s += 137) {
      expect(
        themeAt(t.tags, 'left', s) === 'water' &&
          !t.tags.some((x) => x.tag.startsWith('water') && covers(x, 'left', s)),
      ).toBe(false);
      if (
        !ponds.some((p) => covers(p, 'right', s)) &&
        !t.tags.some((x) => x.tag === 'bridge' && covers(x, 'right', s))
      )
        expect(themeAt(t.tags, 'right', s), `right at s ${s}`).toBe('palms');
    }
  });

  it('keeps the road`s own board slots out of the water', () => {
    const road = Object.values(roadFiles).find((r) => r.id === BEACH)!;
    const ponds = t.tags.filter((x) => x.tag === 'water-shallow');
    for (const f of road.features ?? []) {
      if (f.kind !== 'billboard' || f.d0 < 0) continue;
      for (const p of ponds)
        expect(
          f.s1 < p.s0 || f.s0 > p.s1,
          `${f.id} (s ${f.s0}-${f.s1}) is in the pond at ${p.s0}-${p.s1}`,
        ).toBe(true);
    }
  });
});

describe.each(SEEDS)('Smathers Beach props, seed %i', (seed) => {
  const t = track();
  const { left, right } = resortProps(scatter(seed, t), t);
  const ponds = t.tags.filter((x) => x.tag === 'water-shallow');

  it('stands no hotel, pool, tiki bar or scooter rack on the sea side; the resort stands inland, not in a pond', () => {
    print(
      `seed ${seed}: ${left.length} resort props on the sea side, ${right.length} inland (${[...new Set(right.map((r) => r.rule))].join(', ')})`,
    );
    expect(left).toEqual([]);
    expect(right.length).toBeGreaterThan(0);
    for (const it of right)
      expect(
        ponds.some((p) => it.s >= p.s0 && it.s <= p.s1),
        `${it.rule} at s ${it.s.toFixed(0)} is in a pond`,
      ).toBe(false);
  });

  it('the old tags, the district on both sides, put resort props on the sea side (control)', () => {
    const old = track((own) =>
      own
        .filter((x) => x.tag !== 'water-shallow' && x.tag !== 'key-resort')
        .concat(
          { s0: 0, s1: 579.0308, side: 'both', tag: 'key-resort' },
          { s0: 639.0339, s1: 4667.2419, side: 'both', tag: 'key-resort' },
        ),
    );
    const before = resortProps(scatter(seed, old), old);
    expect(before.left.length + before.right.length).toBeGreaterThan(0);
    // Over the four seeds the sea side had hotels (checked on the last of them below).
    if (seed === SEEDS[SEEDS.length - 1]) expect(before.left.length).toBeGreaterThan(0);
  });
});
