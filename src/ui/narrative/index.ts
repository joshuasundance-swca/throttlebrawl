// ui/narrative: bark bubbles, "cut this", and (later) interludes. The narrative lane owns this
// folder. The seam: app/ hands each tick's SimEvents to `onEvents`, with the snapshot and the race
// seed as context; the director turns them into bark requests, the selector picks a line on a
// presentation random stream, and the bubble shows it. It never reads sim internals and never
// changes the sim.
//
// "Cut this" (narrative-2): a long-press on the bubble, a tap in the pause screen's "recently
// seen" list, or a billboard or sign app/ picked in the paused scene (`offerCut`) opens the confirm
// card. A cut hides the item on this device at once and hands `{contentRef, raceId, tick}` to
// `onVeto`, which the owner of the settings record stores (the debug report lists it from there).
import { loadBasePack, type ContentRegistry } from '../../content';
import type { SimEvent } from '../../sim/api';
import { createBubbleView, type BubbleView } from './bubble';
import { createBarkDirector, type BarkView, type NarrativeContext } from './director';
import {
  BARK_TUNING,
  barkLinesFrom,
  createBarkSelector,
  type BarkParams,
  type BarkSelector,
} from './selector';
import { createSeenLog, type SeenItem, type SeenKind, type VetoFlag } from './veto';
import { createCutMenu, mountRecentlySeen, watchBubblePresses, type CutMenu } from './veto-ui';

export { BARK_TUNING } from './selector';
export type { NarrativeContext } from './director';
export type { NarrativeSetting } from './memory';
export { RECENTLY_SEEN_MAX, VETO_LONG_PRESS_MS, vetoedRefs } from './veto';
export type { SeenItem, SeenKind, VetoFlag } from './veto';

export interface Narrative {
  /** Without a context (no snapshot to name the riders) the narrative stays silent. */
  onEvents(events: readonly SimEvent[], context?: NarrativeContext | null): void;
  /** Applies a `barks.*` tuning change. */
  setParam(id: string, value: number): void;
  /** The last 20 barks, signs and billboards shown, newest first. */
  recentlySeen(): readonly SeenItem[];
  /** A sign or billboard came into view (app/ hands it on from render/). Cut items are ignored. */
  noteSeen(item: { contentRef: string; kind: SeenKind; label: string; tick?: number; raceId?: string }): void;
  /** Opens "cut this" for an item, such as a billboard picked in the paused scene. */
  offerCut(item: {
    contentRef: string;
    kind?: SeenKind;
    label?: string;
    tick?: number;
    raceId?: string;
  }): void;
  /** Puts the "recently seen" list (tap a row to cut it) into the pause screen. */
  mountRecentlySeen(host: HTMLElement): { element: HTMLElement; refresh(): void };
  /** True once an item is cut on this device: render/ skips such signs and billboards. */
  isVetoed(contentRef: string): boolean;
}

export interface NarrativeOptions {
  /** The registry's bark sets; the base pack's when left out. */
  barkSets?: ContentRegistry['barkSets'];
  /** The registry's riders and bikes, for `target.bikeClass`; the base pack's when left out. */
  riders?: ContentRegistry['riders'];
  bikes?: ContentRegistry['bikes'];
  includeDrafts?: boolean;
  params?: BarkParams;
  /** Where the bubble and the cut card go; `#ui`, else the body, when left out. */
  host?: () => HTMLElement | null;
  /** A view other than the DOM bubble (tests); no long-press is watched then. */
  view?: BarkView;
  /** Content references already cut on this device (from the settings record). */
  vetoed?: readonly string[];
  /** A cut: store the flag in the settings record. */
  onVeto?: (flag: VetoFlag) => void;
  /** True where a press belongs to steering or attacking; without it, touches mid-race never cut. */
  inControlZone?: (x: number, y: number) => boolean;
}

export function createNarrative(options: NarrativeOptions = {}): Narrative {
  const vetoed = new Set<string>(options.vetoed ?? []);
  const seen = createSeenLog();
  let menu: CutMenu | null = null;
  let racing = false;
  let last: { raceId: string; tick: number } = { raceId: '', tick: 0 };
  // Built on first use, so creating the UI never pays for it.
  let director: ReturnType<typeof createBarkDirector> | null = null;
  let selector: BarkSelector | null = null;
  let bubble: BubbleView | null = null;
  const pending: [string, number][] = [];

  const cut = (item: SeenItem) => {
    if (vetoed.has(item.contentRef)) return;
    vetoed.add(item.contentRef);
    selector?.veto(item.contentRef);
    seen.remove(item.contentRef);
    if (bubble?.current()?.contentRef === item.contentRef) bubble.hide();
    options.onVeto?.({ contentRef: item.contentRef, raceId: item.raceId, tick: item.tick });
  };
  const offer = (item: SeenItem) => {
    if (vetoed.has(item.contentRef)) return;
    menu ??= createCutMenu(options.host);
    menu.offer(item, () => cut(item));
  };

  const ensure = () => {
    if (director) return director;
    const reg = options.barkSets && options.riders && options.bikes ? null : loadBasePack();
    const sets = options.barkSets ?? reg?.barkSets ?? {};
    const riders = options.riders ?? reg?.riders ?? {};
    const bikes = options.bikes ?? reg?.bikes ?? {};
    const lines = barkLinesFrom(sets, { includeDrafts: options.includeDrafts ?? false });
    selector = createBarkSelector(lines, options.params, 0, { vetoed });
    for (const [id, value] of pending.splice(0)) selector.setParam(id, value);
    let view = options.view;
    if (!view) {
      const b = createBubbleView(options.host);
      bubble = b;
      view = b;
      watchBubblePresses(b, {
        inControlZone: options.inControlZone,
        racing: () => racing,
        onLongPress: (bark) =>
          offer({
            contentRef: bark.contentRef,
            kind: 'bark',
            label: `${bark.speakerName}: ${bark.text}`,
            raceId: bark.raceId,
            tick: bark.tick,
          }),
      });
    }
    const bikeClassOf = (riderId: string): string | undefined => {
      const bike = riders[riderId]?.bike;
      if (typeof bike !== 'string') return undefined;
      const pack = riderId.includes(':') ? riderId.slice(0, riderId.indexOf(':')) : 'base';
      const cls = (bikes[bike.includes(':') ? bike : `${pack}:${bike}`] as { class?: unknown } | undefined)
        ?.class;
      return typeof cls === 'string' ? cls : undefined;
    };
    director = createBarkDirector(selector, view, {
      bikeClassOf,
      onShown: (b) =>
        seen.note({
          contentRef: b.contentRef,
          kind: 'bark',
          label: `${b.speakerName}: ${b.text}`,
          raceId: b.raceId,
          tick: b.tick,
        }),
    });
    return director;
  };

  return {
    onEvents(events, context) {
      if (!context) return;
      for (const e of events) {
        if (e.type === 'raceStart') racing = true;
        else if (e.type === 'raceEnd') racing = false;
      }
      last = { raceId: context.raceId ?? `seed-${context.seed}`, tick: context.snapshot.tick };
      ensure().onEvents(events, context);
    },
    setParam(id, value) {
      if (selector) selector.setParam(id, value);
      else if (BARK_TUNING.some((d) => d.id === id)) pending.push([id, value]);
      else throw new Error(`barks: unknown parameter ${id}`);
    },
    recentlySeen: () => seen.list(),
    noteSeen(item) {
      if (vetoed.has(item.contentRef)) return;
      seen.note({
        contentRef: item.contentRef,
        kind: item.kind,
        label: item.label,
        raceId: item.raceId ?? last.raceId,
        tick: item.tick ?? last.tick,
      });
    },
    offerCut(item) {
      offer({
        contentRef: item.contentRef,
        kind: item.kind ?? 'billboard',
        label: item.label ?? item.contentRef,
        raceId: item.raceId ?? last.raceId,
        tick: item.tick ?? last.tick,
      });
    },
    mountRecentlySeen: (host) => mountRecentlySeen(host, seen, offer),
    isVetoed: (ref) => vetoed.has(ref),
  };
}
