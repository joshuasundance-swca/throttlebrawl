// The race-start countdown's number (playtest 4, P4-11; made small and clear of the road after the
// maintainer's 2026-10-05 veto: "The 3 2 1 countdown blocks visibility of what's directly ahead so it's
// hard to plan your start. It should be less obstructive."). It stands beside the road, never in it: a
// small, translucent number centred in the strip left of the road-ahead box the HUD layout keeps clear
// (ui/hud-layout.ts: the middle half across, 25 to 65 % down), at 45 % down, so it covers neither the road
// ahead nor the top band's pieces, and it takes no touch. Sized by the screen's short side and held
// inside that strip (a quarter of the width) so it fits a 568x320 phone and a 412x915 one alike.
//
// Noticed at first glance (the maintainer, 2026-10-05, after the move: "the 3 2 1 go is much better but
// now it's hard to see at first without knowing where to look lol"): each beat slams in, full bright with
// a warm glow at COUNT_PEAK_SCALE times its size, and settles to the small translucent number in about
// half a second; the first number after the grid appears (the 3) comes in bigger and slower
// (COUNT_FIRST_PEAK_SCALE), since that is the one nobody is looking for yet. Motion at the edge of the
// view is what the eye catches. The strip clips the number across (`overflow-x: clip`), so even at its
// peak it never reaches the road ahead; tests/e2e/ui-menu-first.spec.ts measures it at rest and at the
// peak. Each change makes a fresh element, which restarts the entrance; reduced motion gets none (the
// beeps still mark each beat). [default]

/** How much bigger a beat starts than it rests. */
export const COUNT_PEAK_SCALE = 1.45;
/** The same for the first beat after the grid appears. */
export const COUNT_FIRST_PEAK_SCALE = 1.8;
/** The number's opacity at rest, after the entrance (translucent: the veto). */
export const COUNT_REST_OPACITY = 0.6;

export const COUNTDOWN_CSS = `
#countdown { position: absolute; left: 0; width: 25%; top: 45%; transform: translateY(-50%); z-index: 1;
  pointer-events: none; text-align: center; overflow-x: clip; overflow-y: visible; }
#countdown[hidden] { display: none; }
#countdown .count { display: inline-block; padding: 0 0.1em; box-sizing: border-box; opacity: ${COUNT_REST_OPACITY};
  font: 900 clamp(28px, 9vmin, 56px)/1.05 ui-monospace, 'Courier New', monospace; text-transform: uppercase;
  color: #f2ead8; text-shadow: 0 0 4px #111, 2px 2px 0 #111; transform-origin: 50% 50%;
  animation: tb-count-in 0.5s cubic-bezier(0.2, 0.7, 0.3, 1); }
#countdown .count.first { animation: tb-count-first 0.8s cubic-bezier(0.2, 0.7, 0.3, 1); }
#countdown .count.go { color: #f5c542; }
@keyframes tb-count-in {
  from { transform: scale(${COUNT_PEAK_SCALE}); opacity: 1; text-shadow: 0 0 14px #f5c542, 2px 2px 0 #111; }
  to { transform: scale(1); opacity: ${COUNT_REST_OPACITY}; text-shadow: 0 0 4px #111, 2px 2px 0 #111; } }
@keyframes tb-count-first {
  from { transform: scale(${COUNT_FIRST_PEAK_SCALE}); opacity: 1; text-shadow: 0 0 18px #f5c542, 2px 2px 0 #111; }
  35% { transform: scale(${COUNT_PEAK_SCALE}); opacity: 1; text-shadow: 0 0 14px #f5c542, 2px 2px 0 #111; }
  to { transform: scale(1); opacity: ${COUNT_REST_OPACITY}; text-shadow: 0 0 4px #111, 2px 2px 0 #111; } }
@media (prefers-reduced-motion: reduce) { #countdown .count, #countdown .count.first { animation: none; } }
`;

/** The number's classes: `go` for GO, `first` for the first number after the grid appears. */
export function countClasses(text: string, previous: string): string {
  return ['count', ...(text === 'GO' ? ['go'] : []), ...(previous === '' ? ['first'] : [])].join(' ');
}

export interface CountdownView {
  readonly root: HTMLElement;
  /** Shows "3", "2", "1" or "GO"; null or "" hides the number. */
  set(text: string | null): void;
}

export function createCountdownView(): CountdownView {
  const root = document.createElement('div');
  root.id = 'countdown';
  root.hidden = true;
  // A screen reader hears each beat; the sound and the picture carry it for everyone else.
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  let shown = '';
  return {
    root,
    set(text) {
      const next = text ?? '';
      if (next === shown) return;
      const previous = shown;
      shown = next;
      root.hidden = next === '';
      if (next === '') {
        root.replaceChildren();
        return;
      }
      const label = document.createElement('span');
      label.className = countClasses(next, previous);
      label.textContent = next;
      root.replaceChildren(label);
    },
  };
}
