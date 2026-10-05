import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Bridge City's downtown dressing (playtest 3, T10.5): the sidewalk zones, the site signs and the
// bridge decks' `pdx-deck` tag live in the committed roads and in the config that bakes them
// (networks/osm-pnw-portland.json), so a re-bake gives them back. Without the OSM extract this
// test cannot re-bake, so it holds the two files to each other: everything the config says about a
// road's features and deck tags is in the baked road, and the config says all of it.

const REGION = 'packs/region-pnw/regions/pacific-northwest';

interface Json {
  [key: string]: unknown;
}
interface Feature extends Json {
  id: string;
  kind: string;
}
interface Tag {
  s0: number;
  s1: number;
  side: string;
  tag: string;
}
interface ConfigRoad {
  id: string;
  features?: Feature[];
  deckTags?: string[];
}
interface Road {
  features: Feature[];
  tags: Tag[];
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = read<{ lines: { roads?: ConfigRoad[] }[] }>('tools/gis/networks/osm-pnw-portland.json');
const roads = config.lines.flatMap((l) => l.roads ?? []);
const baked = (id: string) => read<Road>(`${REGION}/roads/${id}.json`);

describe("Bridge City's dressing is in the bake config and in the baked roads alike", () => {
  it('every feature the config lists is in its baked road, the same, and the road has no others', () => {
    const withFeatures = roads.filter((r) => (r.features ?? []).length > 0);
    console.log(
      `[examined] ${withFeatures.length} roads, ${withFeatures.reduce((n, r) => n + (r.features?.length ?? 0), 0)} features`,
    );
    expect(withFeatures.length).toBeGreaterThanOrEqual(6);
    for (const r of withFeatures) {
      const road = baked(r.id);
      for (const f of r.features ?? [])
        expect(
          road.features.find((x) => x.id === f.id),
          `${r.id}: ${f.id}`,
        ).toMatchObject(f);
      // The landmarks come from the config's `landmarks` list, not a road's own features.
      const own = road.features.filter((x) => x.kind !== 'landmark').map((x) => x.id);
      expect(own.sort(), r.id).toEqual((r.features ?? []).map((f) => f.id).sort());
    }
  });

  it('each deck tag in the config covers every bridge run of its road, in the baked tags', () => {
    const decked = roads.filter((r) => (r.deckTags ?? []).length > 0);
    expect(decked.length).toBeGreaterThanOrEqual(4);
    for (const r of decked) {
      const tags = baked(r.id).tags;
      const bridges = tags.filter((t) => t.tag === 'bridge');
      expect(bridges.length, `${r.id} has a bridge run`).toBeGreaterThan(0);
      for (const b of bridges)
        for (const name of r.deckTags ?? [])
          expect(
            tags.some((t) => t.tag === name && t.s0 === b.s0 && t.s1 === b.s1 && t.side === 'both'),
            `${r.id}: ${name} over the bridge at ${b.s0}-${b.s1}`,
          ).toBe(true);
    }
  });

  it('a baked bridge run with a downtown deck tag is in the config: no road carries one by hand', () => {
    const configured = new Set(roads.filter((r) => (r.deckTags ?? []).length > 0).map((r) => r.id));
    for (const r of roads) {
      const has = baked(r.id).tags.some((t) => t.tag === 'pdx-deck');
      expect(has, r.id).toBe(configured.has(r.id));
    }
  });
});
