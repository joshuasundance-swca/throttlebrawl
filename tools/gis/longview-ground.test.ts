import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createRoadNetwork, terrainAt, type BakedNetwork, type BakedRoad } from '../../src/road';
import { pnwPlacesLayout } from '../../src/road/structures/pnw-places';
import { packInputs } from '../../scripts/pack-inputs.mjs';

const base = 'packs/region-pnw/regions/pacific-northwest';
const inputs = packInputs(process.cwd());
const read = <T>(path: string): T => JSON.parse(inputs.materialize(path, readFileSync(path, 'utf8'))) as T;

it('supports Street Diamond frontage aprons without burying their tops or leaving their bases afloat', () => {
  const network = read<BakedNetwork>(`${base}/networks/osm-pnw-longview-diamond.json`);
  const roads = network.roads.map((id) => read<BakedRoad>(`${base}/roads/${id}.json`));
  const road = createRoadNetwork({ network, roads });
  const sites = pnwPlacesLayout(road, 1).streetSites;
  expect(sites.length).toBeGreaterThan(0);
  let examined = 0;
  for (const site of sites) {
    const apron = site.specs.find((spec) => spec.rule.endsWith(':apron'));
    expect(apron).toBeDefined();
    if (!apron) continue;
    if (apron.roof.kind !== 'flat') throw new Error('apron must expose its flat slab top');
    const topY = apron.baseY + apron.roof.topM;
    const f = apron.foot;
    // Include the actual unsnapped perimeter as well as the interior. The acceptance is physical
    // contact within the apron body, not exact equality with an author's snapped guide plane.
    const nu = Math.ceil(f.hu * 2);
    const nv = Math.ceil(f.hv * 2);
    for (let i = 0; i <= nu; i++)
      for (let j = 0; j <= nv; j++) {
        const u = -f.hu + (2 * f.hu * i) / nu;
        const v = -f.hv + (2 * f.hv * j) / nv;
        const x = f.x + u * f.ux - v * f.uz;
        const z = f.z + u * f.uz + v * f.ux;
        const land = terrainAt(road.terrain, x, z, Infinity, 'land');
        expect(land, `${site.kind} at ${u},${v}`).not.toBeNull();
        if (!land) continue;
        expect(land.y, `${site.kind} below apron underside`).toBeGreaterThanOrEqual(apron.baseY);
        expect(land.y, `${site.kind} above apron top`).toBeLessThanOrEqual(topY);
        examined++;
      }
  }
  expect(examined).toBeGreaterThan(0);
  expect(terrainAt(road.terrain, 1e7, 1e7, Infinity, 'land')).toBeNull();
});
