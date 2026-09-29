#!/usr/bin/env node
// Bakes the walking skeleton's placeholder track (M1 app-1) into the baked road format
// (docs/content-packs.md, "Road networks, roads and routes"): three edges joined end to end by
// pass-through junctions, gentle curves, one bridge hump, one lane each way plus shoulders.
//
// road-1 replaces this with the real compiler (Catmull-Rom control points) and the real ~3.5 km
// track. The output format is the contract; this script is a stopgap. It is an offline tool, so
// it may use Math.sin: the runtime only reads the baked numbers.
//
//   node tools/road/bake-skeleton.mjs && npx prettier --write packs/base/regions
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = path.join(root, 'packs/base/regions/florida-keys');
const NETWORK = 'keys-m1';
const SPACING = 2;
const STEP = 0.25; // integration step, metres

const LANES = [
  { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.15, widthM: 1.5, direction: 1, kind: 'shoulder' },
];

// Curvature is a list of [length, kappaStart, kappaEnd] ramps; a hump is [centreS, lengthM, heightM].
const ROADS = [
  {
    id: 'm1-marina-run',
    name: 'Marina Run',
    length: 800,
    kappa: [
      [150, 0, 0],
      [50, 0, 1 / 450],
      [150, 1 / 450, 1 / 450],
      [50, 1 / 450, 0],
      [100, 0, 0],
      [50, 0, -1 / 500],
      [150, -1 / 500, -1 / 500],
      [50, -1 / 500, 0],
      [50, 0, 0],
    ],
    humps: [],
    tags: ['marina', 'palms'],
  },
  {
    id: 'm1-pelican-bridge',
    name: 'Pelican Channel Bridge',
    length: 900,
    kappa: [
      [600, 0, 0],
      [50, 0, 1 / 600],
      [150, 1 / 600, 1 / 600],
      [50, 1 / 600, 0],
      [50, 0, 0],
    ],
    humps: [[300, 360, 5]],
    tags: ['bridge', 'water-open'],
  },
  {
    id: 'm1-sandbar-causeway',
    name: 'Sandbar Causeway',
    length: 800,
    kappa: [
      [100, 0, 0],
      [50, 0, -1 / 420],
      [200, -1 / 420, -1 / 420],
      [50, -1 / 420, 0],
      [400, 0, 0],
    ],
    humps: [],
    tags: ['causeway', 'water-shallow'],
  },
];

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r7 = (v) => Number(v.toPrecision(7));

function kappaAt(road, s) {
  let at = 0;
  for (const [len, k0, k1] of road.kappa) {
    if (s <= at + len) return k0 + ((k1 - k0) * (s - at)) / len;
    at += len;
  }
  return 0;
}

function elevationAt(road, s, base) {
  let y = base;
  let g = 0;
  for (const [centre, len, height] of road.humps) {
    const u = (s - (centre - len / 2)) / len;
    if (u > 0 && u < 1) {
      y += (height * (1 - Math.cos(2 * Math.PI * u))) / 2;
      g += (height * Math.PI * Math.sin(2 * Math.PI * u)) / len;
    }
  }
  return [y, g];
}

let x = 0;
let z = 0;
let heading = 0; // radians, 0 = north (-z), increasing toward east: a right turn
const BASE_Y = 1.5;
const bakedRoads = [];
const junctions = [];

for (const [n, road] of ROADS.entries()) {
  const intervals = Math.round(road.length / SPACING);
  const spacing = road.length / intervals;
  const cols = { x: [], y: [], z: [], kappa: [], grade: [], bankRad: [] };
  const push = (s) => {
    const [y, g] = elevationAt(road, s, BASE_Y);
    cols.x.push(r4(x));
    cols.y.push(r4(y));
    cols.z.push(r4(z));
    cols.kappa.push(r7(kappaAt(road, s)));
    cols.grade.push(r7(g));
    cols.bankRad.push(0);
  };
  const junctionId = `j-m1-${n}`;
  junctions.push({ id: junctionId, at: [x, elevationAt(road, 0, BASE_Y)[0], z] });
  push(0);
  let s = 0;
  for (let i = 1; i <= intervals; i++) {
    const target = i * spacing;
    while (s < target - 1e-9) {
      const h = Math.min(STEP, target - s);
      // Midpoint rule: heading turns by kappa per metre.
      const mid = heading + (kappaAt(road, s + h / 2) * h) / 2;
      x += Math.sin(mid) * h;
      z += -Math.cos(mid) * h;
      heading += kappaAt(road, s + h / 2) * h;
      s += h;
    }
    push(target);
  }
  bakedRoads.push({
    type: 'road',
    id: road.id,
    name: road.name,
    realName: null,
    network: NETWORK,
    from: junctionId,
    to: `j-m1-${n + 1}`,
    lengthM: road.length,
    sampleSpacingM: spacing,
    speedLimitMps: 24.6,
    surface: 'asphalt',
    laneSections: [{ s0: 0, lanes: LANES }],
    tags: road.tags.map((tag) => ({ s0: 0, s1: road.length, side: 'both', tag })),
    features: [],
    samples: { encoding: 'json-columns', columns: Object.keys(cols), data: cols },
    provenance: { origin: 'agent', author: 'agent', createdAt: '2026-09-29', sources: [] },
    meta: {
      status: 'live',
      notes:
        'Walking-skeleton placeholder baked by tools/road/bake-skeleton.mjs. road-1 replaces it with the real M1 track.',
    },
  });
}
junctions.push({ id: `j-m1-${ROADS.length}`, at: [x, BASE_Y, z] });

const network = {
  type: 'road-network',
  id: NETWORK,
  name: 'Keys M1 skeleton (hand-authored placeholder)',
  region: 'florida-keys',
  crs: { kind: 'tmerc', originLatDeg: 24.7, originLonDeg: -81.1, originElevM: 0 },
  chunking: { kind: 'none' },
  roads: ROADS.map((r) => r.id),
  junctions: junctions.map((j, i) => ({
    id: j.id,
    x: r4(j.at[0]),
    y: r4(j.at[1]),
    z: r4(j.at[2]),
    ends: [
      ...(i > 0 ? [{ road: ROADS[i - 1].id, end: 'to' }] : []),
      ...(i < ROADS.length ? [{ road: ROADS[i].id, end: 'from' }] : []),
    ],
    connectors: [],
    control: 'none',
  })),
  provenance: { origin: 'agent', author: 'agent', createdAt: '2026-09-29', sources: [] },
  meta: {
    status: 'live',
    notes: 'Three roads joined end to end by pass-through junctions (two ends, no connectors).',
  },
};

const route = {
  type: 'route',
  id: 'm1-skeleton-sprint',
  network: NETWORK,
  start: { road: ROADS[0].id, s: 40, dir: 1 },
  finish: { road: ROADS[2].id, s: 760 },
  mainPath: ROADS.map((r) => r.id),
  allowedRoads: ROADS.map((r) => r.id),
  checkpoints: [{ road: ROADS[1].id, s: 450 }],
  closed: false,
  startGrid: { rows: 3, perRow: 2, rowGapM: 8 },
  meta: { status: 'live' },
};

const write = (dir, id, value) => {
  mkdirSync(path.join(region, dir), { recursive: true });
  writeFileSync(path.join(region, dir, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
};
write('networks', network.id, network);
for (const r of bakedRoads) write('roads', r.id, r);
write('routes', route.id, route);
console.log(`baked ${bakedRoads.length} roads, 1 network, 1 route into ${path.relative(root, region)}`);
