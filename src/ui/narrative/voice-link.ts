// The link between a bark on screen and its voice (the maintainer, 2026-10-01: "Voices go in").
// The ticker (ui/ticker-view.ts) announces a bark on `window` when it is DISPLAYED, not when it is
// queued, so the voice plays with its subtitle. src/audio/bark-voices.ts listens, plays the clip and
// answers with `throttlebrawl:bark-voice` and the clip's length, which keeps the subtitle up until
// the voice finishes ("Subtitled always"). A line cut with "cut this" never shows again, so it is
// never spoken again either. These two names are audio's too (bark-voices.ts exports the same).
import type { ShownBark } from './director';

/** Sent on `window` whenever a bark shows, so its voice plays with its subtitle. */
export const BARK_SHOWN_EVENT = 'throttlebrawl:bark';
/** Sent back by audio when the line's voice starts, with its length: the subtitle stays as long. */
export const BARK_VOICE_EVENT = 'throttlebrawl:bark-voice';

/** Tells audio a bark just showed. */
export function announceBark(
  bark: Pick<ShownBark, 'contentRef' | 'speakerName' | 'text' | 'durationS'>,
): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const { contentRef, speakerName, text, durationS } = bark;
  window.dispatchEvent(
    new CustomEvent(BARK_SHOWN_EVENT, { detail: { contentRef, speakerName, text, durationS } }),
  );
}

/** Listens for a voice starting; `handler` gets the line's reference and the voice's length in seconds. */
export function listenBarkVoice(handler: (contentRef: string, durationS: number) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onVoice = (ev: Event) => {
    const d = (ev as CustomEvent<{ contentRef?: unknown; durationS?: unknown }>).detail;
    if (typeof d?.contentRef !== 'string' || typeof d.durationS !== 'number') return;
    handler(d.contentRef, d.durationS);
  };
  window.addEventListener(BARK_VOICE_EVENT, onVoice);
  return () => window.removeEventListener(BARK_VOICE_EVENT, onVoice);
}
