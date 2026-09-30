// ui/narrative: bark bubbles (and, later, interludes). narrative-1 owns this folder. The seam:
// app/ hands each tick's SimEvents to `onEvents`, with the snapshot and the race seed as context;
// the director turns them into bark requests, the selector picks a line on a presentation random
// stream, and the bubble shows it. It never reads sim internals and never changes the sim.
import { loadBasePack, type ContentRegistry } from '../../content';
import type { SimEvent } from '../../sim/api';
import { createBubbleView } from './bubble';
import { createBarkDirector, type BarkView, type NarrativeContext } from './director';
import { BARK_TUNING, barkLinesFrom, createBarkSelector, type BarkParams } from './selector';

export { BARK_TUNING } from './selector';
export type { NarrativeContext } from './director';

export interface Narrative {
  /** Without a context (no snapshot to name the riders) the narrative stays silent. */
  onEvents(events: readonly SimEvent[], context?: NarrativeContext | null): void;
  /** Applies a `barks.*` tuning change. */
  setParam(id: string, value: number): void;
}

export interface NarrativeOptions {
  /** The registry's bark sets; the base pack's when left out. */
  barkSets?: ContentRegistry['barkSets'];
  includeDrafts?: boolean;
  params?: BarkParams;
  /** Where the bubble goes; `#ui`, else the body, when left out. */
  host?: () => HTMLElement | null;
  /** A view other than the DOM bubble (tests). */
  view?: BarkView;
}

export function createNarrative(options: NarrativeOptions = {}): Narrative {
  // Built on first use, so creating the UI never pays for it.
  let director: ReturnType<typeof createBarkDirector> | null = null;
  let selector: ReturnType<typeof createBarkSelector> | null = null;
  const pending: [string, number][] = [];
  const ensure = () => {
    if (director) return director;
    const sets = options.barkSets ?? loadBasePack().barkSets;
    const lines = barkLinesFrom(sets, { includeDrafts: options.includeDrafts ?? false });
    selector = createBarkSelector(lines, options.params);
    for (const [id, value] of pending.splice(0)) selector.setParam(id, value);
    director = createBarkDirector(selector, options.view ?? createBubbleView(options.host));
    return director;
  };
  return {
    onEvents(events, context) {
      if (!context) return;
      ensure().onEvents(events, context);
    },
    setParam(id, value) {
      if (selector) selector.setParam(id, value);
      else if (BARK_TUNING.some((d) => d.id === id)) pending.push([id, value]);
      else throw new Error(`barks: unknown parameter ${id}`);
    },
  };
}
