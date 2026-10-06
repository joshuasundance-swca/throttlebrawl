import { describe, expect, it } from 'vitest';
import { MIN_THREAT_DRAW_M } from './look';
import {
  createQualityGovernor,
  loadAutoTier,
  QUALITY,
  QUALITY_TIERS,
  QUALITY_TIER_ORDER,
  READABLE_PIXEL_RATIO,
  renderPixelRatio,
  saveAutoTier,
  sceneryReach,
  type QualityGovernor,
  type QualityTierId,
} from './quality';
import { defaultRenderParams } from './tuning';

// Roadmap M5, "speed on the A16" (docs/architecture.md, "Quality tiers and dynamic resolution"): a
// few quality tiers picked from measured frame time, and a render resolution that steps down under
// load and back up when there is room, never below a readable floor; a setting pins a tier. Every
// test drives the governor through its frame-time seam (one frame interval at a time), never the
// clock. The numbers are [default]; none is phone-verified.

const HZ60 = 1000 / 60;
const HZ90 = 1000 / 90;

/**
 * A device model: a frame's work is a fixed part (scaled by the tier's scenery cost) plus a part
 * that grows with the pixels drawn (scale squared); the display shows it at the next refresh, so
 * the interval is a whole number of refreshes, as requestAnimationFrame reports it.
 */
function device(refreshMs: number, fixedMs: number, pixelMs: number) {
  const tierCost: Record<QualityTierId, number> = { high: 1, medium: 0.85, low: 0.7 };
  return (g: QualityGovernor, divisor = 1) => {
    const work = fixedMs * tierCost[g.state.tier] + pixelMs * g.state.scale ** 2;
    return Math.max(divisor, Math.ceil(work / refreshMs - 1e-9)) * refreshMs;
  };
}

interface Run {
  /** Seconds of frame time from the run's start at each change, with the state after it. */
  changes: { atS: number; tier: QualityTierId; scale: number }[];
}

/** Feeds `seconds` of frames from `frameMs` (the device, or a fixed interval) into the governor. */
function run(
  g: QualityGovernor,
  seconds: number,
  frameMs: (g: QualityGovernor) => number,
  ctx = { racing: true, divisor: 1 },
): Run {
  const changes: Run['changes'] = [];
  for (let t = 0; t < seconds * 1000;) {
    const ms = frameMs(g);
    t += ms;
    const changed = g.frame(ms, ctx);
    if (changed) changes.push({ atS: t / 1000, ...changed });
  }
  return { changes };
}

/** The display measured first: a second of light menu frames at the panel's own rate. */
function measured(g: QualityGovernor, refreshMs: number): QualityGovernor {
  run(g, 1, () => refreshMs, { racing: false, divisor: 1 });
  return g;
}

describe('dynamic resolution', () => {
  it('steps down quickly under load, then drops a tier, and never goes below the readable floor', () => {
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    expect(g.state).toEqual({ tier: 'high', scale: QUALITY_TIERS.high.maxScale });
    const r = run(g, 60, () => 50); // 20 fps whatever the resolution
    // The first step down comes within a second of the race's grace ending.
    expect(r.changes[0]?.atS).toBeLessThanOrEqual(QUALITY.graceS + 1);
    expect(r.changes[0]?.scale).toBeLessThan(QUALITY_TIERS.high.maxScale);
    // It ends on the lowest tier at that tier's floor, and the floor stays readable on any screen.
    expect(g.state).toEqual({ tier: 'low', scale: QUALITY_TIERS.low.minScale });
    for (const dpr of [1, 2, 2.625, 3.5]) {
      expect(renderPixelRatio(dpr, g.state.scale)).toBeGreaterThanOrEqual(
        Math.min(dpr, READABLE_PIXEL_RATIO),
      );
    }
    for (const c of r.changes) expect(c.scale).toBeGreaterThanOrEqual(QUALITY_TIERS[c.tier].minScale);
  });

  it('comes back up when there is room, more slowly than it went down', () => {
    const g = measured(createQualityGovernor({ setting: 'high' }), HZ60);
    const down = run(g, 10, () => 40);
    expect(g.state.scale).toBe(QUALITY_TIERS.high.minScale);
    const downS = (down.changes.at(-1)?.atS ?? 0) - (down.changes[0]?.atS ?? 0);
    const up = run(g, 60, () => HZ60);
    expect(g.state.scale).toBe(QUALITY_TIERS.high.maxScale);
    const upS = (up.changes.at(-1)?.atS ?? 0) - (up.changes[0]?.atS ?? 0);
    expect(upS).toBeGreaterThan(downS * 2);
  });

  it('settles near what the device can hold instead of hunting', () => {
    // Fits at 0.85 of full resolution (15.6 ms of work), misses a 60 Hz frame at 0.9 (17 ms).
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    const frame = device(HZ60, 4, 16);
    run(g, 60, frame);
    const late = run(g, 60, frame);
    expect(g.state.tier).toBe('high');
    expect(g.state.scale).toBeGreaterThanOrEqual(0.75);
    expect(g.state.scale).toBeLessThanOrEqual(0.9);
    // Each failed try upward waits longer before the next: a handful of changes a minute at most.
    expect(late.changes.length).toBeLessThanOrEqual(6);
  });

  it('treats a lone hitch (a chunk loading) as no load', () => {
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    let n = 0;
    const r = run(g, 30, () => (++n % 180 === 0 ? 250 : HZ60));
    expect(r.changes).toEqual([]);
  });

  it('changes nothing outside a race or in its first seconds', () => {
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    expect(run(g, 30, () => 60, { racing: false, divisor: 1 }).changes).toEqual([]);
    expect(run(g, QUALITY.graceS * 0.9, () => 60).changes).toEqual([]);
  });
});

describe('the frame budget', () => {
  it('follows the frame-rate cap: half rate on a 60 Hz screen is on budget at 33 ms', () => {
    const capped = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    expect(run(capped, 20, () => 2 * HZ60, { racing: true, divisor: 2 }).changes).toEqual([]);
    const full = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    expect(run(full, 20, () => 2 * HZ60).changes.length).toBeGreaterThan(0);
  });

  it("is the display's full rate (smooth first): a 90 Hz panel held at 60 fps softens", () => {
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ90);
    run(g, 10, () => HZ60);
    expect(g.state.scale).toBeLessThan(QUALITY_TIERS.high.maxScale);
  });

  it('never asks for more than 60 fps on a display it has not measured', () => {
    const g = createQualityGovernor({ setting: 'auto' });
    expect(run(g, 20, () => HZ60).changes).toEqual([]);
  });
});

describe('tiers', () => {
  it('a pinned tier holds under load and with room; only the resolution moves inside it', () => {
    const g = measured(createQualityGovernor({ setting: 'medium' }), HZ60);
    run(g, 30, () => 60);
    expect(g.state).toEqual({ tier: 'medium', scale: QUALITY_TIERS.medium.minScale });
    run(g, 120, () => HZ60);
    expect(g.state).toEqual({ tier: 'medium', scale: QUALITY_TIERS.medium.maxScale });
  });

  it('auto starts on the tier this device settled on, and climbs back when there is room', () => {
    const g = measured(createQualityGovernor({ setting: 'auto', autoTier: 'low' }), HZ60);
    expect(g.state).toEqual({ tier: 'low', scale: QUALITY_TIERS.low.maxScale });
    run(g, 120, () => HZ60);
    expect(g.state.tier).toBe('high');
  });

  it('pinning a tier through the setting applies at once', () => {
    const g = measured(createQualityGovernor({ setting: 'auto' }), HZ60);
    const changed = g.setSetting('low');
    expect(changed).toEqual({ tier: 'low', scale: QUALITY_TIERS.low.maxScale });
    expect(g.setSetting('low')).toBeNull();
  });

  it('a lower tier never costs more: a smaller resolution range and a shorter scenery reach', () => {
    const p = defaultRenderParams();
    for (let i = 1; i < QUALITY_TIER_ORDER.length; i++) {
      const lo = QUALITY_TIERS[QUALITY_TIER_ORDER[i - 1] as QualityTierId];
      const hi = QUALITY_TIERS[QUALITY_TIER_ORDER[i] as QualityTierId];
      expect(lo.minScale).toBeLessThanOrEqual(hi.minScale);
      expect(lo.maxScale).toBeLessThanOrEqual(hi.maxScale);
      expect(sceneryReach(p, lo).drawM).toBeLessThanOrEqual(sceneryReach(p, hi).drawM);
      expect(sceneryReach(p, lo).lodM).toBeLessThanOrEqual(sceneryReach(p, hi).lodM);
      // Playtest 4 run C (punch item 9): and each lower tier cuts real geometry, not only the reach.
      for (const k of ['lodReach', 'propDetail', 'treeShare', 'cityDetail'] as const) {
        expect(lo[k], k).toBeLessThan(hi[k]);
        expect(lo[k], k).toBeGreaterThan(0);
      }
    }
  });

  it('never hides threats: a tier only trims scenery, which stays out past the threat draw distance', () => {
    const p = defaultRenderParams();
    for (const id of QUALITY_TIER_ORDER) {
      const reach = sceneryReach(p, QUALITY_TIERS[id]);
      expect(reach.drawM).toBeGreaterThanOrEqual(MIN_THREAT_DRAW_M);
      expect(reach.drawM).toBeLessThanOrEqual(p.sceneryDrawM);
      expect(reach.lodM).toBeLessThanOrEqual(p.sceneryLodM);
    }
    // The top tier is the game as it drew before tiers: the sliders' own reach.
    expect(sceneryReach(p, QUALITY_TIERS.high)).toEqual({
      drawM: p.sceneryDrawM,
      lodM: p.sceneryLodM,
      propDetail: 1,
      treeShare: 1,
      cityDetail: 1,
    });
  });
});

describe('the render pixel ratio', () => {
  it('caps the device pixel ratio and scales it, floored at the readable ratio', () => {
    expect(renderPixelRatio(2.625, 1)).toBe(1.5);
    expect(renderPixelRatio(1, 1)).toBe(1);
    expect(renderPixelRatio(2.625, 0.6)).toBeCloseTo(0.9);
    expect(renderPixelRatio(1, 0.5)).toBe(READABLE_PIXEL_RATIO);
    // A screen already under the floor is never scaled up past its own pixels.
    expect(renderPixelRatio(0.5, 0.5)).toBe(0.5);
  });
});

describe('the stored auto tier', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };

  it('round-trips per device and ignores anything it does not know', () => {
    const s = memory();
    expect(loadAutoTier(s, 'x')).toBeNull();
    saveAutoTier(s, 'x', 'medium');
    expect(loadAutoTier(s, 'x')).toBe('medium');
    for (const v of ['{', 'null', '{"tier":"ultra"}', '"low"']) {
      s.m.set([...s.m.keys()][0] ?? '', v);
      expect(loadAutoTier(s, 'x')).toBeNull();
    }
  });

  it('never throws when storage does', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAutoTier(broken, 'x')).toBeNull();
    expect(() => saveAutoTier(broken, 'x', 'low')).not.toThrow();
    expect(loadAutoTier(null, 'x')).toBeNull();
  });
});
