import { describe, expect, it } from 'vitest';
import { HttpLoadError } from '../content';
import {
  clearLoadRetry,
  failureOf,
  loadFailedText,
  offerLoadRetry,
  type LoadFailure,
  type RetryCard,
} from './load-retry';

// A road set that still did not load, after platform/retry-fetch.ts's tries, is said on the screen
// in plain words with a Retry button (polish lane K2), never a silent empty list. The words follow the
// failure (polish batch D's check, punch items 1 and 2): "Check the connection" only when the network
// failed; when the host answered (a 404 with no deploy, a 429, a 5xx) the game server had a problem;
// and a Retry-After the loader did not wait out keeps Retry off until the wait has passed.

/** A stand-in for the card ui/ shows: the text, button and wait it has now. */
function card() {
  const shown = {
    text: null as string | null,
    retry: null as (() => void) | null,
    waitMs: 0 as number | undefined,
  };
  const c: RetryCard = {
    offerRetry(text, onRetry, opts) {
      shown.text = text;
      shown.retry = onRetry;
      shown.waitMs = opts?.waitMs;
    },
  };
  return { c, shown };
}

const NETWORK: LoadFailure = { kind: 'network' };

describe('the load-failed card', () => {
  it('says which region did not load, in plain words, and offers Retry', () => {
    const { c, shown } = card();
    offerLoadRetry(c, 'San Francisco', () => undefined, NETWORK);
    expect(shown.text).toBe('San Francisco did not load. Check the connection, then tap Retry.');
    expect(shown.text).toBe(loadFailedText('San Francisco', NETWORK));
    expect(shown.retry).toBeTypeOf('function');
    expect(shown.waitMs ?? 0).toBe(0);
  });

  it('Retry hides the card and runs the load again, which may show it again', () => {
    const { c, shown } = card();
    let tries = 0;
    const load = () => {
      tries++;
      if (tries < 2) offerLoadRetry(c, 'San Francisco', load, NETWORK); // fails once more
    };
    offerLoadRetry(c, 'San Francisco', load, NETWORK);
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
    offerLoadRetry(c, 'The Keys', () => undefined, NETWORK);
    clearLoadRetry(c);
    expect(shown.text).toBeNull();
    expect(shown.retry).toBeNull();
  });
});

describe('the words follow the failure', () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const http = (status: number, retryAfter: string | null = null) =>
    new HttpLoadError(`could not load assets/x.json: HTTP ${status}`, status, retryAfter);

  it('a dropped connection is the network; a host answer is the game server', () => {
    expect(failureOf(new TypeError('Failed to fetch'), now)).toEqual({ kind: 'network' });
    expect(failureOf(http(404), now)).toEqual({ kind: 'host', status: 404, waitMs: 0 });
    expect(failureOf(http(503), now)).toEqual({ kind: 'host', status: 503, waitMs: 0 });
    // A body that is not the data (an error page served as 200) is the host's too.
    expect(failureOf(new SyntaxError('Unexpected token <'), now).kind).toBe('host');
  });

  it("reads the host's Retry-After, in seconds or as a date", () => {
    expect(failureOf(http(429, '9'), now)).toEqual({ kind: 'host', status: 429, waitMs: 9000 });
    const at = new Date(now + 20_000).toUTCString();
    expect(failureOf(http(503, at), now)).toEqual({ kind: 'host', status: 503, waitMs: 20_000 });
    expect(failureOf(http(429, 'soon'), now)).toEqual({ kind: 'host', status: 429, waitMs: 0 });
  });

  it('never blames the connection when the host answered', () => {
    for (const status of [404, 429, 500, 503]) {
      const text = loadFailedText('San Francisco', { kind: 'host', status, waitMs: 0 });
      expect(text, String(status)).not.toMatch(/connection/i);
      expect(text).toBe('San Francisco did not load: the game server had a problem. Try again shortly.');
    }
  });

  it("a Retry-After keeps Retry off for the host's wait (over the loader's 8 s cap, no one else waits it out)", () => {
    const { c, shown } = card();
    offerLoadRetry(c, 'San Francisco', () => undefined, { kind: 'host', status: 429, waitMs: 9000 });
    expect(shown.waitMs).toBe(9000);
    expect(shown.text).not.toMatch(/connection/i);
  });
});
