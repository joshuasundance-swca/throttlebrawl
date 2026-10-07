// What each landmark's parts are measured from (structure-columns.test-util.ts): the kit node render draws
// (render/landmarks.ts: the node, or its `_lod0`), or the code-made soup a composite draws (Fred the Tree, Pigeon
// Key's island, the Twin Peaks summit lot, the cruise ship's top deck), and how each is cut into columns.
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { CRUISE_SLIDES, cruiseShipTopSoup } from './cruise-ship-top';
import { fredSoup, type Soup } from './fred';
import { MeshBuilder } from './landmarks';
import type { LandmarkKitId } from './models';
import { islandSoup } from './pigeon-key';
import type { ColumnOptions } from './structure-columns.test-util';
import { landmarkKit } from './structures.test-util';
import { summitLotSoup } from './summit-lot';

/** A source: a kit node (`<kit>#<node>`) or a soup (`soup#<name>`), and how it is cut. */
export interface PartSource {
  id: string;
  options: ColumnOptions;
}

/** A building: solid from its ground up to its roofs. */
const ground = (cell: number): ColumnOptions => ({ cell, mode: 'ground' });
/** Open work (a gate, a truss, a tree): each column from its lowest drawn point to its highest. */
const column = (cell: number, clip?: number): ColumnOptions => ({
  cell,
  mode: 'column',
  ...(clip !== undefined ? { clip } : {}),
});
/** What the road runs through or under: its parts under the deck (under the course) left out. */
const OVER_ROAD = 0.05;

export const PART_SOURCES: readonly PartSource[] = [
  // The Keys.
  { id: 'keys-landmarks#mallory_pier', options: ground(1) },
  { id: 'keys-landmarks#cruise_ship', options: ground(4) },
  { id: 'keys-landmarks#southernmost_buoy', options: ground(0.5) },
  { id: 'keys-landmarks#mile_marker_0', options: ground(0.25) },
  { id: 'keys-landmarks#west_martello', options: ground(1) },
  { id: 'keys-landmarks#east_martello', options: ground(1.5) },
  { id: 'keys-identity#keys_mile_marker', options: ground(0.2) },
  { id: 'seven-mile-kit#pigeon_key_cottage_a', options: ground(0.5) },
  { id: 'seven-mile-kit#pigeon_key_cottage_b', options: ground(0.5) },
  { id: 'seven-mile-kit#pigeon_key_dock', options: ground(0.5) },
  // The Pacific Northwest.
  { id: 'gorge-landmarks#vista_house', options: ground(1) },
  { id: 'pdx-landmarks#pdx_plaza', options: ground(1.5) },
  { id: 'pdx-landmarks#pdx_roof_sign', options: ground(1) },
  { id: 'pdx-landmarks#pdx_chinatown_gate', options: column(0.5) },
  { id: 'pdx-landmarks#pdx_bascule_pier', options: column(1, OVER_ROAD) },
  { id: 'pdx-landmarks#pdx_truss_bay', options: column(1, OVER_ROAD) },
  { id: 'pdx-landmarks#pdx_lift_tower', options: column(1, OVER_ROAD) },
  { id: 'pdx-landmarks#pdx_lift_span', options: column(1, OVER_ROAD) },
  // San Francisco.
  { id: 'sf-landmarks#toll_gantry', options: column(0.5, OVER_ROAD) },
  { id: 'sf-landmarks#sf_dragon_gate', options: column(0.5, OVER_ROAD) },
  { id: 'sf-landmarks#sf_flatiron', options: ground(1) },
  { id: 'sf-landmarks#coit_tower', options: ground(1) },
  { id: 'sf-landmarks#sf_mission_church', options: ground(1) },
  { id: 'sf-landmarks#sf_twin_spire', options: ground(1) },
  // The Golden Gate's towers: the deck runs between their legs, so a column's layers stay apart (its struts
  // under the deck and its portals over it); the plan cuts them at the deck where the bridge stands.
  { id: 'golden-gate#gg_tower_lod0', options: { cell: 1.5, mode: 'stack', gap: 3, cuts: [40, 100, 2] } },
  // The code-made ones.
  { id: 'soup#fred', options: column(0.3) },
  { id: 'soup#pigeon-island', options: column(2) },
  { id: 'soup#summit-lot', options: { ...column(0.5), maxZ: 2 } },
  { id: 'soup#cruise-top', options: column(2) },
];

/** A soup as a geometry. */
function soupGeometry(soup: Soup): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(soup.pos, 3));
  return g;
}

/** The cruise ship's top deck as render draws it (render/landmarks.ts `cruiseShipTop`), in the ship's frame. */
function cruiseTop(): BufferGeometry {
  const b = new MeshBuilder();
  b.addSoup(cruiseShipTopSoup(), new Matrix4());
  for (const slide of CRUISE_SLIDES)
    b.addTube(
      slide.points.map((p) => new Vector3(p[0], p[1], p[2])),
      slide.radius,
      6,
      new Color(slide.hex),
    );
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(b.pos, 3));
  return g;
}

/** The geometry a source's parts are measured from. */
export async function sourceGeometry(id: string): Promise<BufferGeometry> {
  const [head = '', name = ''] = id.split('#');
  if (head === 'soup') {
    if (name === 'fred') return soupGeometry(fredSoup());
    if (name === 'pigeon-island') return soupGeometry(islandSoup());
    if (name === 'summit-lot') return soupGeometry(summitLotSoup(0));
    if (name === 'cruise-top') return cruiseTop();
    throw new Error(`no soup ${name}`);
  }
  const kit = await landmarkKit(head as LandmarkKitId);
  const node = kit.nodes.get(name) ?? kit.nodes.get(`${name}_lod0`);
  if (!node) throw new Error(`${id}: no such node`);
  return node.geometry;
}
