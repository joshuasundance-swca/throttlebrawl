// The load-failed card (polish lane K2; playtest 4 run A's second fix check: one failed San
// Francisco map file left the region with 0 routes for 15 s and no word). platform/retry-fetch.ts
// already tried the fetch again a few times; when a region's or the Keys' road data still did not
// load, the player is told in plain words and gets a Retry button, never a silent empty list.
// Polish batch D's check (punch items 1 and 2): the words follow the failure. "Check the connection"
// only when the network failed; when the host answered (a 404 with no deploy, a 429, a 5xx) the game
// server had a problem; and when its answer asked for a wait (Retry-After), Retry stays off until the
// wait has passed, showing it. The loader gives up at once on a wait over its cap
// (RETRY_AFTER_CAP_MS), so without this nobody would wait it out and Retry would ask again at once.
import { HttpLoadError } from '../content';
import { retryAfterMsOf } from '../platform';

/** What the card needs from ui/ (`GameUi.offerRetry`). */
export interface RetryCard {
  offerRetry(text: string | null, onRetry: (() => void) | null, opts?: { waitMs?: number }): void;
}

/** Why a load failed: the network, or the host's answer (its status, and the wait it asked for). */
export type LoadFailure = { kind: 'network' } | { kind: 'host'; status: number; waitMs: number };

/**
 * The failure a load's error stands for. content/ throws an `HttpLoadError` when the host answered
 * with an error, and a body that is not the data (an error page) fails to parse; anything else (the
 * fetch's own TypeError) is the network.
 */
export function failureOf(err: unknown, now: number): LoadFailure {
  if (err instanceof HttpLoadError)
    return { kind: 'host', status: err.status, waitMs: retryAfterMsOf(err.retryAfter, now) ?? 0 };
  if (err instanceof SyntaxError) return { kind: 'host', status: 200, waitMs: 0 };
  return { kind: 'network' };
}

/** The card's words for a region (or road set) called `name`. */
export const loadFailedText = (name: string, failure: LoadFailure): string =>
  failure.kind === 'network'
    ? `${name} did not load. Check the connection, then tap Retry.`
    : `${name} did not load: the game server had a problem. Try again shortly.`;

/**
 * Shows the card; Retry hides it and runs `again`, which shows it again if it fails again. A host's
 * wait keeps Retry off until it has passed.
 */
export function offerLoadRetry(card: RetryCard, name: string, again: () => void, failure: LoadFailure): void {
  const waitMs = failure.kind === 'host' ? failure.waitMs : 0;
  card.offerRetry(
    loadFailedText(name, failure),
    () => {
      card.offerRetry(null, null);
      again();
    },
    waitMs > 0 ? { waitMs } : undefined,
  );
}

/** Hides the card (the data arrived, or the player picked something else). */
export const clearLoadRetry = (card: RetryCard): void => card.offerRetry(null, null);
