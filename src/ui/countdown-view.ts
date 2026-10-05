// The race-start countdown's number (playtest 4, P4-11): a big 3, 2, 1 and GO in the middle of the
// race screen while app/ holds the sim at the grid. It sits in the road-ahead box the HUD layout
// keeps clear (ui/hud-layout.ts: the middle half across, 25 to 65 % down), centred in it, so it
// covers no other HUD piece by construction, and it takes no touch. Sized by the screen's short side
// so it fits a 568x320 phone and a 320x568 one alike. Each change makes a fresh element, which
// restarts its small pop; reduced motion gets no pop. [default]

export const COUNTDOWN_CSS = `
#countdown { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); z-index: 1;
  pointer-events: none; text-align: center; }
#countdown[hidden] { display: none; }
#countdown .count { display: inline-block; min-width: 1.4em; padding: 0 0.22em; box-sizing: border-box;
  font: 900 clamp(48px, 22vmin, 150px)/1.05 ui-monospace, 'Courier New', monospace; text-transform: uppercase;
  color: #f2ead8; background: #111; box-shadow: 4px 4px 0 #e0543a; transform: rotate(-2deg);
  animation: tb-count-pop 0.32s ease-out; }
#countdown .count.go { color: #f5c542; }
@keyframes tb-count-pop { from { transform: rotate(-2deg) scale(1.35); opacity: 0.4; } to { transform: rotate(-2deg) scale(1); opacity: 1; } }
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
