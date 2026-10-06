import { describe, expect, it } from 'vitest';
import { clearLoadRetry, loadFailedText, offerLoadRetry, type RetryCard } from './load-retry';

// A road set that still did not load, after platform/retry-fetch.ts's tries, is said on the screen
// in plain words with a Retry button (polish lane K2), never a silent empty list.

/** A stand-in for the card ui/ shows: the text and button it has now. */
function card() {
  const shown = { text: null as string | null, retry: null as (() => void) | null };
  const c: RetryCard = {
    offerRetry(text, onRetry) {
      shown.text = text;
      shown.retry = onRetry;
    },
  };
  return { c, shown };
}

describe('the load-failed card', () => {
  it('says which region did not load, in plain words, and offers Retry', () => {
    const { c, shown } = card();
    offerLoadRetry(c, 'San Francisco', () => undefined);
    expect(shown.text).toBe('San Francisco did not load. Check the connection, then tap Retry.');
    expect(shown.text).toBe(loadFailedText('San Francisco'));
    expect(shown.retry).toBeTypeOf('function');
  });

  it('Retry hides the card and runs the load again, which may show it again', () => {
    const { c, shown } = card();
    let tries = 0;
    const load = () => {
      tries++;
      if (tries < 2) offerLoadRetry(c, 'San Francisco', load); // fails once more
    };
    offerLoadRetry(c, 'San Francisco', load);
    shown.retry?.();
    expect(tries).toBe(1);
    expect(shown.text).not.toBeNull(); // failed again: the card is back
    shown.retry?.();
    expect(tries).toBe(2);
    expect(shown.text).toBeNull(); // loaded: the card stays hidden
    expect(shown.retry).toBeNull();
  });

  // The control: nothing shows until something fails, and clearing hides it.
  it('control: no card until a failure is offered, and clearing hides it', () => {
    const { c, shown } = card();
    expect(shown.text).toBeNull();
    offerLoadRetry(c, 'The Keys', () => undefined);
    clearLoadRetry(c);
    expect(shown.text).toBeNull();
    expect(shown.retry).toBeNull();
  });
});
