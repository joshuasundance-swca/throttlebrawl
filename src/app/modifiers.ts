// The event's modifiers as the sim reads them (docs/content-packs.md, "Event modifiers"; W-P
// events, the maintainer, 2026-10-01b): an event opts in with `modifiers: { pool, maxPerRace,
// chanceScale }`. `region-default` means every loaded modifier whose eligibility matches the event
// (its region, its kind, its time of day; an empty or missing list means any); a list names them.
// Each resolves to a SimModifierDef in id order, its chance scaled (at most 1), its duration in
// ticks, and its effects as plain data with traffic-type references qualified by the modifier's
// pack, so a pack can write `"vehicle": "event-tow-truck"`. Which of them fire, and where, is the
// sim's roll (sim/modifiers), so it is seeded and in the replay.
import { packOf, type ContentRegistry, type EventModifier, type RaceEvent } from '../content';
import { secondsToTicks, type SimModifierDef, type SimModifierEffect } from '../sim/api';

/** Effect fields that name a traffic type (qualified by the modifier's pack). */
const TYPE_REFS = new Set(['vehicle', 'vehicle2', 'floats']);

const qualify = (pack: string, ref: string) => (ref.includes(':') ? ref : `${pack}:${ref}`);

function plainEffect(pack: string, effect: Readonly<Record<string, unknown>>): SimModifierEffect {
  const out: Record<string, number | string | boolean | readonly string[]> = {};
  for (const key of Object.keys(effect).sort()) {
    const v = effect[key];
    const ref = TYPE_REFS.has(key);
    if (typeof v === 'string') out[key] = ref ? qualify(pack, v) : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
      out[key] = v.map((x) => (ref ? qualify(pack, x) : x));
  }
  return { ...out, kind: String(effect['kind']) };
}

/** Whether a modifier may appear in this event (an empty or missing list means any). */
function eligible(m: EventModifier, mPack: string, event: RaceEvent, regionKey: string): boolean {
  const e = m.eligibility;
  const regions = e?.regions ?? [];
  if (regions.length > 0 && !regions.some((r) => qualify(mPack, r) === regionKey)) return false;
  const kinds = e?.eventKinds ?? [];
  if (kinds.length > 0 && !kinds.includes(event.kind)) return false;
  const times = e?.timeOfDay ?? [];
  if (times.length > 0 && !times.includes(String(event.timeOfDay ?? ''))) return false;
  return true;
}

/** The event's resolved modifiers, in id order, and its per-race cap (null when it opts out). */
export function eventModifiers(
  reg: ContentRegistry,
  event: RaceEvent,
  eventId: string,
): { modifiers: SimModifierDef[]; perRace: number | undefined } {
  const opt = event.modifiers;
  if (!opt) return { modifiers: [], perRace: undefined };
  const eventPack = packOf(eventId);
  const regionKey = qualify(eventPack, event.region);
  const scale = opt.chanceScale ?? 1;
  const ids =
    opt.pool === 'region-default'
      ? Object.keys(reg.modifiers).filter((id) => {
          const m = reg.modifiers[id];
          return !!m && eligible(m, packOf(id), event, regionKey);
        })
      : opt.pool.map((ref) => qualify(eventPack, ref)).filter((id) => id in reg.modifiers);
  const modifiers = [...new Set(ids)].sort().map((id): SimModifierDef => {
    const m = reg.modifiers[id] as EventModifier;
    const pack = packOf(id);
    const window = m.trigger.atProgress ?? [0, 1];
    return {
      contentId: id,
      kind: m.kind,
      chance: Math.min(1, Math.max(0, m.trigger.chance * scale)),
      atProgress: [Math.min(window[0], window[1]), Math.max(window[0], window[1])],
      durationTicks: secondsToTicks(m.durationS),
      weight: m.rarityWeight,
      effects: m.effects.map((e) => plainEffect(pack, e)),
    };
  });
  return { modifiers, perRace: opt.maxPerRace };
}
