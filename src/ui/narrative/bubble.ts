// The bark bubble: one text bubble at a time, top centre, large and high-contrast so it reads at
// speed on a phone. It carries the line's content reference for the "cut this" long-press
// (docs/architecture.md, "In-game veto"). It never takes a touch itself (pointer-events none), so
// it can never steal one from steering: veto-ui.ts watches presses on its box from the document
// and ignores those that start in the stick or attack zones.
import type { BarkView, ShownBark } from './director';

const CSS = `
#bark-bubble { position: absolute; left: 50%; top: max(52px, env(safe-area-inset-top)); transform: translateX(-50%);
  max-width: min(80vw, 560px); padding: 8px 14px 9px; border-radius: 14px; background: rgb(255 255 255 / 94%);
  color: #111; font: 700 20px/1.25 system-ui, sans-serif; text-align: center; pointer-events: none;
  box-shadow: 0 3px 0 rgb(0 0 0 / 55%); }
#bark-bubble[hidden] { display: none; }
#bark-bubble.held { outline: 3px solid #f5c542; }
#bark-bubble::after { content: ''; position: absolute; left: 50%; bottom: -9px; margin-left: -9px;
  border: 9px solid transparent; border-bottom: 0; border-top-color: rgb(255 255 255 / 94%); }
#bark-bubble .bark-speaker { display: block; font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: #b3261e; }
`;

export interface BubbleView extends BarkView {
  /** The bark on screen, or null. */
  current(): ShownBark | null;
  /** The bubble element once mounted. */
  element(): HTMLElement | null;
  /** Holds the bubble up while a finger rests on it; releasing gives it a short grace. */
  hold(on: boolean): void;
}

/** How long a released bubble stays after its own time ran out while held. [default] */
const RELEASE_GRACE_MS = 1000;

/** A DOM view. The host is found when the first bark shows (the UI root, else the body). */
export function createBubbleView(host?: () => HTMLElement | null): BubbleView {
  let bubble: HTMLElement | null = null;
  let speaker: HTMLElement | null = null;
  let text: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown: ShownBark | null = null;
  let held = false;
  let expired = false;

  const mount = () => {
    if (bubble) return bubble;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    bubble = document.createElement('div');
    bubble.id = 'bark-bubble';
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    speaker = document.createElement('span');
    speaker.className = 'bark-speaker';
    text = document.createElement('span');
    text.className = 'bark-text';
    bubble.append(speaker, text);
    (host?.() ?? document.getElementById('ui') ?? document.body).append(bubble);
    return bubble;
  };

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const hide = () => {
    clear();
    held = false;
    expired = false;
    shown = null;
    if (bubble) {
      bubble.hidden = true;
      bubble.classList.remove('held');
    }
  };
  const expire = () => {
    timer = null;
    if (held) expired = true;
    else hide();
  };

  return {
    show(bark: ShownBark) {
      const el = mount();
      if (speaker) speaker.textContent = bark.speakerName;
      if (text) text.textContent = bark.text;
      el.dataset.contentRef = bark.contentRef;
      el.hidden = false;
      shown = bark;
      expired = false;
      clear();
      timer = setTimeout(expire, bark.durationS * 1000);
    },
    hide,
    current: () => shown,
    element: () => bubble,
    hold(on) {
      if (!shown || held === on) return;
      held = on;
      bubble?.classList.toggle('held', on);
      if (!on && expired) {
        expired = false;
        clear();
        timer = setTimeout(expire, RELEASE_GRACE_MS);
      }
    },
  };
}
