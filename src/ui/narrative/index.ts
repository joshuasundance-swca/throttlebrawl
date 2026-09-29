// ui/narrative: bark bubbles and interludes (narrative-1 owns this folder after app-1). The seam:
// app/ hands each tick's SimEvents to `onEvents`; the selector, the bubble and the lines arrive
// with narrative-1. It never reads sim internals and never changes the sim.
import type { SimEvent } from '../../sim/api';

export interface Narrative {
  onEvents(events: readonly SimEvent[]): void;
}

export function createNarrative(): Narrative {
  return { onEvents: () => {} };
}
