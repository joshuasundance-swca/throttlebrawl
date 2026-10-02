// The garage (the product spec's Bikes: "Three bikes, each a clear step up", slow novelty rides,
// secret joke rides "unlocked after the boss in free play", and "Paint colors are the only
// customization"). The career files' `shop` lists what is for sale and from which tier; a bike in
// several regions' shops is for sale once any of them reaches its tier, at the lowest price there.
// Anything tagged `secret` is hidden until an `unlocks` entry grants it (docs/content-packs.md,
// "Career"). Paints are each region's own (`paints`, run W-R): bought once, worn on any bike.
// DOM-free.
import type { ContentRegistry } from '../content';
import type { Profile } from '../save';
import type { CareerDef } from './defs';
import { progressOf, tierOpen } from './map';

export type GarageState = 'owned' | 'for-sale' | 'locked';

export interface GarageBike {
  /** Qualified bike id. */
  key: string;
  name: string;
  class: string;
  topSpeedMps: number;
  accelMps2: number;
  /** The lowest price among the shops that sell it (0 when owned from the start). */
  priceCash: number;
  state: GarageState;
  /** The bike the player rides now. */
  current: boolean;
  /** A secret joke ride (shown only once granted). */
  secret: boolean;
  /** Why it is locked, in plain words, or ''. */
  reason: string;
  /** The paint on it now (a paint id), or null for its own colours. */
  paint: string | null;
}

export interface GaragePaint {
  id: string;
  name: string;
  hex: string;
  priceCash: number;
  state: GarageState;
  regionName: string;
  reason: string;
}

const isSecret = (reg: ContentRegistry, key: string) => (reg.bikes[key]?.tags ?? []).includes('secret');

/** Every bike the garage shows: owned ones, and the shops' (secret ones only once owned). */
export function garageBikes(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
): GarageBike[] {
  const owned = new Set(profile.bikes.owned);
  const entries = new Map<string, { price: number; open: boolean; reason: string }[]>();
  for (const def of defs) {
    const progress = progressOf(def, profile.regions);
    for (const item of def.shop) {
      const open = tierOpen(def, progress, item.unlockTier);
      const reason = `Opens with ${def.tiers[item.unlockTier]?.name ?? 'a later tier'} (${def.regionName}).`;
      const row = entries.get(item.bike) ?? [];
      row.push({ price: item.priceCash, open, reason });
      entries.set(item.bike, row);
    }
  }
  // Open offers first, then the cheapest.
  const offers = new Map(
    [...entries].map(([bike, row]) => [
      bike,
      [...row].sort((a, b) => Number(b.open) - Number(a.open) || a.price - b.price)[0],
    ]),
  );
  const keys = [...new Set([...owned, ...offers.keys()])].filter(
    (k) => reg.bikes[k] && (owned.has(k) || !isSecret(reg, k)),
  );
  return keys
    .map((key): GarageBike => {
      const bike = reg.bikes[key];
      const offer = offers.get(key);
      const has = owned.has(key);
      return {
        key,
        name: bike?.name ?? key,
        class: bike?.class ?? '',
        topSpeedMps: bike?.handling.topSpeedMps ?? 0,
        accelMps2: bike?.handling.accelMps2 ?? 0,
        priceCash: offer?.price ?? 0,
        state: has ? 'owned' : offer?.open ? 'for-sale' : 'locked',
        current: profile.bikes.current === key,
        secret: isSecret(reg, key),
        reason: has || offer?.open ? '' : (offer?.reason ?? ''),
        paint: profile.bikes.paint[key] ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(a.secret) - Number(b.secret) || a.topSpeedMps - b.topSpeedMps || (a.key < b.key ? -1 : 1),
    );
}

export type GarageResult = { ok: true; profile: Profile } | { ok: false; reason: string };

/** Buys a bike for sale with the cash it costs, and rides it. */
export function buyBike(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  key: string,
): GarageResult {
  const bike = garageBikes(reg, defs, profile).find((b) => b.key === key);
  if (!bike) return { ok: false, reason: 'Not in the garage.' };
  if (bike.state === 'owned') return { ok: false, reason: 'Already yours.' };
  if (bike.state === 'locked') return { ok: false, reason: bike.reason || 'Not for sale yet.' };
  if (profile.cash < bike.priceCash)
    return { ok: false, reason: `Costs $${bike.priceCash}. You have $${profile.cash}.` };
  return {
    ok: true,
    profile: {
      ...profile,
      cash: profile.cash - bike.priceCash,
      bikes: { ...profile.bikes, owned: [...profile.bikes.owned, key].sort(), current: key },
    },
  };
}

/** Rides an owned bike. */
export function rideBike(profile: Profile, key: string): GarageResult {
  if (!profile.bikes.owned.includes(key)) return { ok: false, reason: 'Not yours yet.' };
  return { ok: true, profile: { ...profile, bikes: { ...profile.bikes, current: key } } };
}

/** Every region's paints, with what the player owns and can buy. */
export function garagePaints(defs: readonly CareerDef[], profile: Profile): GaragePaint[] {
  const out: GaragePaint[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    const progress = progressOf(def, profile.regions);
    for (const p of def.paints) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const open = tierOpen(def, progress, p.unlockTier);
      out.push({
        id: p.id,
        name: p.name,
        hex: p.hex,
        priceCash: p.priceCash,
        state: profile.paintsOwned.includes(p.id) ? 'owned' : open ? 'for-sale' : 'locked',
        regionName: def.regionName,
        reason: open
          ? ''
          : `Opens with ${def.tiers[p.unlockTier]?.name ?? 'a later tier'} (${def.regionName}).`,
      });
    }
  }
  return out;
}

/** Buys a paint for sale and puts it on the bike ridden now. */
export function buyPaint(defs: readonly CareerDef[], profile: Profile, paintId: string): GarageResult {
  const paint = garagePaints(defs, profile).find((p) => p.id === paintId);
  if (!paint) return { ok: false, reason: 'No such paint.' };
  if (paint.state === 'locked') return { ok: false, reason: paint.reason };
  let next = profile;
  if (paint.state === 'for-sale') {
    if (profile.cash < paint.priceCash)
      return { ok: false, reason: `Costs $${paint.priceCash}. You have $${profile.cash}.` };
    next = {
      ...profile,
      cash: profile.cash - paint.priceCash,
      paintsOwned: [...profile.paintsOwned, paintId].sort(),
    };
  }
  return paintBike(next, profile.bikes.current, paintId);
}

/** Paints an owned bike with an owned paint, or back to its own colours (null). */
export function paintBike(profile: Profile, bike: string | null, paintId: string | null): GarageResult {
  if (!bike || !profile.bikes.owned.includes(bike))
    return { ok: false, reason: 'Ride a bike of yours first.' };
  if (paintId !== null && !profile.paintsOwned.includes(paintId))
    return { ok: false, reason: 'Buy that paint first.' };
  const paint = { ...profile.bikes.paint };
  if (paintId === null) delete paint[bike];
  else paint[bike] = paintId;
  return { ok: true, profile: { ...profile, bikes: { ...profile.bikes, paint } } };
}

/** The colour of the paint on the bike ridden now, or null for its own colours. */
export function currentPaintHex(defs: readonly CareerDef[], profile: Profile): string | null {
  const bike = profile.bikes.current;
  const id = bike ? profile.bikes.paint[bike] : undefined;
  if (!id) return null;
  for (const d of defs) for (const p of d.paints) if (p.id === id) return p.hex;
  return null;
}
