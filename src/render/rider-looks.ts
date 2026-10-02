// Which models a rider draws with (interview, 2026-10-02: "Real models now"; real silhouettes per
// rival). The rider model is the rider's own (`models/riders/<id>`, from the dataset repo); the bike
// model comes from the rider file's `look`: `bikeModel` names one of the base pack's bikes
// (`models/bikes/<name>`, PR #300), else `bikeClass` picks that class's bike, else a cop rides the
// police motorcycle and anyone else the bike their sim bike is (the Rustbucket 400 for the player).
// The look's `palette` repaints the bike's paint. Small and static: app/ calls it at race start.

/** The bike each look `bikeClass` (content BIKE_CLASSES) draws when the look names no `bikeModel`. */
export const BIKE_CLASS_MODELS: Readonly<Record<string, string>> = {
  scooter: 'step-through',
  moped: 'moped',
  dirt: 'dirt-bike',
  rat: 'rustbucket-400',
  sport: 'sport-stickered',
  super: 'superbike-1000',
  chopper: 'chopper',
  lawnmower: 'lawnmower',
  'mobility-scooter': 'mobility-scooter',
  'golf-cart': 'golf-cart',
};

/** One rider in a race, as app/ knows it (SimConfig's rider plus its pack file's `look`). */
export interface RiderLookSource {
  /** The rider's content id as the snapshot carries it (qualified, e.g. `base:deacon-vane`). */
  contentId: string;
  role: 'player' | 'rival' | 'cop' | 'extra';
  /** The sim bike's content id (qualified). */
  bikeId: string;
  /** The rider file's `look` block, unchecked (presentation data). */
  look?: unknown;
}

export interface RiderLook {
  contentId: string;
  /** Asset ids. */
  riderModel: string;
  bikeModel: string;
  /** The bike's paint, from the look's palette; null keeps the bike's own colours. */
  paint: readonly string[] | null;
  law: boolean;
}

const bare = (id: string): string => id.slice(id.indexOf(':') + 1);
const HEX = /^#[0-9a-f]{6}$/i;

export function riderLookOf(src: RiderLookSource): RiderLook {
  const look = src.look && typeof src.look === 'object' ? (src.look as Record<string, unknown>) : {};
  const named = typeof look['bikeModel'] === 'string' ? look['bikeModel'] : null;
  const cls = typeof look['bikeClass'] === 'string' ? BIKE_CLASS_MODELS[look['bikeClass']] : undefined;
  const bike = named ?? cls ?? (src.role === 'cop' ? 'cop-moto' : bare(src.bikeId));
  const palette = Array.isArray(look['palette'])
    ? look['palette'].filter((c): c is string => typeof c === 'string' && HEX.test(c))
    : [];
  return {
    contentId: src.contentId,
    riderModel: `models/riders/${bare(src.contentId)}`,
    bikeModel: `models/bikes/${bike}`,
    paint: palette.length ? palette : null,
    law: src.role === 'cop',
  };
}
