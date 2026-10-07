// assets: one manifest for every asset (docs/architecture.md, "Asset manifest"; docs/milestones/
// M1.md, assets-1). Code refers to assets by id only; the manifest maps each id to a `baked`,
// `remote` or `procedural` source. Baked files load relative to the build's base URL with
// per-asset progress and a SHA-256 check; any failure (missing file, bad hash, bad decode, no
// network) falls back to the caller's procedural stand-in instead of breaking the race. The
// `remote` source is a seam until the first remote asset ships. `dataset` files (run W-Q: big
// models pinned in assets.lock.json, ./dataset.ts) are baked into the build, so they load exactly
// like `baked` ones, hash-checked against the lock.
import type { AssetIndexEntry, PackIndexFn } from '../core';

export { datasetIndex, datasetRegions } from './dataset';

export type AssetSourceKind = AssetIndexEntry['source'];

export interface AssetLoad<T> {
  id: string;
  /** Where the value came from: `procedural` also when a stand-in replaced a failed load. */
  source: AssetSourceKind;
  value: T;
  /** Set when the asset failed or is unknown and the procedural stand-in was used instead. */
  fellBack: boolean;
  /** Why it fell back, in plain words. */
  error?: string;
  /**
   * Set (true) when it fell back because of the host, not the file: a 429 or other busy or briefly down
   * answer, or no connection. The manifest asks for it again on the next `load`, and a caller that keeps
   * its own record of a failed asset keeps it only until then.
   */
  retryable?: true;
  /** The wait the host asked for in ms (the answer's Retry-After), when it asked for one that can be waited out. */
  waitMs?: number;
}

export type AssetStatus = 'pending' | 'loading' | 'loaded' | 'fallback';

export interface AssetProgress {
  /** Assets known or asked for. */
  total: number;
  /** Loaded or fallen back. */
  done: number;
  fellBack: number;
  bytesLoaded: number;
  /** The manifest's byte counts, or the real size once an asset has loaded. */
  bytesTotal: number;
  perAsset: Readonly<Record<string, AssetStatus>>;
}

export interface LoadOptions<T> {
  /** Turns a baked or remote file's bytes into the value. Without one, the stand-in is used. */
  decode?: (data: ArrayBuffer, entry: AssetIndexEntry) => T | Promise<T>;
}

export interface AssetManifest {
  entries(): readonly AssetIndexEntry[];
  resolve(id: string): AssetIndexEntry | null;
  /**
   * Loads an asset, or returns the procedural stand-in when it is missing or fails; it rejects only
   * if the stand-in itself throws. Each id loads once and later calls share the first result, except
   * that a fall-back with `retryable` set (the host's wait, a busy host, no connection) is not kept:
   * the next call asks again (polish batch L).
   */
  load<T>(id: string, standIn: () => T, opts?: LoadOptions<T>): Promise<AssetLoad<T>>;
  progress(): AssetProgress;
  /** Called on every progress change; returns an unsubscribe function. */
  onProgress(listener: (p: AssetProgress) => void): () => void;
  /**
   * Called with an asset's id when the wait the host held it back by (the answer's Retry-After) has passed
   * and the asset is still not loaded: the caller can ask for it again (`load`) in the same race (lane T2,
   * after polish L's check). Only a fall-back with `retryable` and a wait calls it; a 404, a connection
   * failure and an answer with no readable wait do not, and after WAIT_ASKS_MAX of them in a row for one id
   * it stops until that id loads. Returns an unsubscribe function.
   */
  onRetryReady(listener: (id: string) => void): () => void;
}

export interface AssetManifestOptions {
  /** URLs resolve against this (the build uses a relative base, so it is the page's own URL). */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Runs `run` after `ms` and returns a cancel; the clock's own timer by default (a test's fires by hand). */
  later?: (run: () => void, ms: number) => () => void;
}

/** The longest host wait the manifest sets a timer for; a longer one waits for the next race (ms). [default] */
export const WAIT_ASK_CAP_MS = 5 * 60 * 1000;
/** A little past the wait, so the loader's hold has ended when the ask is made (ms). [default] */
export const WAIT_ASK_MARGIN_MS = 250;
/** How many waits in a row one asset is asked for again after; a host that keeps holding is not chased. [default] */
export const WAIT_ASKS_MAX = 3;

/** The wait a Retry-After value asks for in ms (whole seconds or an HTTP date); null when it is none or unreadable. */
function waitOf(value: string | null): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) && ms > 0 && ms <= WAIT_ASK_CAP_MS ? ms : null;
}

function defaultBase(): string {
  return typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
}

/** Answers that say the host was busy or briefly down, not "no such file" (platform/'s retry-fetch.ts's rule). */
const hostTrouble = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads a response body, reporting bytes as they arrive. */
async function readBody(res: Response, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
    onBytes(size);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out.buffer;
}

export function createAssetManifest(packIndex: PackIndexFn, opts: AssetManifestOptions = {}): AssetManifest {
  const list = [...packIndex()];
  const byId = new Map(list.map((e) => [e.id, e]));
  const status = new Map<string, AssetStatus>(list.map((e) => [e.id, 'pending']));
  const loadedBytes = new Map<string, number>();
  const inFlight = new Map<string, Promise<AssetLoad<unknown>>>();
  const listeners = new Set<(p: AssetProgress) => void>();
  const readyListeners = new Set<(id: string) => void>();
  /** The timers waiting for a host wait to pass, by asset id, and how many waits in a row each has been asked after. */
  const waiting = new Map<string, () => void>();
  const waitAsks = new Map<string, number>();
  const later =
    opts.later ??
    ((run: () => void, ms: number) => {
      const t = setTimeout(run, ms);
      return () => clearTimeout(t);
    });
  const baseUrl = opts.baseUrl ?? defaultBase();
  const fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const progress = (): AssetProgress => {
    let done = 0;
    let fellBack = 0;
    let bytesLoaded = 0;
    let bytesTotal = 0;
    const perAsset: Record<string, AssetStatus> = {};
    for (const [id, s] of status) {
      perAsset[id] = s;
      if (s === 'loaded' || s === 'fallback') done++;
      if (s === 'fallback') fellBack++;
      const got = loadedBytes.get(id) ?? 0;
      bytesLoaded += got;
      bytesTotal += Math.max(byId.get(id)?.bytes ?? 0, got);
    }
    return { total: status.size, done, fellBack, bytesLoaded, bytesTotal, perAsset };
  };
  const emit = () => {
    if (listeners.size === 0) return;
    const p = progress();
    for (const l of listeners) l(p);
  };
  const settle = <T>(result: AssetLoad<T>): AssetLoad<T> => {
    status.set(result.id, result.fellBack ? 'fallback' : 'loaded');
    emit();
    return result;
  };
  const fallBack = <T>(
    id: string,
    standIn: () => T,
    error: string,
    retryable = false,
    waitMs: number | null = null,
  ): AssetLoad<T> =>
    settle({
      id,
      source: 'procedural',
      value: standIn(),
      fellBack: true,
      error,
      ...(retryable ? { retryable: true as const } : {}),
      ...(retryable && waitMs !== null ? { waitMs } : {}),
    });

  /** Once the wait an answer asked for has passed, tells the listeners, if the asset is still not in. */
  const askWhenWaitPasses = (id: string, waitMs: number) => {
    const asks = waitAsks.get(id) ?? 0;
    if (asks >= WAIT_ASKS_MAX || waiting.has(id)) return;
    waitAsks.set(id, asks + 1);
    const cancel = later(() => {
      waiting.delete(id);
      // Loaded since (the next race asked first), or already being asked for again: nothing to say.
      if (status.get(id) !== 'fallback' || inFlight.has(id)) return;
      for (const l of [...readyListeners]) l(id);
    }, waitMs + WAIT_ASK_MARGIN_MS);
    waiting.set(id, cancel);
  };

  async function loadFile<T>(
    entry: AssetIndexEntry,
    standIn: () => T,
    o: LoadOptions<T>,
  ): Promise<AssetLoad<T>> {
    if (entry.source === 'remote')
      return fallBack(entry.id, standIn, 'the remote source is not built yet (M1)');
    if (!o.decode) return fallBack(entry.id, standIn, 'no decoder for a baked asset');
    const url = new URL(entry.path, baseUrl).href;
    let data: ArrayBuffer;
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        // The host was busy or asked for a wait (the loader's hold answers 429 too): asked for again later.
        // The answer's small error body is left unread (not cancelled): a cancel showed in the network
        // record as a net::ERR_ABORTED beside every failed model answer (polish L's punch item 3).
        const trouble = hostTrouble(res.status);
        return fallBack(
          entry.id,
          standIn,
          `HTTP ${res.status} for ${entry.path}`,
          trouble,
          trouble ? waitOf(res.headers.get('Retry-After')) : null,
        );
      }
      data = await readBody(res, (n) => {
        loadedBytes.set(entry.id, n);
        emit();
      });
    } catch (err) {
      return fallBack(entry.id, standIn, `network: ${String(err)}`, true);
    }
    // Without SubtleCrypto (an insecure origin) the check cannot run; the file is still used.
    if (entry.hash && typeof crypto !== 'undefined' && crypto.subtle) {
      const actual = hex(await crypto.subtle.digest('SHA-256', data));
      if (actual !== entry.hash.toLowerCase())
        return fallBack(entry.id, standIn, `hash mismatch for ${entry.path}`);
    }
    try {
      const value = await o.decode(data, entry);
      return settle({ id: entry.id, source: entry.source, value, fellBack: false });
    } catch (err) {
      return fallBack(entry.id, standIn, `decode: ${String(err)}`);
    }
  }

  return {
    entries: () => list,
    resolve: (id) => byId.get(id) ?? null,
    progress,
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onRetryReady(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    load<T>(id: string, standIn: () => T, o: LoadOptions<T> = {}): Promise<AssetLoad<T>> {
      const running = inFlight.get(id) as Promise<AssetLoad<T>> | undefined;
      if (running) return running;
      const entry = byId.get(id);
      status.set(id, 'loading');
      emit();
      let p: Promise<AssetLoad<T>>;
      if (!entry) p = Promise.resolve(fallBack(id, standIn, 'not in the manifest'));
      else if (entry.source === 'procedural')
        p = Promise.resolve().then(() =>
          settle({ id, source: 'procedural' as const, value: standIn(), fellBack: false }),
        );
      else p = loadFile(entry, standIn, o);
      inFlight.set(id, p);
      // A fall-back the host caused is not kept: the next load asks again, once the loader lets it.
      void p.then(
        (res) => {
          if (res.retryable && inFlight.get(id) === p) inFlight.delete(id);
          if (!res.fellBack) waitAsks.delete(id);
          else if (res.retryable && res.waitMs !== undefined) askWhenWaitPasses(id, res.waitMs);
        },
        () => undefined,
      );
      return p;
    },
  };
}
