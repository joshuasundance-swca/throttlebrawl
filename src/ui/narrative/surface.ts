// Where barks show: the HUD ticker (ui/ticker-view.ts). The narrative only needs this much of it:
// the director's `show`/`hide`, the bark on the strip now, the strip's element for the "cut this"
// long-press, and a hold while a finger rests on it. It replaces the old black-on-white bark bubble
// (playtest 3, the maintainer: "The black and white text pop-ups block the actual game").
import type { BarkView, ShownBark } from './director';

export interface BarkSurface extends BarkView {
  /** The vetoable item on the strip, as a bark, or null. */
  current(): ShownBark | null;
  /** The strip's element once mounted. */
  element(): HTMLElement | null;
  /** Holds the item up while a finger rests on it; releasing gives it a short grace. */
  hold(on: boolean): void;
  /** Takes the item with this reference off the strip and out of the queue ("cut this"). */
  cut(contentRef: string): void;
}
