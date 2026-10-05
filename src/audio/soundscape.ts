// Regional soundscapes (run W-Q "career and freedom", audio lane; playtest 2, 2026-10-02: "different
// stations and music in different regions", "unique regional flavor everywhere"). Each region has a
// sound of its own under the engine and the music, driven by where the rider is on the road:
// - the Keys: expansion-joint thumps on a bridge, one at every joint, so the rate tells your speed
//   (and the gap between the front and rear wheel's thump closes as you speed up); gulls over the
//   water and the marinas, and sailboat halyards clinking in the marinas;
// - the Pacific Northwest: rain pattering on the helmet (harder the faster you go), and a log
//   truck's engine brake, from a truck that is really near and now and then from up the road;
// - San Francisco: a two-tone foghorn from across the bay, more often in the fog, and cable-car
//   bells ONLY on a cable-line stretch (a rider on one, or a cable car that stands on one);
// - a party street (playtest 4, P4-16: Duval): bar music from the open fronts, where a roadside zone
//   names a style (`params.music`): a phrase after phrase, swelling as the rider comes up to the zone.
//
// This file is the director: pure decisions from the road under the rider, no audio nodes
// (soundscape-voices.ts makes the sounds). Timers run on the audio clock and a seeded generator,
// so a test can drive it; presentation only, nothing here reaches the sim.

export type ScapeRegion = 'keys' | 'pnw' | 'sf';

/** A region id as the content registry names it (`florida-keys`, ...), or null for none/unknown. */
export function scapeRegionOf(regionId: string | null): ScapeRegion | null {
  if (!regionId) return null;
  const id = regionId.slice(regionId.indexOf(':') + 1).toLowerCase();
  if (id.includes('keys')) return 'keys';
  if (id.includes('northwest') || id === 'pnw') return 'pnw';
  if (id.includes('francisco') || id === 'sf') return 'sf';
  return null;
}

/** Metres between a bridge's expansion joints [default]: about 40 ft, the Overseas Highway's span. */
export const JOINT_SPACING_M = 12.2;
/** The wheelbase the second thump of each joint trails the first by, m [default]. */
export const WHEELBASE_M = 1.45;
/** A cable car this close rings its bell, m [default]. */
export const CABLE_BELL_RANGE_M = 90;
/** A log truck this close brakes for the bend, m [default]. */
export const LOG_TRUCK_RANGE_M = 110;

/** The styles of bar music the voices can play (a party zone's `params.music`). */
export const BAR_STYLES = ['cover-band', 'steel-drum', 'karaoke'] as const;
export type BarStyle = (typeof BAR_STYLES)[number];
/** One bar's phrase lasts this long, s (four beats at 160 a minute) [default]. */
export const BAR_PHRASE_S = 1.5;
/** A phrase is handed over this long before it starts, so it is scheduled on the audio clock, s. */
export const BAR_LOOKAHEAD_S = 0.25;
/** The music is heard this far outside its zone's ends, fading, m [default]. */
export const BAR_FADE_M = 60;
/** Quieter than this, and nothing is played. */
export const BAR_MIN_LEVEL = 0.05;

/** The bar music under a position: its style, and how loud (1 inside the zone, fading outside). */
export interface BarMusic {
  style: BarStyle;
  level: number;
}

export type ScapeEvent =
  | { kind: 'joint'; level: number; wheelGapS: number }
  | { kind: 'gull'; level: number; pitch: number }
  | { kind: 'halyard'; level: number; pitch: number }
  | { kind: 'engineBrake'; level: number; distant: boolean }
  | { kind: 'foghorn'; level: number }
  | { kind: 'bell'; level: number; strikes: number }
  /** One phrase of a bar's music, to start at `at` on the audio clock; `bar` counts phrases (the variation). */
  | { kind: 'barMusic'; level: number; style: BarStyle; at: number; bar: number };

export interface ScapeNear {
  id: number;
  contentId: string;
  distanceM: number;
  /** The scenery tags under it (cable cars are checked against `cable-line`). */
  tags: ReadonlySet<string>;
}

export interface ScapeInput {
  /** The audio clock, s. */
  t: number;
  region: ScapeRegion | null;
  speedMps: number;
  /** Where the rider is on its road: the edge, and metres along it. */
  edge: number;
  s: number;
  /** On the road surface (not airborne, tumbling or running). */
  grounded: boolean;
  /** The scenery tags over the rider's position, any side. */
  tags: ReadonlySet<string>;
  /** Nearby vehicles (traffic), nearest first. */
  near: readonly ScapeNear[];
  /** The bar music under the rider (`musicAt`), or none. */
  music?: BarMusic | null;
  /** A dry race (playtest 4): no rain on the helmet. Absent: the region's own weather. */
  dry?: boolean;
}

export interface ScapeFrame {
  events: ScapeEvent[];
  /** The rain on the helmet, 0..1 (0 = none). */
  rain: number;
}

/** A small seeded generator (mulberry32), so a test can drive the same ambience twice. */
export function scapeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the soundscape reads of the road: each edge's scenery tags (a `RoadNetwork` fits). */
export interface ScapeRoad {
  readonly edges: readonly {
    readonly tags: readonly { s0: number; s1: number; tag: string }[];
    /** The edge's features (a party zone names its music in `params.music`). */
    readonly features?: readonly {
      readonly kind: string;
      readonly id?: string;
      readonly s0: number;
      readonly s1: number;
      readonly params?: Readonly<Record<string, unknown>> | undefined;
    }[];
  }[];
}

const NO_TAGS: ReadonlySet<string> = new Set();

/** The scenery tags over `s` on `edge`, any side; empty when the road or edge is unknown. */
export function tagsAt(road: ScapeRoad | null, edge: number, s: number): ReadonlySet<string> {
  const tags = road?.edges[edge]?.tags;
  if (!tags || tags.length === 0) return NO_TAGS;
  let out: Set<string> | null = null;
  for (const t of tags) if (s >= t.s0 && s <= t.s1) (out ??= new Set()).add(t.tag);
  return out ?? NO_TAGS;
}

/**
 * The bar music under a position (playtest 4, P4-16): a `roadsideZone` whose `params.music` names a
 * style is a bar's frontage, heard at full inside its s range and fading to nothing over BAR_FADE_M
 * outside it; where two reach, the louder. Null for no road, no zone, a style the voices lack, or out
 * of earshot.
 */
export function musicAt(road: ScapeRoad | null, edge: number, s: number): BarMusic | null {
  const features = road?.edges[edge]?.features;
  if (!features) return null;
  let best: BarMusic | null = null;
  for (const f of features) {
    if (f.kind !== 'roadsideZone') continue;
    const style = f.params?.['music'];
    if (typeof style !== 'string' || !(BAR_STYLES as readonly string[]).includes(style)) continue;
    const away = s < f.s0 ? f.s0 - s : s > f.s1 ? s - f.s1 : 0;
    if (away >= BAR_FADE_M) continue;
    const level = (1 - away / BAR_FADE_M) ** 1.5;
    if (level > (best?.level ?? 0)) best = { style: style as BarStyle, level };
  }
  return best;
}

const WET = ['water-open', 'water-shallow', 'marina', 'beach', 'bridge', 'causeway'] as const;
const hasAny = (tags: ReadonlySet<string>, names: readonly string[]) => names.some((n) => tags.has(n));
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** The gain a sound `d` metres away keeps: 1 close, fading to 0 at `maxM`. */
const near01 = (d: number, maxM: number) => clamp01(1 - d / maxM) ** 1.5;

export interface Director {
  step(input: ScapeInput): ScapeFrame;
  /** Forget the road under the rider (a new race, a respawn). */
  reset(): void;
}

export function createDirector(seed = 0x5ca9e): Director {
  const rnd = scapeRandom(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  let region: ScapeRegion | null = null;
  let lastEdge = -1;
  let lastS = 0;
  /** Next time each timed ambience may fire, on the audio clock. */
  let nextGull = 0;
  let nextHalyard = 0;
  let nextBrake = 0;
  let nextFog = 0;
  let nextBell = 0;
  /** When the next phrase of bar music starts (the audio clock), or -1 for none yet, and how many have played. */
  let nextBar = -1;
  let barCount = 0;
  /** When each log truck or cable car last sounded, by entity id. */
  const lastNear = new Map<number, number>();

  const arm = (t: number) => {
    nextGull = t + between(2, 6);
    nextHalyard = t + between(1, 4);
    nextBrake = t + between(12, 26);
    nextFog = t + between(6, 16);
    nextBell = t + between(1, 4);
    nextBar = -1;
    lastNear.clear();
  };

  return {
    reset() {
      region = null;
      lastEdge = -1;
      nextBar = -1;
    },
    step(i) {
      const events: ScapeEvent[] = [];
      if (i.region !== region) {
        region = i.region;
        arm(i.t);
        lastEdge = -1;
      }
      if (!region) return { events, rain: 0 };
      const speed = Math.max(0, Number.isFinite(i.speedMps) ? i.speedMps : 0);

      if (region === 'keys') {
        // Joints: every crossing of a multiple of the spacing, on a bridge only, rolling on the road.
        const onBridge = i.tags.has('bridge') && i.grounded;
        if (onBridge && i.edge === lastEdge && speed > 2) {
          const a = Math.floor(lastS / JOINT_SPACING_M);
          const b = Math.floor(i.s / JOINT_SPACING_M);
          // A teleport (a respawn, a split handover) is not a run of joints.
          if (a !== b && Math.abs(i.s - lastS) < 3 * JOINT_SPACING_M) {
            const level = 0.3 + 0.7 * clamp01(speed / 40);
            const wheelGapS = Math.min(0.2, Math.max(0.025, WHEELBASE_M / speed));
            for (let k = 0; k < Math.min(3, Math.abs(b - a)); k++)
              events.push({ kind: 'joint', level, wheelGapS });
          }
        }
        if (hasAny(i.tags, WET) && i.t >= nextGull) {
          events.push({ kind: 'gull', level: between(0.5, 1), pitch: between(0.85, 1.2) });
          nextGull = i.t + between(5, 13);
        } else if (i.t >= nextGull) nextGull = i.t + between(2, 5);
        if (i.tags.has('marina') && i.t >= nextHalyard) {
          const clinks = 3 + Math.floor(rnd() * 4);
          for (let k = 0; k < clinks; k++)
            events.push({ kind: 'halyard', level: between(0.35, 1), pitch: between(0.8, 1.35) });
          nextHalyard = i.t + between(2.5, 6);
        } else if (i.t >= nextHalyard) nextHalyard = i.t + between(1, 3);
        // A party street's open fronts: a phrase after phrase, each on the clock where the last ended, so
        // the beat holds; a long gap (a respawn, a pause) starts again from now, never in a burst.
        const bar = i.music;
        if (bar && i.grounded && bar.level >= BAR_MIN_LEVEL) {
          if (nextBar < 0 || i.t > nextBar + BAR_PHRASE_S) nextBar = i.t;
          if (i.t + BAR_LOOKAHEAD_S >= nextBar) {
            events.push({
              kind: 'barMusic',
              level: bar.level,
              style: bar.style,
              at: nextBar,
              bar: barCount++,
            });
            nextBar += BAR_PHRASE_S;
          }
        }
      }

      let rain = 0;
      if (region === 'pnw') {
        // Rain on the helmet: a steady patter, harder with speed; softer when off the bike.
        if (!i.dry) rain = i.grounded ? 0.45 + 0.55 * clamp01(speed / 35) : 0.25;
        for (const n of i.near) {
          if (!n.contentId.includes('log-truck') || n.distanceM > LOG_TRUCK_RANGE_M) continue;
          if (i.t - (lastNear.get(n.id) ?? -99) < 30) continue;
          lastNear.set(n.id, i.t);
          events.push({ kind: 'engineBrake', level: near01(n.distanceM, LOG_TRUCK_RANGE_M), distant: false });
        }
        if (i.t >= nextBrake) {
          // Up the road, among the trees: only where there are trees.
          if (i.tags.has('forest'))
            events.push({ kind: 'engineBrake', level: between(0.2, 0.35), distant: true });
          nextBrake = i.t + between(20, 45);
        }
      }

      if (region === 'sf') {
        if (i.t >= nextFog) {
          const fog = i.tags.has('fog');
          events.push({ kind: 'foghorn', level: fog ? between(0.7, 1) : between(0.35, 0.6) });
          nextFog = i.t + (fog ? between(14, 24) : between(24, 40));
        }
        // Bells: only on a cable street. A cable car that stands on one rings for its distance;
        // a rider on one hears the line's own car now and then.
        for (const n of i.near) {
          if (!n.contentId.includes('cable-car') || !n.tags.has('cable-line')) continue;
          if (n.distanceM > CABLE_BELL_RANGE_M) continue;
          if (i.t - (lastNear.get(n.id) ?? -99) < 5) continue;
          lastNear.set(n.id, i.t);
          events.push({
            kind: 'bell',
            level: 0.25 + 0.75 * near01(n.distanceM, CABLE_BELL_RANGE_M),
            strikes: 2,
          });
        }
        if (i.tags.has('cable-line')) {
          if (i.t >= nextBell) {
            events.push({ kind: 'bell', level: between(0.3, 0.5), strikes: 2 });
            nextBell = i.t + between(7, 13);
          }
        } else if (i.t >= nextBell) nextBell = i.t + between(1, 3);
      }

      lastEdge = i.edge;
      lastS = i.s;
      return { events, rain };
    },
  };
}
