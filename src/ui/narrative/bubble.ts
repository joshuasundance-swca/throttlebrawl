// The bark bubble: one text bubble at a time, top centre, large and high-contrast so it reads at
// speed on a phone. It carries the line's content reference for the "cut this" long-press
// (docs/architecture.md, "In-game veto"). It never takes a touch itself (pointer-events none), so
// it can never steal one from steering: veto-ui.ts watches presses on its box from the document
// and ignores those that start in the stick or attack zones. It sits under every other layer of
// the UI root (z-index -1), so a bubble still up when the game pauses never covers the pause menu.
import type { BarkView, ShownBark } from './director';

const CSS = `
#bark-bubble { position: absolute; z-index: -1; left: 50%; top: max(74px, env(safe-area-inset-top)); transform: translateX(-50%);
  max-width: min(80vw, 560px); padding: 8px 14px 9px; border-radius: 14px; background: rgb(255 255 255 / 94%);
  color: #111; font: 700 20px/1.25 system-ui, sans-serif; text-align: center; pointer-events: none;
  box-shadow: 0 3px 0 rgb(0 0 0 / 55%); }
#bark-bubble[hidden] { display: none; }
#bark-bubble.held { outline: 3px solid #f5c542; }
#bark-bubble::after { content: ''; position: absolute; left: 50%; bottom: -9px; margin-left: -9px;
  border: 9px solid transparent; border-bottom: 0; border-top-color: rgb(255 255 255 / 94%); }
#bark-bubble .bark-speaker { display: block; font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: #b3261e; }
/* Where it sits (the HUD layout check, tests/e2e/ui-style-popups.spec.ts). On a big screen, under
   the heat badge and the career objective at the top centre. On a narrow one, right under the top
   row (the badge and the objective sit under the bubble there). On a phone held sideways the top
   centre is the bubble's alone, and it ends above the road ahead (a quarter of the way down): it
   sits at the top, a little narrower so it clears the rival's bar beside it, with tighter lines.
   [default] */
@media (max-width: 600px) { #bark-bubble { top: max(52px, env(safe-area-inset-top)); } }
@media (orientation: landscape) and (max-height: 520px) {
  #bark-bubble { top: max(6px, env(safe-area-inset-top)); max-width: min(38vw, 560px); padding: 5px 14px 6px;
    box-sizing: border-box; line-height: 1.15; }
}
@media (orientation: landscape) and (max-height: 380px) { #bark-bubble { font-size: 18px; } }
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

/**
 * Sent on `window` whenever a bark shows, so its voice plays with its subtitle (the maintainer,
 * 2026-10-01: "Voices go in"). src/audio/bark-voices.ts listens; a line cut with "cut this" never
 * shows again, so it is never spoken again either.
 */
const BARK_SHOWN_EVENT = 'throttlebrawl:bark';
/** Sent back by audio when the line's voice starts, with its length: the subtitle stays as long. */
const BARK_VOICE_EVENT = 'throttlebrawl:bark-voice';
/** The subtitle outlasts its voice by this much. [default] */
const VOICE_TAIL_MS = 250;
/**
 * A bark that comes while another rival is still speaking waits for that voice to finish, so no
 * line is cut off mid-word; one that would wait longer than this is dropped (silence beats a late
 * line). [default]
 */
const QUEUE_MAX_MS = 2500;

function announce(bark: ShownBark) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const { contentRef, speakerName, text, durationS } = bark;
  window.dispatchEvent(
    new CustomEvent(BARK_SHOWN_EVENT, { detail: { contentRef, speakerName, text, durationS } }),
  );
}

/** A DOM view. The host is found when the first bark shows (the UI root, else the body). */
export function createBubbleView(host?: () => HTMLElement | null): BubbleView {
  let bubble: HTMLElement | null = null;
  let speaker: HTMLElement | null = null;
  let text: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown: ShownBark | null = null;
  let held = false;
  let expired = false;
  /** When the bubble's own time runs out (performance.now ms). */
  let endsAt = 0;
  /** When the line on screen stops speaking (performance.now ms; 0 = no voice). */
  let speakingUntil = 0;
  let queued: ShownBark | null = null;
  let queuedAt = 0;
  let queueTimer: ReturnType<typeof setTimeout> | null = null;

  // A voiced line keeps its subtitle up until the voice finishes ("Subtitled always").
  const onVoice = (ev: Event) => {
    const d = (ev as CustomEvent<{ contentRef?: unknown; durationS?: unknown }>).detail;
    if (!shown || d?.contentRef !== shown.contentRef || typeof d.durationS !== 'number') return;
    speakingUntil = performance.now() + d.durationS * 1000;
    if (held || expired) return;
    const until = speakingUntil + VOICE_TAIL_MS;
    if (until <= endsAt) return;
    endsAt = until;
    clear();
    timer = setTimeout(expire, until - performance.now());
  };

  const mount = () => {
    if (bubble) return bubble;
    window.addEventListener(BARK_VOICE_EVENT, onVoice);
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
  const clearQueue = () => {
    if (queueTimer !== null) clearTimeout(queueTimer);
    queueTimer = null;
    queued = null;
  };
  const hide = () => {
    clear();
    clearQueue();
    speakingUntil = 0;
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

  const display = (bark: ShownBark) => {
    const el = mount();
    if (speaker) speaker.textContent = bark.speakerName;
    if (text) text.textContent = bark.text;
    el.dataset.contentRef = bark.contentRef;
    el.hidden = false;
    shown = bark;
    expired = false;
    speakingUntil = 0;
    clear();
    endsAt = performance.now() + bark.durationS * 1000;
    timer = setTimeout(expire, bark.durationS * 1000);
    announce(bark);
  };
  const flush = () => {
    queueTimer = null;
    const next = queued;
    queued = null;
    if (next && performance.now() - queuedAt <= QUEUE_MAX_MS) display(next);
  };

  return {
    show(bark: ShownBark) {
      const now = performance.now();
      if (shown && now < speakingUntil) {
        // Another rival is mid-line: this one goes up when that voice finishes (the latest wins).
        if (queueTimer !== null) clearTimeout(queueTimer);
        queued = bark;
        queuedAt = now;
        queueTimer = setTimeout(flush, speakingUntil - now);
        return;
      }
      clearQueue();
      display(bark);
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
