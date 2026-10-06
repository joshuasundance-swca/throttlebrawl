// The registry's per-type tables (docs/content-packs.md, "Which fields count as sim-facing" and
// "In-game veto"): plain data, apart from the Zod schemas in entries.ts, so the page's loader and
// the content hashes read them without bundling Zod (lane F1, the first-load headroom). A contract,
// like the rest of this folder.
import type { EntryType } from './entries';

/** Reserved types: valid files, but not loaded into the registry yet. */
export const RESERVED_TYPES: readonly EntryType[] = ['patch'];

/**
 * Top-level fields left out of the sim content hash, per type (docs/content-packs.md, "Which
 * fields count as sim-facing"). Everything else in an entry of that type is sim-facing, so a field
 * a later lane adds counts toward the sim hash until it is listed here: a missed presentation
 * field only renews the replay key, while a missed sim field would let replays silently diverge.
 * `null` means the whole type is presentation-only (full hash only).
 */
export const SIM_EXCLUDED_FIELDS: Readonly<Record<EntryType, readonly string[] | null>> = {
  bike: ['name', 'tags', 'meta', 'look', 'engineSound', 'blurb'],
  rider: ['name', 'tags', 'meta', 'look', 'paint', 'blurb'],
  crew: ['name', 'tags', 'meta'],
  weapon: ['name', 'tags', 'meta', 'look', 'sounds'],
  event: ['name', 'tags', 'meta', 'interludes', 'weather'],
  // A career picks which events to play and in what order; each race's sim comes from its event.
  career: null,
  region: [
    'name',
    'tags',
    'meta',
    'blurb',
    'chapter',
    'palette',
    'timeOfDayOptions',
    'signs',
    'billboards',
    'landingLines',
  ],
  'road-network': ['name', 'meta', 'provenance'],
  road: ['name', 'realName', 'meta', 'provenance'],
  route: ['name', 'meta'],
  'traffic-type': ['name', 'tags', 'meta', 'look'],
  'tuning-preset': ['name', 'tags', 'meta'],
  'event-modifier': ['name', 'tags', 'meta', 'announce'],
  'bark-set': null,
  'hud-layout': null,
  station: null,
  patch: null,
};

/**
 * The lists of vetoable items per type (docs/content-packs.md, "In-game veto"): each item has an
 * id unique in its entry and an optional `status`; the loader drops vetoed (and, in release
 * builds, draft) items, and the file keeps them as the taste log.
 */
export const VETOABLE_ITEMS: Readonly<Partial<Record<EntryType, readonly string[]>>> = {
  'bark-set': ['lines'],
  region: ['signs', 'billboards', 'landingLines', 'smashables'],
  station: ['tracks'],
};
