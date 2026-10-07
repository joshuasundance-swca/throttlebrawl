import { describe, expect, it } from 'vitest';
import { HttpLoadError } from '../content';
import { WAIT_SLOT } from '../ui';
import {
  clearLoadRetry,
  failureOf,
  loadFailedText,
  offerLoadRetry,
  routesNote,
  routesNoteView,
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
    action: undefined as 'retry' | 'reload' | undefined,
  };
  const c: RetryCard = {
    offerRetry(text, onRetry, opts) {
      shown.text = text;
      shown.retry = onRetry;
      shown.waitMs = opts?.waitMs;
      shown.action = opts?.action;
    },
  };
  return { c, shown };
}

const NETWORK: LoadFailure = { kind: 'network' };
const noReload = () => undefined;

describe('the load-failed card', () => {
  it('says which region did not load, in plain words, and offers Retry', () => {
    const { c, shown } = card();
    offerLoadRetry(c, 'San Francisco', () => undefined, NETWORK, noReload);
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
      if (tries < 2) offerLoadRetry(c, 'San Francisco', load, NETWORK, noReload); // fails once more
    };
    offerLoadRetry(c, 'San Francisco', load, NETWORK, noReload);
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
    offerLoadRetry(c, 'The Keys', () => undefined, NETWORK, noReload);
    clearLoadRetry(c);
    expect(shown.text).toBeNull();
    expect(shown.retry).toBeNull();
  });
});

describe('the words follow the failure', () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const http = (status: number, retryAfter: string | null = null) =>
    new HttpLoadError(`could not load assets/x.json: HTTP ${status}`, status, retryAfter);

  it("a dropped connection is the network; a host answer is the game server; a 404 or 410 is this build's files gone", () => {
    expect(failureOf(new TypeError('Failed to fetch'), now)).toEqual({ kind: 'network' });
    expect(failureOf(http(404), now)).toEqual({ kind: 'gone', status: 404 });
    expect(failureOf(http(410), now)).toEqual({ kind: 'gone', status: 410 });
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
    for (const status of [429, 500, 503]) {
      const text = loadFailedText('San Francisco', { kind: 'host', status, waitMs: 0 });
      expect(text, String(status)).not.toMatch(/connection/i);
      expect(text).toBe('San Francisco did not load: the game server had a problem. Try again shortly.');
    }
  });

  // Polish batch E's check, punch item 3: a 404 said "Try again shortly" with Retry on at once, but
  // with no deploy every tap got the same 404. A build file the host no longer has is gone, most often
  // because a newer build replaced it: the card says so and offers Reload, not Retry.
  it("a 404 or 410 says this build's files are gone and offers Reload, never Retry", () => {
    const gone: LoadFailure = { kind: 'gone', status: 404 };
    expect(loadFailedText('San Francisco', gone)).toBe(
      "San Francisco did not load: this build's files are gone, most likely because a newer build replaced them. Reload for the newest build.",
    );
    const { c, shown } = card();
    let reloads = 0;
    let tries = 0;
    offerLoadRetry(
      c,
      'San Francisco',
      () => tries++,
      gone,
      () => reloads++,
    );
    expect(shown.action).toBe('reload');
    shown.retry?.();
    expect(reloads, 'the button reloads').toBe(1);
    expect(tries, 'and never asks the host again for the same files').toBe(0);
  });

  it('control: the cases Retry can fix keep Retry', () => {
    for (const failure of [NETWORK, { kind: 'host', status: 503, waitMs: 0 } as const]) {
      const { c, shown } = card();
      let tries = 0;
      offerLoadRetry(
        c,
        'San Francisco',
        () => tries++,
        failure,
        () => undefined,
      );
      expect(shown.action ?? 'retry').toBe('retry');
      shown.retry?.();
      expect(tries).toBe(1);
    }
  });

  it("a Retry-After keeps Retry off for the host's wait (over the loader's 8 s cap, no one else waits it out)", () => {
    const { c, shown } = card();
    offerLoadRetry(
      c,
      'San Francisco',
      () => undefined,
      { kind: 'host', status: 429, waitMs: 9000 },
      noReload,
    );
    expect(shown.waitMs).toBe(9000);
    expect(shown.text).not.toMatch(/connection/i);
  });
});

// Polish batch E's check, punch item 1: after the did-not-load card went with its screen (Settings,
// Options or the career, then back), the menu showed San Francisco picked with no route row and no
// word until Race or a new pick. The menu never shows a pick without its route row or a word saying
// why: this word stands in the route row's place while the picked region's roads are not in.
describe("the word in the route row's place", () => {
  it('says the roads are loading, then why they did not load and what to tap', () => {
    expect(routesNote('San Francisco', 'loading')).toBe('Loading San Francisco…');
    expect(routesNote('San Francisco', NETWORK)).toBe(
      'San Francisco did not load. Check the connection, then tap Race to try again.',
    );
    expect(routesNote('San Francisco', { kind: 'host', status: 503, waitMs: 0 })).toBe(
      'San Francisco did not load: the game server had a problem. Tap Race to try again shortly.',
    );
    expect(routesNote('San Francisco', { kind: 'gone', status: 404 })).toBe(
      "San Francisco did not load: this build's files are gone. Reload the game for the newest build.",
    );
  });
});

// Polish batch I's check, punch 4: inside the host's wait the word said "Tap Race to try again
// shortly" for the whole wait, and after a 404 it said "Reload the game" with no button.
describe("the route row's word, inside the host's wait and after a 404", () => {
  const sf = 'San Francisco';
  it('carries the wait slot while the host asked for a wait, and says shortly when it did not', () => {
    expect(routesNote(sf, { kind: 'host', status: 429, waitMs: 30_000 })).toBe(
      `San Francisco did not load: the game server had a problem. Tap Race to try again${WAIT_SLOT}.`,
    );
    // Control: no wait asked for, so the old words stand and there is no slot to fill.
    const plain = routesNote(sf, { kind: 'host', status: 503, waitMs: 0 });
    expect(plain).toContain('Tap Race to try again shortly.');
    expect(plain).not.toContain(WAIT_SLOT);
    expect(routesNote(sf, NETWORK)).not.toContain(WAIT_SLOT);
  });

  it('gives a missing build the Reload action, and nothing else an action', () => {
    let reloaded = 0;
    const gone = routesNoteView(sf, { kind: 'gone', status: 404 }, () => reloaded++);
    expect(gone.text).toBe(routesNote(sf, { kind: 'gone', status: 404 }));
    expect(gone.action?.label).toBe('Reload');
    gone.action?.run();
    expect(reloaded).toBe(1);
    // Controls: the states with no Reload to offer have no action.
    for (const state of [NETWORK, 'loading', { kind: 'host', status: 503, waitMs: 0 }] as const)
      expect(routesNoteView(sf, state, () => reloaded++).action).toBeUndefined();
    expect(reloaded).toBe(1);
  });
});
