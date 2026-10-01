// The region picker's rules (playtest 1c item 6, 2026-09-30: "start adding other regions";
// "Pnw and sf first then others"). The list comes from app/, which reads the content registry's
// regions; ui only draws it and reports the pick. The default is the Keys. [default]

/** One region the player can race in, as plain data (app/ maps the registry's regions to it). */
export interface RegionOption {
  /** The region's id, plain (`florida-keys`) or pack-qualified (`base:florida-keys`). */
  id: string;
  /** The name on the button, such as "The Keys". */
  name: string;
  /** One line under the buttons for the picked region. */
  blurb?: string;
}

/** Region 1, the Keys: the pick when nothing else is asked for. */
export const DEFAULT_REGION = 'florida-keys';

/** The id without its pack prefix (`base:florida-keys` → `florida-keys`). */
export const bareRegionId = (id: string): string => id.slice(id.indexOf(':') + 1);

/** True when two ids name the same region, qualified or not. */
export const sameRegion = (a: string, b: string): boolean => a === b || bareRegionId(a) === bareRegionId(b);

/**
 * The region to show as picked: `wanted` when it is in the list, else the Keys, else the first.
 * Returns the option's own id (as app/ spelled it), or null for an empty list.
 */
export function pickRegion(options: readonly RegionOption[], wanted?: string | null): string | null {
  const find = (id: string) => options.find((o) => sameRegion(o.id, id));
  return (wanted ? find(wanted) : undefined)?.id ?? find(DEFAULT_REGION)?.id ?? options[0]?.id ?? null;
}

/** The list app/ gave, cleaned: no blank ids or names, and no region twice (the first one stays). */
export function cleanRegions(options: readonly RegionOption[]): RegionOption[] {
  const out: RegionOption[] = [];
  for (const o of options) {
    if (!o.id.trim() || !o.name.trim()) continue;
    if (out.some((k) => sameRegion(k.id, o.id))) continue;
    out.push(o);
  }
  return out;
}
