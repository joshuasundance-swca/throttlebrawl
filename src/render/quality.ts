// Quality tiers and dynamic resolution (roadmap M5, "speed on the A16"; docs/architecture.md,
// "Quality tiers and dynamic resolution"). Smooth first is [decided] (2026-09-29): the display's
// full rate by default, with a softer picture under load. So:
// - the render resolution is a scale of the capped device pixel ratio, stepped down quickly when
//   frames run over the budget and back up slowly when there is room, never below a readable floor;
// - three tiers, as data: each sets the resolution range and how much still scenery it draws: its
//   reach, where its far stand-ins start, the share of trees and ferns, and where the roadside's, the
//   road's and the city blocks' small detail stops (playtest 4 run C: reach alone cut about 3% at the
//   busiest view; scene-cost tests hold `low` at least 25% under `high` at each region's busiest view);
//   `auto` moves between them from measured frame time and remembers the tier per device; the
//   player can pin one in the settings.
// The governor is pure: app/ hands it each drawn frame's interval (the frame-time seam), so tests
// drive it frame by frame, never by the clock. Tiers never touch threats (riders, traffic, cops,
// hazards), the fog or the camera's far plane: only resolution and scenery. All numbers [default];
// none is phone-verified.
import type { RenderParams } from './tuning';

/** The device pixel ratio is capped here (1.5 on phones, as M1 shipped). */
export const MAX_PIXEL_RATIO = 1.5;
/**
 * The readable floor: the scene never draws at fewer than 0.75 device pixels per CSS pixel (about 310
 * rows on a phone's 412 px landscape height, above the PS1's 240). The HUD is DOM, never scaled.
 */
export const READABLE_PIXEL_RATIO = 0.75;

export type QualityTierId = 'low' | 'medium' | 'high';
/** The settings' Graphics row: `auto`, or a pinned tier. */
export type QualitySetting = 'auto' | QualityTierId;
/** Cheapest first. */
export const QUALITY_TIER_ORDER: readonly QualityTierId[] = ['low', 'medium', 'high'];

export interface QualityTier {
  /** The resolution scale's range, of the capped device pixel ratio. */
  minScale: number;
  maxScale: number;
  /** The still scenery's draw distance and far-detail distance, as shares of their sliders. */
  sceneryReach: number;
  lodReach: number;
  /**
   * Where the small detail stops, as a share of its own distances: the roadside props' levels of detail
   * (roadside.ts `levelOf`: the understory to 50 m, the street fronts' full models to 80 m, the middling
   * props to 120 m, then only the big props' far stand-ins out to 200 m) and the road's lane lines and
   * posts (road-mesh.ts ROAD_FINE_DRAW_M, 300 m).
   */
  propDetail: number;
  /**
   * The share of the scatter's trees and brush drawn (scenery-merge.ts `THINNABLE_KINDS`, ranked by where
   * each stands, so a lower tier's trees are a subset of a higher one's). Buildings are never thinned.
   */
  treeShare: number;
  /**
   * Where the city blocks' far stand-ins start, as a share of each layer's own distance: a downtown
   * (downtown.ts, drawn in full out to its 500 m draw distance on `high`) and Chinatown and North Beach
   * (chinatown-northbeach.ts `NEAR_M`, 240 m).
   */
  cityDetail: number;
}

/**
 * `high` is the game as it drew before tiers, with only the resolution free to soften. The cuts, with the
 * scenery sliders at their defaults (360 m reach, far stand-ins from 200 m):
 * - `medium`: reach 324 m; the scatter's far stand-ins from 100 m; 70% of the trees and ferns; the
 *   roadside's understory to 35 m, its street fronts in full to 56 m and its middling props to 84 m; lane
 *   lines and posts to 210 m; the city blocks' stand-ins from 300 m (a downtown) and 144 m (Chinatown).
 * - `low`: reach 288 m; stand-ins from 30 m; 40% of the trees and ferns; understory to 20 m, fronts to
 *   32 m, middling props to 48 m; lane lines to 120 m; city stand-ins from 150 m and 72 m.
 * Buildings, landmarks, signs and boards, the land, the road, the backdrop and everything that moves keep
 * their full count on every tier.
 */
export const QUALITY_TIERS: Readonly<Record<QualityTierId, Readonly<QualityTier>>> = {
  high: {
    minScale: 0.75,
    maxScale: 1,
    sceneryReach: 1,
    lodReach: 1,
    propDetail: 1,
    treeShare: 1,
    cityDetail: 1,
  },
  medium: {
    minScale: 0.6,
    maxScale: 1,
    sceneryReach: 0.9,
    lodReach: 0.5,
    propDetail: 0.7,
    treeShare: 0.7,
    cityDetail: 0.6,
  },
  low: {
    minScale: 0.5,
    maxScale: 0.85,
    sceneryReach: 0.8,
    lodReach: 0.15,
    propDetail: 0.4,
    treeShare: 0.4,
    cityDetail: 0.3,
  },
};

export const QUALITY = {
  /** A race's first seconds (and after a pause) are never judged: shaders compile, chunks load. */
  graceS: 2,
  /** Frame time is judged in windows of this much frame time, ms. */
  windowMs: 500,
  /** A window whose mean frame passes this many budgets is over (about one missed frame in five). */
  overFactor: 1.2,
  /** A window within this many budgets has room. */
  roomFactor: 1.05,
  /** Down by this much a window over budget; up by this after `riseWindows` windows with room. */
  stepDown: 0.1,
  stepUp: 0.05,
  riseWindows: 4,
  /** A rise that misses within this many windows failed: back to where it held. */
  riseCheckWindows: 2,
  /** The wait before trying a failed resolution again doubles, up to this many windows (30 s). */
  maxRetryWindows: 60,
  /** `auto`: windows over budget at the tier's lowest resolution before the tier below. */
  tierDownWindows: 4,
  /** `auto`: windows with room at the tier's highest resolution before the tier above (doubles after a drop). */
  tierUpWindows: 20,
  maxTierUpWindows: 240,
  /** One frame counts as at most this many budgets, so a lone hitch (a chunk loading) is not load. */
  hitchFactor: 3,
  /** Frames per measurement of the display's interval (the fastest such window is the display's). */
  refreshFrames: 30,
} as const;

/** The pixel ratio the scene draws at: the capped device ratio times the scale, floored. */
export function renderPixelRatio(devicePixelRatio: number, scale: number): number {
  const base = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_PIXEL_RATIO);
  return Math.max(Math.min(base, READABLE_PIXEL_RATIO), base * scale);
}

/** How far the still scenery draws, and where its far stand-ins start, on a tier. */
export function sceneryReach(params: Pick<RenderParams, 'sceneryDrawM' | 'sceneryLodM'>, tier: QualityTier) {
  return {
    drawM: params.sceneryDrawM * tier.sceneryReach,
    lodM: params.sceneryLodM * tier.lodReach,
    propDetail: tier.propDetail,
    treeShare: tier.treeShare,
    cityDetail: tier.cityDetail,
  };
}

export interface QualityState {
  tier: QualityTierId;
  scale: number;
}

export interface QualityFrameContext {
  /** A race is running and not paused or held: only its frames are judged. */
  racing: boolean;
  /** The frame-rate cap's divisor (1 full, 2 half, 3 a third): the budget is that many display frames. */
  divisor: number;
}

export interface QualityGovernor {
  /** One drawn frame's interval, ms. Returns the new state on the frame it changes, else null. */
  frame(intervalMs: number, ctx: QualityFrameContext): QualityState | null;
  /** The settings' Graphics row changed. Returns the new state if that changed it, else null. */
  setSetting(setting: QualitySetting): QualityState | null;
  readonly state: Readonly<QualityState>;
  /** The display's measured frame interval, ms (1000/60 until measured). */
  readonly displayMs: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function createQualityGovernor(opts: {
  setting: QualitySetting;
  /** The tier `auto` settled on last time on this device. */
  autoTier?: QualityTierId | null;
}): QualityGovernor {
  const n = QUALITY;
  let setting = opts.setting;
  const startTier = setting === 'auto' ? (opts.autoTier ?? 'high') : setting;
  const state: QualityState = { tier: startTier, scale: QUALITY_TIERS[startTier].maxScale };

  // The display's interval: the fastest window of frames seen, never slower than 60 Hz's.
  let displayMs = 1000 / 60;
  let refSum = 0;
  let refFrames = 0;

  // The judged window, and the race's grace.
  let graceMs = 0;
  let winMs = 0;
  let winFrames = 0;

  let overAtFloor = 0;
  let room = 0;
  // The last rise: windows since it, and the scale it rose from.
  let sinceRise = Infinity;
  let riseFrom = state.scale;
  // A resolution that failed (a rise that missed), and the wait before trying it again.
  let ceiling: number | null = null;
  let retryWait: number = n.riseWindows;
  let tierUpWait: number = n.tierUpWindows;

  const forgetEdges = () => {
    ceiling = null;
    retryWait = n.riseWindows;
    sinceRise = Infinity;
    overAtFloor = 0;
    room = 0;
  };
  const moveTier = (to: QualityTierId) => {
    const t = QUALITY_TIERS[to];
    state.tier = to;
    state.scale = round2(clamp(state.scale, t.minScale, t.maxScale));
    forgetEdges();
  };
  const changed = (): QualityState => ({ ...state });

  /** One window judged: returns true when the state changed. */
  const judge = (meanMs: number, budgetMs: number): boolean => {
    const tier = QUALITY_TIERS[state.tier];
    const index = QUALITY_TIER_ORDER.indexOf(state.tier);
    sinceRise++;
    if (meanMs > budgetMs * n.overFactor) {
      room = 0;
      if (sinceRise <= n.riseCheckWindows) {
        // The last rise missed: back to the scale that held, and wait longer before trying again.
        ceiling = state.scale;
        retryWait = Math.min(n.maxRetryWindows, retryWait * 2);
        state.scale = riseFrom;
        sinceRise = Infinity;
        return true;
      }
      if (state.scale > tier.minScale) {
        state.scale = round2(Math.max(tier.minScale, state.scale - n.stepDown));
        overAtFloor = 0;
        return true;
      }
      overAtFloor++;
      if (setting === 'auto' && index > 0 && overAtFloor >= n.tierDownWindows) {
        tierUpWait = Math.min(n.maxTierUpWindows, tierUpWait * 2);
        moveTier(QUALITY_TIER_ORDER[index - 1] as QualityTierId);
        return true;
      }
      return false;
    }
    overAtFloor = 0;
    if (meanMs > budgetMs * n.roomFactor) {
      room = 0; // close to the budget: hold
      return false;
    }
    room++;
    if (sinceRise === n.riseCheckWindows + 1 && ceiling !== null && state.scale >= ceiling) {
      // The failed resolution held this time: the load has eased.
      ceiling = null;
      retryWait = n.riseWindows;
    }
    if (state.scale < tier.maxScale) {
      const to = round2(Math.min(tier.maxScale, state.scale + n.stepUp));
      const wait = ceiling !== null && to >= ceiling ? retryWait : n.riseWindows;
      if (room < wait) return false;
      riseFrom = state.scale;
      state.scale = to;
      sinceRise = 0;
      room = 0;
      return true;
    }
    if (setting === 'auto' && index < QUALITY_TIER_ORDER.length - 1 && room >= tierUpWait) {
      moveTier(QUALITY_TIER_ORDER[index + 1] as QualityTierId);
      return true;
    }
    return false;
  };

  return {
    frame(intervalMs, ctx) {
      if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) return null;
      const divisor = Math.max(1, Math.round(ctx.divisor) || 1);
      refSum += intervalMs / divisor;
      if (++refFrames >= n.refreshFrames) {
        displayMs = clamp(Math.min(displayMs, refSum / refFrames), 1000 / 240, 1000 / 60);
        refSum = 0;
        refFrames = 0;
      }
      if (!ctx.racing) {
        graceMs = 0;
        winMs = 0;
        winFrames = 0;
        return null;
      }
      if (graceMs < n.graceS * 1000) {
        graceMs += intervalMs;
        return null;
      }
      const budgetMs = displayMs * divisor;
      winMs += Math.min(intervalMs, budgetMs * n.hitchFactor);
      winFrames++;
      if (winMs < n.windowMs) return null;
      const mean = winMs / winFrames;
      winMs = 0;
      winFrames = 0;
      return judge(mean, budgetMs) ? changed() : null;
    },
    setSetting(next) {
      if (next === setting) return null;
      setting = next;
      if (next === 'auto' || next === state.tier) return null;
      moveTier(next);
      return changed();
    },
    get state() {
      return state;
    },
    get displayMs() {
      return displayMs;
    },
  };
}

/** Where `auto`'s tier is kept on this device (a measurement, not a setting). */
const autoTierKey = (keyPrefix: string) => `${keyPrefix}:quality`;

export interface QualityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The tier `auto` settled on last time on this device, or null. Never throws. */
export function loadAutoTier(storage: QualityStorage | null, keyPrefix: string): QualityTierId | null {
  try {
    const raw = storage?.getItem(autoTierKey(keyPrefix));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    const tier = typeof v === 'object' && v !== null ? (v as { tier?: unknown }).tier : null;
    return QUALITY_TIER_ORDER.find((t) => t === tier) ?? null;
  } catch {
    return null;
  }
}

/** Keeps `auto`'s tier for this device's next race. Never throws (storage may be blocked). */
export function saveAutoTier(storage: QualityStorage | null, keyPrefix: string, tier: QualityTierId): void {
  try {
    storage?.setItem(autoTierKey(keyPrefix), JSON.stringify({ tier }));
  } catch {
    // kept in memory only: the next session measures again
  }
}
