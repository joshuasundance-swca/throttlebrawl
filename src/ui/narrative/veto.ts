// The runtime side of "cut this" (docs/architecture.md, "In-game veto"; docs/content-packs.md,
// "In-game veto"). A cut makes a flag `{contentRef, raceId, tick}` for the settings record and the
// debug report, and the item stops showing on this device (a presentation-only filter; the sim is
// untouched). The pause screen's "recently seen" list holds the last 20 barks, signs and
// billboards shown, so a cut never depends on catching a two-second bubble mid-race.
// No DOM here: veto-ui.ts draws it.

/** A "cut this" flag, exactly as the settings record and the debug report carry it. */
export interface VetoFlag {
  contentRef: string;
  raceId: string;
  tick: number;
}

export type SeenKind = 'bark' | 'sign' | 'billboard';

/** One item the player saw: what the list shows and what a cut flags. */
export interface SeenItem {
  contentRef: string;
  kind: SeenKind;
  /** The words shown: a bark as "Speaker: line", a sign or billboard as its text. */
  label: string;
  raceId: string;
  tick: number;
}

/** How many items the "recently seen" list keeps (docs/milestones/M2.md, narrative-2). */
export const RECENTLY_SEEN_MAX = 20;

/** Long-press length (docs/architecture.md, "The gesture": 500 ms or more). */
export const VETO_LONG_PRESS_MS = 500;

/** `<packId>:<type>/<entryId>#<itemId>` (docs/content-packs.md, "In-game veto"). */
const CONTENT_REF = /^[a-z0-9][a-z0-9-]*:[a-z][a-z-]*\/[a-z0-9][a-z0-9-]*#[a-z0-9][a-z0-9-]*$/;

export function isContentRef(ref: string): boolean {
  return CONTENT_REF.test(ref);
}

export interface SeenLog {
  /** Notes an item as seen: newest first, one row per item (a repeat moves it to the top). */
  note(item: SeenItem): void;
  /** Newest first. */
  list(): readonly SeenItem[];
  remove(contentRef: string): void;
  /** Called after every change. */
  onChange(listener: () => void): void;
}

export function createSeenLog(max = RECENTLY_SEEN_MAX): SeenLog {
  let items: SeenItem[] = [];
  const listeners: (() => void)[] = [];
  const changed = () => {
    for (const l of listeners) l();
  };
  return {
    note(item) {
      items = [item, ...items.filter((i) => i.contentRef !== item.contentRef)].slice(0, Math.max(0, max));
      changed();
    },
    list: () => items,
    remove(contentRef) {
      const before = items.length;
      items = items.filter((i) => i.contentRef !== contentRef);
      if (items.length !== before) changed();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

/** Reads the refs out of a stored `vetoes` list, skipping anything malformed. */
export function vetoedRefs(vetoes: unknown): string[] {
  if (!Array.isArray(vetoes)) return [];
  const out: string[] = [];
  for (const v of vetoes as unknown[]) {
    const ref =
      typeof v === 'string'
        ? v
        : typeof v === 'object' && v !== null
          ? (v as { contentRef?: unknown }).contentRef
          : null;
    if (typeof ref === 'string' && isContentRef(ref)) out.push(ref);
  }
  return out;
}
