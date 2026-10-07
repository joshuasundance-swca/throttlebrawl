// Nothing drawn on a ridable band is a ghost (playtest 4, the maintainer, 2026-10-05: "I'd like all
// hitboxes on everything to make sense"; street furniture is "solid but maybe forgiving to sides,
// brushes, etc"). Every network is built as a race draws it (its road scene, its roadside kit, its
// city layers), and every prop that stands where a rider can ride (its anchor inside a verge band, the
// band a rider's centre may ride out to, road/cross-section.ts) must be one the sim meets: a piece of
// road/furniture.ts's plan (drawn by the layer that planned it, met by sim/riders), or a soft one the
// rider is meant to ride through (ferns, salal, sea grape: the understory). The kits' other props and the
// scenery stand past the band (render/scenery.ts `ridableBandPast`, every band now, not only loose ones).
//
// Before this change the same count (seed 7, every network) found 7,541 props standing on the band with
// nothing in the sim behind them: the San Francisco kit's hydrants, lamps, meters, trees, bins, boards and
// scooters, the downtown, waterfront and mural-alley furniture, Old Town's planters, scooter racks and
// frangipanis, the Keys towns' mailboxes and pickets, the power poles and palms on city kerbs, Lake
// Samish's shoulder stumps, a few staged scenes and fence runs, and Portland's bike racks (still `KNOWN`).
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  planStreetFurniture,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { planBlocks } from './chinatown-northbeach';
import { planDowntown, planPortland } from './downtown';
import { createFlatLook } from './look';
import { planMission } from './mission';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type ModelKind, type SceneryModels } from './models';
import { placeItems } from './pnw-places';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { KITS, scatterRoadside } from './roadside';
import type { ScenesFile } from './scenes/data';
import { placeScenes } from './scenes/place';
import { planWaterfront } from './waterfront';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const sceneFiles = import.meta.glob<ScenesFile>('../../packs/*/assets/scenes/*.json', {
  eager: true,
  import: 'default',
});

/**
 * Soft growth a rider rides through: the understory (roadside.ts `understory` rules) and the clear-cut's
 * rows of seedlings (pnw-places.ts).
 */
const SOFT = new Set(['verge', 'salal', 'fern', 'seagrape', 'seedlings']);
/**
 * Structures whose anchor is on the band but whose body is not where a rider rides: building fronts
 * (the facade on the band's outer edge, the sim's hard edge, the body past it), the ferry (the road is its
 * deck: its hull is the band's hard edge, its funnel and wheelhouse stand on its cabin roof), and what
 * hangs over the street (the festival's bunting and banner, 5 m up and more).
 */
const STRUCTURES = new Set([
  'oldtown-front',
  'oldtown-bar',
  'tower',
  'plaza-tower',
  'back-tower',
  'hq',
  'pier-shed',
  'ferry-hall',
  'ferry-hull',
  'ferry-end',
  'ferry-funnel',
  'ferry-wheelhouse',
  'ferry-name',
  'bunting',
  'banner',
]);
/**
 * The ones not in the plan yet, each with its reason and the most there may be (a known gap the report
 * names, so it cannot grow unseen).
 */
const KNOWN: Readonly<Record<string, { upTo: number; why: string }>> = {
  'pdx-rack': {
    upTo: 90,
    why: "Portland's bike racks: placed among its blocks by road/structures/downtown.ts planPdxDowntown, a structure of the plan (a `wall`) since the physical world's port (2026-10-06), but the sim does not meet the structure plan yet, so a rider rides through one with no wobble until it does",
  },
};
/** A prop this far inside a band's outer edge stands on the band, m (a front's anchor is on the edge). */
const INSIDE_M = 0.05;

function track(network: BakedNetwork, path: string): { road: RoadNetwork; dressing: RoadDressing } {
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const models: SceneryModels = {};
async function modelsFor(kinds: readonly ModelKind[]): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const k of kinds) {
    if (!models[k]) {
      try {
        models[k] = await bakeRepoModel(k);
      } catch {
        continue;
      }
    }
    out[k] = models[k];
  }
  return out;
}

const SEED = 7;
const NETWORKS = Object.entries(networkFiles).sort(([, a], [, b]) => a.id.localeCompare(b.id));

describe('nothing drawn on a ridable band is a ghost (playtest 4)', () => {
  const totals = { props: 0, onBand: 0, planned: 0, soft: 0 };

  it.each(NETWORKS.map(([path, n]) => [n.id, path, n] as const))(
    '%s: every prop on a ridable band is the plan the sim meets, or soft',
    async (_id, path, network) => {
      const { road, dressing } = track(network, path);
      const { tropical, tags } = networkTags(road, dressing);
      const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
      const loaded = await modelsFor(kinds);
      const built = buildRoadScene(road, look, dressing, { seed: SEED, models: loaded });
      const plan = planStreetFurniture(road, SEED);
      const planned = new Set(
        plan.items.map((p) => `${p.rule}:${p.edge}:${p.s.toFixed(2)}:${p.d.toFixed(2)}`),
      );
      const props: { src: string; rule: string; edge: number; s: number; d: number }[] = [];
      const kit = Object.keys(KITS).find((k) => kinds.includes(k as ModelKind) && loaded[k as ModelKind]);
      if (kit) {
        const items = scatterRoadside({
          road,
          dressing,
          seed: SEED,
          density: 1,
          kit: KITS[kit]!,
          landReach: (e, side, s) => built.landReach(e, side, s),
          spots: built.spots,
          models: loaded,
        });
        for (const i of items) props.push({ src: 'kit', rule: i.rule, edge: i.edge, s: i.s, d: i.d });
      }
      for (const sp of built.spots)
        props.push({ src: 'scenery', rule: sp.kind, edge: sp.edge, s: sp.s, d: sp.d });
      if (['towers', 'plaza'].some((t) => tags.has(t)))
        for (const i of planDowntown({ road, dressing, seed: SEED }).items)
          props.push({ src: 'downtown', rule: i.rule, edge: i.edge, s: i.s, d: i.d });
      if (['promenade', 'wharf', 'ferry-plaza', 'wharf-lot'].some((t) => tags.has(t)))
        for (const i of planWaterfront({ road, dressing, seed: SEED }, loaded).items)
          props.push({ src: 'waterfront', rule: i.rule, edge: i.edge, s: i.s, d: i.d });
      if (['shopfronts', 'murals', 'mascot-mural'].some((t) => tags.has(t)))
        for (const i of planMission({ road, dressing, seed: SEED }).items)
          props.push({ src: 'mission', rule: i.rule, edge: i.edge, s: i.s, d: i.d });
      if (['lanterns', 'cafes', 'hill-park', 'side-street'].some((t) => tags.has(t))) {
        const blocks = planBlocks({ road, dressing, seed: SEED });
        for (const t of blocks.tables)
          props.push({ src: 'blocks', rule: 'table', edge: t.edge, s: t.s, d: t.d });
        for (const t of blocks.treeSpots)
          props.push({ src: 'blocks', rule: 'tree', edge: t.edge, s: t.s, d: t.d });
      }
      const pdx = loaded['pdxDowntown' as ModelKind];
      if (tags.has('pdx-blocks') && pdx) {
        for (const i of planPortland({ road, dressing, seed: SEED, portland: true }).items)
          props.push({ src: 'portland', rule: i.rule, edge: i.edge, s: i.s, d: i.d });
      }
      // The Pacific Northwest's places: its hazards' props are the sim's solid hazards (`threat`).
      for (const i of placeItems(road, SEED, (e, side, s) => built.landReach(e, side, s)))
        if (!i.threat) props.push({ src: 'places', rule: i.kind, edge: i.edge, s: i.s, d: i.d });
      const scenesKey = Object.keys(sceneFiles).find((k) =>
        k.endsWith(`/scenes/${/regions\/([^/]+)\//.exec(path)?.[1] ?? ''}.json`),
      );
      const scenes = scenesKey ? sceneFiles[scenesKey] : undefined;
      if (scenes)
        for (const sc of placeScenes({
          road,
          seed: SEED,
          file: scenes,
          landReach: (e, side, s) => built.landReach(e, side, s),
          spots: built.spots,
        }))
          props.push({ src: 'scene', rule: sc.def.id, edge: sc.edge, s: sc.s, d: sc.d });
      const ghosts: string[] = [];
      const known = new Map<string, number>();
      let onBand = 0;
      for (const p of props) {
        const v = road.vergeAt(
          p.edge,
          Math.max(0, Math.min(road.edges[p.edge]?.length ?? 0, p.s)),
          p.d < 0 ? 'left' : 'right',
        );
        if (v.widthM <= 0 || Math.abs(p.d) >= Math.abs(v.dOuter) - INSIDE_M) continue;
        onBand++;
        if (SOFT.has(p.rule)) {
          totals.soft++;
          continue;
        }
        if (STRUCTURES.has(p.rule)) continue;
        if (planned.has(`${p.rule}:${p.edge}:${p.s.toFixed(2)}:${p.d.toFixed(2)}`)) {
          totals.planned++;
          continue;
        }
        if (KNOWN[p.rule]) {
          known.set(p.rule, (known.get(p.rule) ?? 0) + 1);
          continue;
        }
        ghosts.push(
          `${p.src} ${p.rule} on ${road.edges[p.edge]?.id} s ${p.s.toFixed(1)} d ${p.d.toFixed(2)} (band to ${v.dOuter.toFixed(2)})`,
        );
      }
      totals.props += props.length;
      totals.onBand += onBand;
      print(
        `[examined] ${network.id}: ${props.length} props, ${onBand} on a ridable band, ${plan.items.length} planned pieces, ${ghosts.length} ghosts`,
      );
      const byRule = new Map<string, number>();
      for (const g of ghosts)
        byRule.set(g.split(' on ')[0] ?? g, (byRule.get(g.split(' on ')[0] ?? g) ?? 0) + 1);
      if (ghosts.length) print(`  ghosts by rule: ${[...byRule].map(([k, n]) => `${k} ${n}`).join(', ')}`);
      for (const [rule, n] of known) {
        print(`  known, not yet planned: ${rule} ${n} (${KNOWN[rule]?.why ?? ''})`);
        expect(n).toBeLessThanOrEqual(KNOWN[rule]?.upTo ?? 0);
      }
      expect(ghosts.slice(0, 10)).toEqual([]);
    },
    120_000,
  );

  it('found props on the bands (the check can see them)', () => {
    print(
      `[examined] all networks: ${totals.props} props, ${totals.onBand} on a ridable band: ${totals.planned} planned, ${totals.soft} soft`,
    );
    expect(totals.planned).toBeGreaterThan(2000);
  });
});
