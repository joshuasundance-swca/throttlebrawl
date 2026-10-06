// Pigeon Key (playtest 4, P4-19: "The real roads do not have the characteristics of the roads in
// question"; the identity study's S1): the five-acre island under the old Seven Mile Bridge, where the
// railroad's work camp stood, with its old yellow clapboard cottages and its dock. The cottages and the
// dock are the Seven Mile kit's (`models/scenery/seven-mile-kit`, Codex batch CX2); the island under them is
// code-made here, a low sand and grass plate with a few palms, because the kit has no land.
//
// The island stands BESIDE the old road, at the real point (24.703991 N, 81.155308 W, per the article
// "Pigeon Key"; the bake puts it 48 m off the old road's line), not under the deck: the real bridge
// crosses over the island, but a plate there would meet the old bridge's piers and the repair platforms,
// so the island sits on land of its own in the box the bake gives it (`landmark-clear` keeps it past the
// verge, and the roadside and the boats keep off the box). Presentation only: the sim ignores it.
//
// The soup is in the landmark's own frame, built for a LEFT-hand landmark at `yawDeg` 0: the origin is the
// box's middle at the sea (y = 0), +Y up, +Z along the road, +X away from the road (landmarks.ts turns it
// round for a right-hand one). The cottages face the road, and the dock runs out to the open water.
import { SoupBuilder, type Soup, type V } from './fred';
import type { LandmarkKit } from './models';

/** The island's figures, metres. [default] (a fifth of the real island's area: a game island, not a survey) */
export const PIGEON_KEY = {
  /** Half the island's width across the road, and half its length along it, at the waterline's rim. */
  semiAcrossM: 22,
  semiAlongM: 50,
  /** The top of the ground over the sea, and the rim's depth under it. */
  topY: 0.8,
  rimY: -0.7,
  /** Share of the semi-axes (u) at which the grass top ends, and at which the sand meets the water. */
  topU: 0.78,
  landU: 0.92,
  /** The cottages and the dock: where each kit root stands, and which way it faces (about Y, radians). */
  buildings: [
    { node: 'pigeon_key_cottage_a', x: 1, z: -18, yaw: -Math.PI / 2 },
    { node: 'pigeon_key_cottage_b', x: 1, z: 14, yaw: -Math.PI / 2 },
    { node: 'pigeon_key_dock', x: 17, z: -18, yaw: -Math.PI / 2 },
  ],
  /** The palms' feet (x across, z along). */
  palms: [
    [-12, -34],
    [13, -33],
    [-14, -4],
    [14, 2],
    [-11, 31],
    [12, 33],
  ],
} as const;

const SAND_WET = '#b9a77e';
const SAND = '#dccb9a';
const SAND_DRY = '#d2c093';
const GRASS = '#7c9a5c';
const GRASS_DARK = '#6c8a52';
const TRUNK = '#6a5848';
const FROND = '#4f8a4a';
const FROND_LIGHT = '#62a05a';

const SIDES = 36;

/** Where a point at ring `u` (a share of the semi-axes) and angle `k` stands, in plan. */
const ringAt = (u: number, k: number): readonly [number, number] => {
  const phi = (k / SIDES) * Math.PI * 2;
  return [Math.cos(phi) * PIGEON_KEY.semiAcrossM * u, Math.sin(phi) * PIGEON_KEY.semiAlongM * u];
};

/** The ground: the rings from the sunk rim up to the grass, then a fan over the grass. */
const RINGS: readonly { u: number; y: number; hex: string }[] = [
  { u: 1, y: PIGEON_KEY.rimY, hex: SAND_WET },
  { u: PIGEON_KEY.landU, y: 0, hex: SAND },
  { u: 0.84, y: 0.45, hex: SAND_DRY },
  { u: PIGEON_KEY.topU, y: PIGEON_KEY.topY, hex: GRASS },
];

/** The island's ground, scrub and palms, in the landmark's frame (the buildings are the kit's). */
export function islandSoup(): Soup {
  const b = new SoupBuilder();
  const at = (u: number, k: number, y: number): V => {
    const [x, z] = ringAt(u, k);
    return [x, y, z];
  };
  for (let i = 0; i + 1 < RINGS.length; i++) {
    const outer = RINGS[i] as (typeof RINGS)[number];
    const inner = RINGS[i + 1] as (typeof RINGS)[number];
    for (let k = 0; k < SIDES; k++) {
      const hex = inner.hex;
      const a = at(outer.u, k, outer.y);
      const c = at(outer.u, k + 1, outer.y);
      const d = at(inner.u, k, inner.y);
      const e = at(inner.u, k + 1, inner.y);
      b.up(a, c, e, hex);
      b.up(a, e, d, hex);
    }
  }
  const top = RINGS[RINGS.length - 1] as (typeof RINGS)[number];
  for (let k = 0; k < SIDES; k++)
    b.up([0, top.y, 0], at(top.u, k, top.y), at(top.u, k + 1, top.y), k % 4 === 0 ? GRASS_DARK : GRASS);
  // Palms: a leaning trunk and two drooping tiers of fronds.
  PIGEON_KEY.palms.forEach(([x, z], i) => {
    const lean = 0.5 + 0.12 * (i % 3);
    const h = 5.2 + 0.5 * (i % 2);
    const sway = i % 2 === 0 ? 1 : -1;
    const top3: V = [x + lean * sway, PIGEON_KEY.topY + h, z];
    b.frustum([x, PIGEON_KEY.topY - 0.1, z], 0.2, top3, 0.09, 5, TRUNK);
    b.frustum([top3[0], top3[1] - 0.9, top3[2]], 2.5, [top3[0], top3[1] + 0.3, top3[2]], 0, 7, FROND);
    b.frustum([top3[0], top3[1] - 0.2, top3[2]], 1.5, [top3[0], top3[1] + 0.9, top3[2]], 0, 6, FROND_LIGHT);
  });
  return b.soup;
}

/** A building of the island, placed: its kit node, where it stands and the ground corners it covers. */
export interface PlacedBuilding {
  node: string;
  /** Where its origin stands on the island (x across the road, z along it) and its turn about Y. */
  x: number;
  z: number;
  yaw: number;
  /** The height its origin stands at over the sea. */
  baseY: number;
  /** The four corners of its footprint (the node's bounding box on the ground), x and z. */
  corners: [number, number][];
  centre: [number, number];
}

export interface PigeonKeyPlan {
  topY: number;
  buildings: PlacedBuilding[];
  palms: readonly (readonly [number, number])[];
  /** Whether a point (x across, z along) is on the grass top, and whether it is on the island above the water. */
  insideTop(x: number, z: number): boolean;
  insideLand(x: number, z: number): boolean;
}

const inside = (u: number) => (x: number, z: number) =>
  (x / (PIGEON_KEY.semiAcrossM * u)) ** 2 + (z / (PIGEON_KEY.semiAlongM * u)) ** 2 <= 1;

/**
 * Where the kit's cottages and dock stand on the island, from the kit's own nodes (their bounding
 * boxes give the footprints). A node the kit lacks is left out; a kit with no cottage has no island's
 * buildings to plan.
 */
export function pigeonKeyPlan(kit: LandmarkKit): PigeonKeyPlan {
  const buildings: PlacedBuilding[] = [];
  for (const spec of PIGEON_KEY.buildings) {
    const node = kit.nodes.get(spec.node);
    if (!node) continue;
    node.geometry.computeBoundingBox();
    const box = node.geometry.boundingBox;
    if (!box) continue;
    const cos = Math.cos(spec.yaw);
    const sin = Math.sin(spec.yaw);
    // The node's frame to the island's: x' = x + lx cos + lz sin, z' = z - lx sin + lz cos (a turn about Y).
    const world = (lx: number, lz: number): [number, number] => [
      spec.x + lx * cos + lz * sin,
      spec.z - lx * sin + lz * cos,
    ];
    const corners: [number, number][] = [
      world(box.min.x, box.min.z),
      world(box.max.x, box.min.z),
      world(box.max.x, box.max.z),
      world(box.min.x, box.max.z),
    ];
    const isDock = spec.node === 'pigeon_key_dock';
    buildings.push({
      node: spec.node,
      x: spec.x,
      z: spec.z,
      yaw: spec.yaw,
      baseY: isDock ? 0 : PIGEON_KEY.topY,
      corners,
      centre: world((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2),
    });
  }
  return {
    topY: PIGEON_KEY.topY,
    buildings,
    palms: PIGEON_KEY.palms,
    insideTop: inside(PIGEON_KEY.topU),
    insideLand: inside(PIGEON_KEY.landU),
  };
}
