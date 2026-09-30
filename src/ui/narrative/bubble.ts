// The bark bubble: one text bubble at a time, top centre, large and high-contrast so it reads at
// speed on a phone. It carries the line's content reference for the M2 "cut this" long-press
// (docs/architecture.md, "In-game veto"); until then it ignores touches, so it never steals one.
import type { BarkView, ShownBark } from './director';

const CSS = `
#bark-bubble { position: absolute; left: 50%; top: max(52px, env(safe-area-inset-top)); transform: translateX(-50%);
  max-width: min(80vw, 560px); padding: 8px 14px 9px; border-radius: 14px; background: rgb(255 255 255 / 94%);
  color: #111; font: 700 20px/1.25 system-ui, sans-serif; text-align: center; pointer-events: none;
  box-shadow: 0 3px 0 rgb(0 0 0 / 55%); }
#bark-bubble[hidden] { display: none; }
#bark-bubble::after { content: ''; position: absolute; left: 50%; bottom: -9px; margin-left: -9px;
  border: 9px solid transparent; border-bottom: 0; border-top-color: rgb(255 255 255 / 94%); }
#bark-bubble .bark-speaker { display: block; font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: #b3261e; }
`;

/** A DOM view. The host is found when the first bark shows (the UI root, else the body). */
export function createBubbleView(host?: () => HTMLElement | null): BarkView {
  let bubble: HTMLElement | null = null;
  let speaker: HTMLElement | null = null;
  let text: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  const hide = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (bubble) bubble.hidden = true;
  };

  return {
    show(bark: ShownBark) {
      const el = mount();
      if (speaker) speaker.textContent = bark.speakerName;
      if (text) text.textContent = bark.text;
      el.dataset.contentRef = bark.contentRef;
      el.hidden = false;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(hide, bark.durationS * 1000);
    },
    hide,
  };
}
