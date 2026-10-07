// The load-failed card (polish lane K2; playtest 4 run A's second fix check: one failed San
// Francisco map file left the region with 0 routes for 15 s and no word). platform/retry-fetch.ts
// already tried the fetch again a few times; when a region's or the Keys' road data still did not
// load, the player is told in plain words and gets a button, never a silent empty list.
// Polish batch D's check (punch items 1 and 2): the words follow the failure. "Check the connection"
// only when the network failed; when the host answered with a 429 or a 5xx the game server had a
// problem; and when its answer asked for a wait (Retry-After), Retry stays off until the wait has
// passed, showing it. The loader holds every build file back until that wait has passed too
// (retry-fetch.ts), so a pick or a Race tap during it gets the same wait at once, never a burst.
// Polish batch E's check (punch item 3): a 404 or 410 is this build's files gone, most often because a
// newer build replaced them. Retry would only get the same answer, so the card says so and offers
// Reload, for the newest build.
import { HttpLoadError } from '../content';
import { retryAfterMsOf } from '../platform';

/** What the card needs from ui/ (`GameUi.offerRetry`). */
export interface RetryCard {
  offerRetry(
    text: string | null,
    onRetry: (() => void) | null,
    opts?: { waitMs?: number; action?: 'retry' | 'reload' },
  ): void;
}

/**
 * Why a load failed: the network; the host's answer (its status, and the wait it asked for); or a
 * file the host no longer has (404 or 410: this build's files are gone).
 */
export type LoadFailure =
  { kind: 'network' } | { kind: 'host'; status: number; waitMs: number } | { kind: 'gone'; status: number };

/** Statuses for a build file the host no longer has (stale-build.ts's rule). */
const GONE = new Set([404, 410]);

/**
 * The failure a load's error stands for. content/ throws an `HttpLoadError` when the host answered
 * with an error, and a body that is not the data (an error page) fails to parse; anything else (the
 * fetch's own TypeError) is the network.
 */
export function failureOf(err: unknown, now: number): LoadFailure {
  if (err instanceof HttpLoadError) {
    if (GONE.has(err.status)) return { kind: 'gone', status: err.status };
    return { kind: 'host', status: err.status, waitMs: retryAfterMsOf(err.retryAfter, now) ?? 0 };
  }
  if (err instanceof SyntaxError) return { kind: 'host', status: 200, waitMs: 0 };
  return { kind: 'network' };
}

/** The card's words for a region (or road set) called `name`. */
export function loadFailedText(name: string, failure: LoadFailure): string {
  switch (failure.kind) {
    case 'network':
      return `${name} did not load. Check the connection, then tap Retry.`;
    case 'gone':
      return `${name} did not load: this build's files are gone, most likely because a newer build replaced them. Reload for the newest build.`;
    case 'host':
      return `${name} did not load: the game server had a problem. Try again shortly.`;
  }
}

/**
 * The word in the route row's place while the picked region's roads are not in (polish batch E's
 * check, punch item 1: once the card had gone with its screen, the menu showed the pick with no route
 * row and no word). Race fetches them again, so it is what the player taps.
 */
export function routesNote(name: string, state: LoadFailure | 'loading'): string {
  if (state === 'loading') return `Loading ${name}…`;
  switch (state.kind) {
    case 'network':
      return `${name} did not load. Check the connection, then tap Race to try again.`;
    case 'gone':
      return `${name} did not load: this build's files are gone. Reload the game for the newest build.`;
    case 'host':
      return `${name} did not load: the game server had a problem. Tap Race to try again shortly.`;
  }
}

/**
 * Shows the card. Retry hides it and runs `again`, which shows it again if it fails again; a host's
 * wait keeps Retry off until it has passed. For a build whose files are gone the button is Reload,
 * which runs `reload` (the page, for the newest build) and never asks the host again.
 */
export function offerLoadRetry(
  card: RetryCard,
  name: string,
  again: () => void,
  failure: LoadFailure,
  reload: () => void,
): void {
  const text = loadFailedText(name, failure);
  if (failure.kind === 'gone') {
    card.offerRetry(text, reload, { action: 'reload' });
    return;
  }
  const waitMs = failure.kind === 'host' ? failure.waitMs : 0;
  card.offerRetry(
    text,
    () => {
      card.offerRetry(null, null);
      again();
    },
    waitMs > 0 ? { waitMs } : undefined,
  );
}

/** Hides the card (the data arrived, or the player picked something else). */
export const clearLoadRetry = (card: RetryCard): void => card.offerRetry(null, null);
