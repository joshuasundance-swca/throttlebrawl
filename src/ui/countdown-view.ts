// The race-start countdown's number (playtest 4, P4-11; made small and clear of the road after the
// maintainer's 2026-10-05 veto: "The 3 2 1 countdown blocks visibility of what's directly ahead so it's
// hard to plan your start. It should be less obstructive."). It stands beside the road, never in it: a
// small, translucent number centred in the strip left of the road-ahead box the HUD layout keeps clear
// (ui/hud-layout.ts: the middle half across, 25 to 65 % down), at 45 % down, so it covers neither the road
// ahead nor the top band's pieces, and it takes no touch. Sized by the screen's short side and held
// inside that strip (a quarter of the width) so it fits a 568x320 phone and a 412x915 one alike. Each
// change makes a fresh element, which restarts its small fade-in; reduced motion gets none. [default]

export const COUNTDOWN_CSS = `
#countdown { position: absolute; left: 0; width: 25%; top: 45%; transform: translateY(-50%); z-index: 1;
  pointer-events: none; text-align: center; overflow: hidden; }
#countdown[hidden] { display: none; }
#countdown .count { display: inline-block; padding: 0 0.1em; box-sizing: border-box; opacity: 0.6;
  font: 900 clamp(28px, 9vmin, 56px)/1.05 ui-monospace, 'Courier New', monospace; text-transform: uppercase;
  color: #f2ead8; text-shadow: 0 0 4px #111, 2px 2px 0 #111; animation: tb-count-pop 0.25s ease-out; }
#countdown .count.go { color: #f5c542; }
@keyframes tb-count-pop { from { opacity: 0.15; } to { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { #countdown .count { animation: none; } }
`;

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
      shown = next;
      root.hidden = next === '';
      if (next === '') {
        root.replaceChildren();
        return;
      }
      const label = document.createElement('span');
      label.className = next === 'GO' ? 'count go' : 'count';
      label.textContent = next;
      root.replaceChildren(label);
    },
  };
}
