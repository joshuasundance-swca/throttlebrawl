import { regionOpen, type CareerDef } from '../career';
import type { Profile } from '../save';

/** The latest usable chapter played this season, or null for the first-chapter fallback. */
export function returningCareerRegion(defs: readonly CareerDef[], profile: Profile): string | null {
  for (let i = profile.history.length - 1; i >= 0; i--) {
    const row = profile.history[i];
    if (!row || row.node === null || (row.season ?? 1) !== profile.season) continue;
    const def = defs.find((d) => d.regionId === row.region);
    if (def?.nodes.some((n) => n.id === row.node) && regionOpen(defs, profile, def)) return def.regionId;
  }
  return null;
}
