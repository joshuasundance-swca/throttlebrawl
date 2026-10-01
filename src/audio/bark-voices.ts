// Spoken barks (the maintainer, 2026-10-01: "Voices go in"). When a bark's subtitle shows, its
// clip plays on the voices bus; the subtitle always shows, voiced or not. Presentation only: the
// sim never hears about it, and a missing, cut or slow clip just leaves the subtitle silent.
//
// - The clip for a line follows its content reference (docs/content-packs.md, "In-game veto"):
//   `<pack>:bark-set/<set>#<line>` is spoken by `packs/<pack>/assets/audio/barks/<set>/<line>.ogg`,
//   asset id `audio/barks/<set>/<line>` (its `audioAsset`). tools/voices makes the clips.
// - Clips load the first time their line is said (fetch, decode, keep the last few decoded), never
//   in the first-load bundle: the URL table itself is a lazy chunk (bark-clips.ts).
// - One voice at a time, like one bubble at a time: a new bark fades out the one before it.
// - A line cut with "cut this" never plays again on this device, and stops at once if it is playing.
// - A clip that arrives more than STALE_S after its subtitle showed is dropped (the moment passed).

/** The subtitle's event (src/ui/narrative/bubble.ts dispatches it on `window` when a bark shows). */
export const BARK_SHOWN_EVENT = 'throttlebrawl:bark';
/** Sent back when a line's voice starts, `{contentRef, durationS}`: the subtitle stays as long. */
export const BARK_VOICE_EVENT = 'throttlebrawl:bark-voice';

/** `<pack>:bark-set/<set>#<line>` (docs/content-packs.md, "In-game veto"). */
const BARK_REF = /^([a-z0-9][a-z0-9-]*):bark-set\/([a-z0-9][a-z0-9-]*)#([a-z0-9][a-z0-9-]*)$/;

/** A line's clip path in its pack (pack, then the asset path), or null for a non-bark reference. */
export function barkClipPath(contentRef: string): { packId: string; path: string } | null {
  const m = BARK_REF.exec(contentRef);
  if (!m) return null;
  return { packId: m[1] ?? '', path: `assets/audio/barks/${m[2] ?? ''}/${m[3] ?? ''}.ogg` };
}

/** Seconds after the subtitle showed when a clip still arriving is no longer worth playing. */
export const STALE_S = 1.5;
/** Decoded clips kept (about 60 KB of samples each at 48 kHz for 2.5 s of speech). */
const KEEP_DECODED = 24;
const FADE_S = 0.04;

export interface BarkVoiceOptions {
  /** A line's clip URL, or null when it has no clip. Default: the bundled table (lazy). */
  clipUrl?: (contentRef: string) => Promise<string | null> | string | null;
  /** Fetches a clip's bytes (default `fetch`). */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** Called when a clip starts, with its length, so the music can duck under it. */
  onStart?: (durationS: number, contentRef: string) => void;
}

export interface BarkVoiceState {
  /** The line speaking now, or null. */
  playing: string | null;
  /** Lines spoken this session, oldest first (the last 16). */
  played: string[];
  /** Lines whose subtitle showed with no clip to play (missing, failed or stale), the last 16. */
  silent: string[];
}

export interface BarkVoices {
  /** A subtitle showed: speak its line. Resolves true if the clip started. */
  say(contentRef: string): Promise<boolean>;
  /** This device's cuts (every veto reference; non-bark ones are ignored). */
  setCut(refs: readonly string[]): void;
  /** Stops the voice speaking now (a short fade). */
  stop(): void;
  state(): BarkVoiceState;
}

async function defaultClipUrl(contentRef: string): Promise<string | null> {
  const m = await import('./bark-clips');
  return m.bundledClipUrl(contentRef);
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

const remember = (list: string[], ref: string) => {
  list.push(ref);
  if (list.length > 16) list.shift();
};

export function createBarkVoices(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: BarkVoiceOptions = {},
): BarkVoices {
  const clipUrl = opts.clipUrl ?? defaultClipUrl;
  const fetchBytes = opts.fetchBytes ?? defaultFetch;
  const decoded = new Map<string, AudioBuffer>();
  const loading = new Map<string, Promise<AudioBuffer | null>>();
  const cut = new Set<string>();
  const played: string[] = [];
  const silent: string[] = [];
  let current: { ref: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Bumped by every `say`, so only the latest request may start. */
  let latest = 0;

  const load = (ref: string): Promise<AudioBuffer | null> => {
    const have = decoded.get(ref);
    if (have) {
      // Most recently used last.
      decoded.delete(ref);
      decoded.set(ref, have);
      return Promise.resolve(have);
    }
    let p = loading.get(ref);
    if (!p) {
      p = (async () => {
        try {
          const url = await clipUrl(ref);
          if (!url) return null;
          const buf = await ctx.decodeAudioData(await fetchBytes(url));
          decoded.set(ref, buf);
          while (decoded.size > KEEP_DECODED) {
            const oldest = decoded.keys().next().value;
            if (oldest === undefined) break;
            decoded.delete(oldest);
          }
          return buf;
        } catch {
          return null;
        } finally {
          loading.delete(ref);
        }
      })();
      loading.set(ref, p);
    }
    return p;
  };

  /** Silences the line speaking now (a short fade). */
  const fadeOut = () => {
    const c = current;
    if (!c) return;
    current = null;
    const t = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setValueAtTime(c.gain.gain.value, t);
    c.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    try {
      c.src.stop(t + FADE_S + 0.01);
    } catch {
      // Already stopped.
    }
  };

  return {
    async say(ref) {
      if (!barkClipPath(ref) || cut.has(ref)) return false;
      const ticket = ++latest;
      const askedAt = ctx.currentTime;
      const buf = await load(ref);
      // A newer bark, a cut, or a clip that came too late: stay silent.
      if (ticket !== latest || cut.has(ref) || !buf || ctx.currentTime - askedAt > STALE_S) {
        if (ticket === latest) remember(silent, ref);
        return false;
      }
      fadeOut();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(out);
      const mine = { ref, src, gain };
      current = mine;
      src.onended = () => {
        gain.disconnect();
        if (current === mine) current = null;
      };
      src.start(ctx.currentTime);
      remember(played, ref);
      opts.onStart?.(buf.duration, ref);
      return true;
    },
    setCut(refs) {
      cut.clear();
      for (const r of refs) if (barkClipPath(r)) cut.add(r);
      if (current && cut.has(current.ref)) fadeOut();
    },
    stop() {
      // A clip still loading must not start afterwards either.
      latest++;
      fadeOut();
    },
    state: () => ({ playing: current?.ref ?? null, played: played.slice(), silent: silent.slice() }),
  };
}
