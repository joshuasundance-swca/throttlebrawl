// The load-failed card (polish lane K2; playtest 4 run A's second fix check: one failed San
// Francisco map file left the region with 0 routes for 15 s and no word). platform/retry-fetch.ts
// already tried the fetch again a few times; when a region's or the Keys' road data still did not
// load, the player is told in plain words and gets a Retry button, never a silent empty list.

/** What the card needs from ui/ (`GameUi.offerRetry`). */
export interface RetryCard {
  offerRetry(text: string | null, onRetry: (() => void) | null): void;
}

/** The card's words for a region (or road set) called `name`. */
export const loadFailedText = (name: string): string =>
  `${name} did not load. Check the connection, then tap Retry.`;

/** Shows the card; Retry hides it and runs `again`, which shows it again if it fails again. */
export function offerLoadRetry(card: RetryCard, name: string, again: () => void): void {
  card.offerRetry(loadFailedText(name), () => {
    card.offerRetry(null, null);
    again();
  });
}

/** Hides the card (the data arrived, or the player picked something else). */
export const clearLoadRetry = (card: RetryCard): void => card.offerRetry(null, null);
