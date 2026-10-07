// Where each landmark stands (playtest 3: "real landmarks"; the physical world, the maintainer, 2026-10-06).
// A road file's `landmark` feature names a node of a landmark kit (`<asset id>#<node>`) and a footprint; this
// is render/landmarks.ts's placement of it, moved here unchanged so the structure plan (landmarks.ts beside
// this file) and render read one rule: render draws each node where this puts it, and the plan stands its
// solid parts there. It is small and in no first load: render's landmark chunk and the plan's lazy planner
// both import it.
//
// Pure + - * / and core math, like the rest of road/.
import { atan2, cos, PI, sin } from '../../core';
import type { RoadNetwork } from '../network';
import { landmarkParams, type BakedFeature, type LandmarkParams } from '../types';

/** The landmark kits this build knows (render/models.ts `LANDMARK_KITS`; landmarks.test.ts holds them equal). */
export const LANDMARK_KIT_IDS = [
  'golden-gate',
  'keys-landmarks',
  'sf-landmarks',
  'pdx-landmarks',
  'gorge-landmarks',
  'seven-mile-kit',
  'keys-identity',
] as const;
export type LandmarkKitName = (typeof LANDMARK_KIT_IDS)[number];

const LANDMARK_PREFIX = 'models/landmarks/';
/** Landmark kits that live under `models/scenery/` (render/models.ts `SCENERY_LANDMARK_KITS`). */
const SCENERY_LANDMARK_KITS: Readonly<Partial<Record<LandmarkKitName, string>>> = {
  'seven-mile-kit': 'models/scenery/seven-mile-kit',
  'keys-identity': 'models/scenery/keys-identity',
};

/** A landmark kit's asset id (render/models.ts `landmarkKitAsset`). */
export const landmarkKitAssetId = (kit: LandmarkKitName): string =>
  SCENERY_LANDMARK_KITS[kit] ?? `${LANDMARK_PREFIX}${kit}`;

/**
 * A feature's `model` (`<asset id>#<node>`, or `<kit>#<node>`) split into its kit and node, or null when it
 * names no node or a kit this list does not know (render/models.ts `parseLandmarkModel`, the same rule).
 */
export function parseLandmark(model: string | null): { kit: LandmarkKitName; node: string } | null {
  if (!model) return null;
  const at = model.indexOf('#');
  if (at <= 0 || at === model.length - 1) return null;
  const head = model.slice(0, at);
  const short =
    LANDMARK_KIT_IDS.find((k) => landmarkKitAssetId(k) === head) ??
    (head.startsWith(LANDMARK_PREFIX) ? head.slice(LANDMARK_PREFIX.length) : head);
  const kit = LANDMARK_KIT_IDS.find((k) => k === short);
  return kit ? { kit, node: model.slice(at + 1) } : null;
}

/** One `landmark` feature as the road puts it in the world. */
export interface LandmarkPlace {
  feature: BakedFeature;
  edge: number;
  kit: LandmarkKitName;
  node: string;
  params: LandmarkParams;
  /** Where the node's origin stands, in world metres. */
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical (radians): the road's heading at the centre plus the feature's `yawDeg`. */
  yaw: number;
  scale: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Every landmark feature of a network that names a node of a known kit, placed: its origin at the
 * footprint's centre (or `params.frontM` ahead of it, along its +Z), its +Z along the road. Its height is the
 * road's surface there, or `params.baseY` (world metres) when it says so: a tower that rises from the water
 * says 0. Features that name no model, or a kit this build does not know, are left out.
 */
export function landmarkPlaces(road: RoadNetwork): LandmarkPlace[] {
  const out: LandmarkPlace[] = [];
  for (const e of road.edges) {
    for (const feature of road.featuresOf(e.index, 'landmark')) {
      const params = landmarkParams(feature);
      const model = parseLandmark(params.model);
      if (!model) continue;
      const s = (feature.s0 + feature.s1) / 2;
      const d = (feature.d0 + feature.d1) / 2;
      const at = road.toWorld(e.index, s, d, 0);
      const frame = road.frameAt(e.index, s);
      const baseY = feature.params?.['baseY'];
      // The model's local +Z lies along the road's +s: the angle about Y that turns +Z onto (tx, tz).
      const yaw = atan2(frame.tx, frame.tz) + (params.yawDeg * PI) / 180;
      // `frontM` (playtest 4, P4-19; a church's origin is its facade, with the nave behind it): the origin
      // stands this far ahead of the footprint's middle along the model's +Z.
      const frontM = feature.params?.['frontM'];
      const ahead = finite(frontM) ? frontM * params.scale : 0;
      out.push({
        feature,
        edge: e.index,
        kit: model.kit,
        node: model.node,
        params,
        x: at.x + sin(yaw) * ahead,
        y: finite(baseY) ? baseY : at.y,
        z: at.z + cos(yaw) * ahead,
        yaw,
        scale: params.scale,
      });
    }
  }
  return out;
}

/**
 * Circles that cover the landmarks' footprints on the ground, for the roadside layers to keep off (render's
 * `reserved`, and the Old Town plan's). A structure the road runs through or under (`overRoad`) stands on the
 * road or in the water and takes no ground.
 */
export function landmarkGround(road: RoadNetwork): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const e of road.edges) {
    for (const f of road.featuresOf(e.index, 'landmark')) {
      if (landmarkParams(f).overRoad || !parseLandmark(landmarkParams(f).model)) continue;
      const along = f.s1 - f.s0;
      const across = Math.abs(f.d1 - f.d0);
      if (!(along > 0) || !(across > 0)) continue;
      const lengthwise = along >= across;
      const long = Math.max(along, across);
      const short = Math.min(along, across);
      const n = Math.min(12, Math.max(1, Math.ceil(long / short)));
      const cell = long / n;
      const r = Math.sqrt((cell / 2) * (cell / 2) + (short / 2) * (short / 2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * cell;
        const p = lengthwise
          ? road.toWorld(e.index, f.s0 + t, (f.d0 + f.d1) / 2, 0)
          : road.toWorld(e.index, (f.s0 + f.s1) / 2, Math.min(f.d0, f.d1) + t, 0);
        out.push({ x: p.x, z: p.z, r });
      }
    }
  }
  return out;
}
