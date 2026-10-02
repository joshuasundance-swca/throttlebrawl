// The riders (tools/blender/riders/README.md): one row per rider model. Each GLB is built by
// build_rider.py from its costume in cast.py, uploaded to the Hugging Face dataset repo and pinned in
// assets.lock.json (it is not committed: real models load per region, interview 2026-10-02). The
// dataset path is `<pack>/models/riders/<id>.glb`, so its asset id is `models/riders/<id>`, which
// the game asks for by the rider's content id (src/render/riders).

/** @typedef {{ id: string, pack: string, region?: string, maxTris: number }} RiderRow */

const BUDGET = 1800;

/** @type {RiderRow[]} */
export const RIDERS = [
  { id: 'player', pack: 'base', maxTris: BUDGET },
  { id: 'deacon-vane', pack: 'base', maxTris: BUDGET },
  { id: 'chad-speedwell', pack: 'base', maxTris: BUDGET },
  { id: 'tammy-two-stroke', pack: 'base', maxTris: BUDGET },
  { id: 'kevin-from-accounting', pack: 'base', maxTris: BUDGET },
  { id: 'mother-rust', pack: 'base', maxTris: BUDGET },
  { id: 'dial-up', pack: 'base', maxTris: BUDGET },
  { id: 'the-mayor', pack: 'base', maxTris: BUDGET },
  { id: 'sgt-pruitt', pack: 'base', maxTris: BUDGET },
  { id: 'trooper-dalrymple', pack: 'base', maxTris: BUDGET },
  { id: 'deputy-lindqvist', pack: 'region-pnw', region: 'pacific-northwest', maxTris: BUDGET },
  { id: 'juniper-moss', pack: 'region-pnw', region: 'pacific-northwest', maxTris: BUDGET },
  { id: 'old-growth', pack: 'region-pnw', region: 'pacific-northwest', maxTris: BUDGET },
  { id: 'gripman-gus', pack: 'region-sf', region: 'san-francisco', maxTris: BUDGET },
  { id: 'pivot', pack: 'region-sf', region: 'san-francisco', maxTris: BUDGET },
  { id: 'officer-meter', pack: 'region-sf', region: 'san-francisco', maxTris: BUDGET },
];

/** The dataset path of a rider's GLB (assets.lock.json `path`). */
export const datasetPath = (row) => `${row.pack}/models/riders/${row.id}.glb`;
