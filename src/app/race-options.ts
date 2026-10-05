// The menu race's options (playtest 4, P4-12 and P4-13): what the options screen offers for the
// region, the road and the garage, and how the remembered picks become the race's setup. Every pick
// feeds buildSimConfig (the bike, the light, the field, the law, the traffic) or the renderer (the
// weather), so a menu race's config, and the replay header that carries it, say what was picked;
// the header also carries the picks themselves (`raceOptions`). A career race reads none of them.
import { lookup, packClosure, packOf, packSubset, type ContentRegistry } from '../content';
import { MAX_RACE_RIVALS, type RaceOptions, type RaceTraffic } from '../save';
import { formatSpeed, type OptionChoice, type RaceOptionsView } from '../ui';
import { eventKey, PLAYER_PRESET, qualifyIn, raceField, type RaceSetup } from './config';
import { routeChoices } from './regions';

/**
 * Each traffic pick as a scale on the `traffic.density` slider: none empties the road, light is
 * half, heavy is three quarters more. [default]
 */
export const TRAFFIC_SCALE: Readonly<Record<RaceTraffic, number>> = {
  none: 0,
  light: 0.5,
  usual: 1,
  heavy: 1.75,
};

/** The garage as the menu race reads it: the bikes owned and the one ridden (the profile's). */
export interface Garage {
  owned: readonly string[];
  current: string | null;
}

const topSpeed = (reg: ContentRegistry, id: string) => reg.bikes[id]?.handling.topSpeedMps ?? 0;

/**
 * The bikes a menu race offers (the maintainer: "any bike you own, without the career garage; quick
 * race may offer all"): every bike carried, except the secret joke rides (tagged `secret`), which
 * stay easter eggs until the garage owns one (docs/product-spec.md, "Bikes"). Slowest first. [default]
 */
export function menuBikes(reg: ContentRegistry, owned: readonly string[]): string[] {
  return Object.keys(reg.bikes)
    .filter((id) => !(reg.bikes[id]?.tags ?? []).includes('secret') || owned.includes(id))
    .sort((a, b) => topSpeed(reg, a) - topSpeed(reg, b) || (a < b ? -1 : 1));
}

/**
 * The picks as the race's setup: only the fields a pick changes, so the defaults race as before. The
 * bike is the picked one while it is on offer, else the garage's (as every menu race rode before).
 */
export function menuRaceSetup(
  reg: ContentRegistry,
  o: RaceOptions,
  garage: Garage,
): Pick<RaceSetup, 'playerBike' | 'timeOfDay' | 'rivals' | 'cops' | 'trafficScale'> {
  const bike = o.bike && menuBikes(reg, garage.owned).includes(o.bike) ? o.bike : garage.current;
  return {
    ...(bike ? { playerBike: bike } : {}),
    ...(o.timeOfDay ? { timeOfDay: o.timeOfDay } : {}),
    ...(o.rivals !== null ? { rivals: o.rivals } : {}),
    ...(o.cops ? {} : { cops: false }),
    ...(o.traffic !== 'usual' ? { trafficScale: TRAFFIC_SCALE[o.traffic] } : {}),
  };
}

/** "golden-hour" as a person writes it: "Golden hour". */
const words = (id: string) => {
  const s = id.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * What the options screen offers for a menu race at this event and road (`route` null: the event's
 * own road): the garage's bike then every bike on offer, "Any" then the region's lights, the usual
 * field then 0 to as many rivals as the region's cast holds (at most MAX_RACE_RIVALS), and the
 * event's lengths (none while a real road is picked: its length is its own).
 */
export function raceOptionsView(
  reg: ContentRegistry,
  eventId: string,
  route: string | null,
  garage: Garage,
  units: 'mph' | 'kmh',
): RaceOptionsView {
  const key = eventKey(eventId);
  const pack = packOf(key);
  const event = lookup(reg.events, key);
  // The race's own packs, as buildSimConfig fields the rivals from.
  const race = packSubset(reg, packClosure(reg, pack));
  const region = reg.regions[qualifyIn(pack, event.region)] as
    ({ name?: unknown; timeOfDayOptions: readonly { id: string }[] } & object) | undefined;
  const regionName = typeof region?.name === 'string' && region.name ? region.name : String(event.region);
  const road = routeChoices(reg, key).find((c) => c.id === route) ?? routeChoices(reg, key)[0];
  const bikeName = (id: string) => reg.bikes[id]?.name ?? id;
  const starter = qualifyIn('base', lookup(reg.riders, qualifyIn('base', PLAYER_PRESET)).bike);
  const usual = raceField(race, key, 1, false).length;
  const cast = raceField(race, key, 1, true, undefined, MAX_RACE_RIVALS).length;
  const bikes: OptionChoice<string | null>[] = [
    { value: null, label: 'Garage bike', note: bikeName(garage.current ?? starter) },
    ...menuBikes(reg, garage.owned).map((id) => ({
      value: id,
      label: bikeName(id),
      note: formatSpeed(topSpeed(reg, id), units),
    })),
  ];
  const times: OptionChoice<string | null>[] = [
    { value: null, label: 'Any', note: 'a different light each race' },
    ...(region?.timeOfDayOptions ?? []).map((t) => ({ value: t.id, label: words(t.id) })),
  ];
  const rivals: OptionChoice<number | null>[] = [
    { value: null, label: 'Usual', note: `${usual} rivals` },
    ...Array.from({ length: cast + 1 }, (_, n) => ({ value: n, label: n === 0 ? 'None' : String(n) })),
  ];
  const lengths: OptionChoice<string>[] =
    route && road?.id === route ? [] : event.lengths.map((l) => ({ value: l.id, label: words(l.id) }));
  return { where: `${regionName}, ${road?.name ?? event.name ?? event.id}`, bikes, times, rivals, lengths };
}
