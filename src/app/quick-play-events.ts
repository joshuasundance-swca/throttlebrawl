// Quick Play uses carried events and the existing objective judge, with no career settlement.
import { packOf, type ContentRegistry } from '../content';
import { QUICK_PLAY_KINDS, type QuickPlayKind, type RaceOptions } from '../save';
import type { DifficultyPreset } from '../sim/api';
import { copIds, qualifyIn, raceField, raceTimeOfDay, type RaceSetup } from './config';
import { menuRaceSetup, type Garage } from './race-options';

const KINDS: Record<QuickPlayKind, string> = {
  race: 'classic-race',
  hunt: 'takedown-hunt',
  escape: 'cop-escape',
  grudge: 'grudge-match',
};
export interface QuickPlayEvent {
  kind: QuickPlayKind;
  eventId: string;
  label: string;
}
export const QUICK_PLAY_LABELS: Record<QuickPlayKind, string> = {
  race: 'Race',
  hunt: 'Hunt',
  escape: 'Escape',
  grudge: 'Grudge',
};
const rulesOf = (reg: ContentRegistry, id: string): Record<string, unknown> => reg.events[id]?.rules ?? {};
export const huntMinimum = (reg: ContentRegistry, id: string): number => {
  const e = reg.events[id];
  return Math.max(
    1,
    Number(rulesOf(reg, id)['targetCount'] ?? 1),
    ...(e?.objectives
      .filter((o) => o.required && o.kind === 'takedowns')
      .map((o) => Number((o as { params?: Record<string, unknown> }).params?.['count'] ?? 1)) ?? []),
  );
};

/** One safe non-finale event per family, preferring free play then the first tier. */
export function quickPlayEvents(reg: ContentRegistry, region: string): QuickPlayEvent[] {
  return QUICK_PLAY_KINDS.flatMap((kind) => {
    const ids = Object.keys(reg.events)
      .filter((id) => {
        const e = reg.events[id]!;
        if (e.kind !== KINDS[kind] || e.finale || qualifyIn(packOf(id), e.region) !== region) return false;
        if (e.objectives.some((o) => o.required && o.kind === 'ride-branch')) return false;
        const rules = rulesOf(reg, id);
        if (kind === 'grudge')
          return (
            typeof rules['rival'] === 'string' &&
            (e.field.riders ?? [])
              .map((r) => qualifyIn(packOf(id), r))
              .includes(qualifyIn(packOf(id), rules['rival']))
          );
        if (kind === 'escape') return e.cops?.mode !== 'none' && copIds(reg, id, e.tier ?? 1).length > 0;
        if (kind === 'hunt') {
          const targets = rules['targets'];
          const field = raceField(reg, id, 1, Array.isArray(targets) ? false : true, undefined, 7);
          return (
            field.length >= huntMinimum(reg, id) &&
            (!Array.isArray(targets) ||
              targets.every((t) => typeof t === 'string' && field.includes(qualifyIn(packOf(id), t))))
          );
        }
        return true;
      })
      .sort((a, b) => (reg.events[a]?.tier ?? 0) - (reg.events[b]?.tier ?? 0) || a.localeCompare(b));
    return ids[0] ? [{ kind, eventId: ids[0], label: QUICK_PLAY_LABELS[kind] }] : [];
  });
}
export function quickPlayEvent(
  reg: ContentRegistry,
  region: string,
  kind: QuickPlayKind,
): QuickPlayEvent | null {
  const events = quickPlayEvents(reg, region);
  return events.find((e) => e.kind === kind) ?? events.find((e) => e.kind === 'race') ?? events[0] ?? null;
}

/** Event constraints take precedence over device picks, and the setup screen explains them. */
export function quickPlaySetup(
  reg: ContentRegistry,
  eventId: string,
  options: RaceOptions,
  garage: Garage,
  field: 'open' | 'matched',
  seed: number,
  difficulty: DifficultyPreset,
  tuning: Record<string, number>,
): Partial<RaceSetup> {
  const e = reg.events[eventId]!;
  const rules = rulesOf(reg, eventId);
  const authored =
    e.kind === 'grudge-match' || (e.kind === 'takedown-hunt' && Array.isArray(rules['targets']));
  const safe = {
    ...options,
    ...(e.kind === 'takedown-hunt' && !authored
      ? { rivals: Math.max(huntMinimum(reg, eventId), options.rivals ?? e.field.riders?.length ?? 0) }
      : {}),
    ...(e.kind === 'cop-escape' ? { cops: true } : {}),
  };
  return {
    ...menuRaceSetup(reg, safe, garage, field),
    freePlay: !authored,
    ...(authored
      ? { eventPatch: { timeOfDay: raceTimeOfDay(reg, eventId, seed, true, undefined, options.timeOfDay) } }
      : {}),
    difficulty,
    tuning: {
      ...tuning,
      ...(e.kind === 'cop-escape'
        ? {
            [`difficulty.${difficulty}.copFrequency`]: Math.max(
              1,
              tuning[`difficulty.${difficulty}.copFrequency`] ?? 1,
            ),
          }
        : {}),
    },
  };
}

export function quickPlayObjective(reg: ContentRegistry, eventId: string): string {
  const e = reg.events[eventId]!;
  const r = rulesOf(reg, eventId);
  if (e.kind === 'takedown-hunt') {
    const targets = r['targets'];
    const who =
      Array.isArray(targets) && targets.length > 0
        ? `: ${targets.map((t) => reg.riders[qualifyIn(packOf(eventId), String(t))]?.name ?? String(t)).join(', ')}`
        : '';
    return `Score ${huntMinimum(reg, eventId)} takedowns${who} before the finish. Enough rivals stay in the field; event road only.`;
  }
  if (e.kind === 'cop-escape') {
    const survive =
      r['escapeBy'] === 'distance'
        ? `ride ${(Number(r['escapeDistanceM'] ?? 2000) / 1000).toFixed(1)} km in pursuit`
        : `survive ${Number(r['surviveS'] ?? 60)} s in pursuit`;
    return `Lose the cops, ${survive}, or reach the finish. Law stays on for Escape.`;
  }
  if (e.kind === 'grudge-match') {
    const rival =
      typeof r['rival'] === 'string'
        ? (reg.riders[qualifyIn(packOf(eventId), r['rival'])]?.name ?? 'your rival')
        : 'your rival';
    const count = Number(r['knockdownsToWin'] ?? 1);
    const win =
      r['rule'] === 'collab'
        ? `Have more style cash than ${rival} when you finish.`
        : r['winBy'] === 'knockdowns'
          ? `Knock ${rival} down ${count} times${r['rule'] === 'audit' ? ', plus one per hit you take (up to two more)' : ''}.`
          : `Beat ${rival} to the finish.`;
    return `${win} Named opposition and event road stay fixed.`;
  }
  return 'Race to the finish. Quick Play leaves your career unchanged.';
}
