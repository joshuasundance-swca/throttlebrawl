import type { SidewalkCase } from './sidewalk-inventory.ts';

interface Share {
  n: number;
  dodged: number;
}
export interface SidewalkResult extends Share {
  types: Record<string, Share & { contact: number }>;
  /** Fast: contacts with a `dodges` kind; braking: contacts with every non-solid kind. */
  hits: string[];
  /** Optional SIDEWALK_BEFORE=1 diagnostic, never part of the acceptance bands. */
  before?: Share;
}
const share = (): Share => ({ n: 0, dodged: 0 });
const validShare = (t: Share) =>
  t &&
  Number.isSafeInteger(t.n) &&
  t.n >= 0 &&
  Number.isSafeInteger(t.dodged) &&
  t.dodged >= 0 &&
  t.dodged <= t.n;
function validate(row: SidewalkResult) {
  if (
    !validShare(row) ||
    !row.types ||
    typeof row.types !== 'object' ||
    Array.isArray(row.types) ||
    !Object.values(row.types).every(
      (t) => validShare(t) && Number.isSafeInteger(t.contact) && t.contact >= 0 && t.contact <= t.n,
    ) ||
    Object.values(row.types).reduce((n, t) => n + t.n, 0) !== row.n ||
    Object.values(row.types).reduce((n, t) => n + t.dodged, 0) !== row.dodged ||
    !Array.isArray(row.hits) ||
    !row.hits.every((h) => typeof h === 'string') ||
    (row.before !== undefined && !validShare(row.before))
  )
    throw new Error('Malformed sidewalk survey result');
}
function add(total: Share, row: Share) {
  total.n += row.n;
  total.dodged += row.dodged;
}

/** Complete-pool statistics, never independent event-file percentages. */
export function foldSidewalk(cases: readonly SidewalkCase[], rows: readonly SidewalkResult[]) {
  if (!cases.length || rows.length !== cases.length)
    throw new Error('Missing complete sidewalk survey results');
  const regions = new Map<string, SidewalkResult>();
  const overall = share();
  const crashes: string[] = [],
    punishments: string[] = [];
  let brakes = 0;
  cases.forEach((c, i) => {
    const row = rows[i]!;
    validate(row);
    if (c.mode === 'brake') {
      brakes++;
      punishments.push(...row.hits);
      return;
    }
    const region: SidewalkResult = regions.get(c.region) ?? { ...share(), types: {}, hits: [] };
    add(region, row);
    add(overall, row);
    for (const [kind, t] of Object.entries(row.types)) {
      const type = region.types[kind] ?? { ...share(), contact: 0 };
      add(type, t);
      type.contact += t.contact;
      region.types[kind] = type;
    }
    if (row.before) {
      region.before ??= share();
      add(region.before, row.before);
    }
    regions.set(c.region, region);
    // Preserve the original crash classification; fast wobbles have no new ceiling.
    crashes.push(...row.hits.filter((h) => h.includes('crash')));
  });
  return { regions, overall, crashes, punishments, brakes };
}

/** Original exposure floors and bands, with the same zero-tolerance contact judgments. */
export function assertSidewalk({ regions, overall, crashes, punishments }: ReturnType<typeof foldSidewalk>) {
  for (const [region, t] of regions) {
    if (t.n < 5) throw new Error(`Sidewalk ${region} sample below 5`);
    if (t.dodged / t.n < 0.75) throw new Error(`Sidewalk ${region} share below 0.75`);
  }
  if (overall.n < 30) throw new Error('Sidewalk overall sample below 30');
  if (overall.dodged / overall.n < 0.85) throw new Error('Sidewalk overall share below 0.85');
  if (crashes.length) throw new Error('Sidewalk dodges kind costs the rider a crash: ' + crashes.join('; '));
  if (punishments.length) throw new Error('Sidewalk braking rider punished: ' + punishments.join('; '));
}

export function sidewalkLines(pooled: ReturnType<typeof foldSidewalk>) {
  const lines = [...pooled.regions].map(
    ([region, t]) =>
      `${region}: ${t.dodged} of ${t.n} things in the way got out of it` +
      (t.before ? ` (before the kerb riders learned the verge: ${t.before.dodged} of ${t.before.n})` : '') +
      '; ' +
      Object.entries(t.types)
        .map(([k, v]) => `${k} ${v.dodged}/${v.n}${v.contact ? ` hit ${v.contact}` : ''}`)
        .join(', '),
  );
  const { overall: t, crashes, brakes, punishments } = pooled;
  lines.push(`overall ${t.dodged} of ${t.n} (${((100 * t.dodged) / t.n).toFixed(0)} %), band 85 %`);
  lines.push(`rider crashes into things over the rides: ${crashes.length} ${crashes.join('; ')}`);
  lines.push(`${brakes} braking rides: ${punishments.length} punishments ${punishments.join('; ')}`);
  return lines;
}
