// sim/roadside: the roadside class of a traffic type (playtest 4, the maintainer 2026-10-05: "I want
// most things on the sidewalks to jump out of the way ... some things on the sidewalks should be
// solid and cause a crash; I just want to be sure we're being consistent and intentional").
//
// One closed vocabulary says what a thing beside or on the road does when a fast rider comes at it and
// what the contact costs the rider (docs/content-packs.md, "Roadside classes"):
//
// - `dodges`: living things and light movers. They get out of the way (a pedestrian or animal dives
//   or hops; a bicycle, e-bike or scooter takes the verge) and contact is soft: a pedestrian is
//   knocked into its dive and the rider is never hurt, a light kerb rider topples and the rider only
//   wobbles. Never a crash.
// - `yields`: heavy movers and big animals. They also try to get out of the way, but they are big
//   enough that a hit is a crash (the golf cart and the pedicab; the gator and the elk).
// - `solid`: does not get out of the way and a hit is the ordinary vehicle rule or a crash: road
//   traffic, parked and stalled oddities. (Static scenery is not a traffic type; its classes are in
//   the docs table: smashables break with a wobble, poles, hydrants and benches are kept out of the
//   rideable ground.)
//
// A type says its class in `behaviour.roadside`. A type that does not gets the class the rules before
// this field gave it, so older content and recordings behave as they did. Only types are imported.
import type { SimTrafficTypeDef } from './types';

export const ROADSIDE_CLASSES = ['dodges', 'yields', 'solid'] as const;
export type RoadsideClass = (typeof ROADSIDE_CLASSES)[number];

/** A kerb rider this narrow or narrower is light (m): the width rule the class replaced. */
const LIGHT_KERB_MAX_WIDTH_M = 0.8;

/** The class a type was given by the rules before `behaviour.roadside` existed. */
export function derivedRoadsideClass(t: SimTrafficTypeDef): RoadsideClass {
  if (t.category === 'pedestrian' || t.category === 'animal') return t.hazard === 'big' ? 'yields' : 'dodges';
  if (t.behaviour?.kerb === true) return t.widthM <= LIGHT_KERB_MAX_WIDTH_M ? 'dodges' : 'yields';
  return 'solid';
}

/** The class of a type: its own `behaviour.roadside`, else the derived one. */
export function roadsideClass(t: SimTrafficTypeDef): RoadsideClass {
  return t.behaviour?.roadside ?? derivedRoadsideClass(t);
}
