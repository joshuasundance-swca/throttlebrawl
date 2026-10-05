// The sound engine is a lazy chunk (audio/index.ts; the first-load budget): createAudio hands back a
// stand-in at once and the engine (system.ts) takes over once its chunk is in. These cases hold the
// stand-in's rules: the start tap still starts the sound inside the tap, nothing set before the
// engine loads is lost, and what inspect() reports before then agrees with the engine.
import { describe, expect, it, vi } from 'vitest';
import { createAudio } from './index';
import { FakeAudioContext } from './fake-context';
import { busTargets, type Volumes } from './tuning';

type Engine = typeof import('./system');

/** A chunk fetch the test resolves (or fails) when it chooses. */
function deferredLoad() {
  let resolve: (m: Engine) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  let calls = 0;
  const load = () => {
    calls++;
    return new Promise<Engine>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    load,
    calls: () => calls,
    resolve: async () => resolve(await import('./system')),
    reject: (e: unknown) => reject(e),
  };
}

function contexts() {
  const made: FakeAudioContext[] = [];
  const create = () => {
    const ctx = new FakeAudioContext();
    made.push(ctx);
    return ctx as unknown as AudioContext;
  };
  return { made, create };
}

const quiet = { radioKeys: null, barkEvents: null, radioSeed: 1 } as const;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the audio stand-in (audio/index.ts)', () => {
  it('starts the context inside the start tap, before the engine is in, and the engine plays on it', async () => {
    const chunk = deferredLoad();
    const ctxs = contexts();
    const audio = createAudio({ ...quiet, createContext: ctxs.create }, chunk.load);
    expect(chunk.calls()).toBe(1); // fetched as soon as the game makes it, not at the tap
    const resumed = audio.resume();
    // Synchronously, in the tap's user activation: one context, resumed.
    expect(ctxs.made.length).toBe(1);
    expect(ctxs.made[0]?.state).toBe('running');
    expect(audio.state()).toBe('running');
    await chunk.resolve();
    await resumed;
    // The engine built its graph on the tap's context: no second context.
    expect(ctxs.made.length).toBe(1);
    expect(ctxs.made[0]?.nodes.length).toBeGreaterThan(0);
    expect(audio.inspect().state).toBe('running');
  });

  it('hands the engine every setting made before it loaded, in the order they were made', async () => {
    const chunk = deferredLoad();
    const ctxs = contexts();
    const audio = createAudio({ ...quiet, createContext: ctxs.create }, chunk.load);
    const first: Volumes = { master: 1, music: 1, effects: 1, voices: 1 };
    const last: Volumes = { master: 0.5, music: 0.3, effects: 0.7, voices: 0.2 };
    audio.setVolumes(first, true);
    audio.setParam('audio.radio', 1);
    audio.setVolumes(last, false);
    audio.setParam('audio.radio', 0);
    audio.setParam('audio.voiceGain', 0.5);
    await chunk.resolve();
    await flush();
    const engine = audio.inspect();
    // The last of each wins, as it would have on an engine that was there all along.
    expect(engine.busTargets).toEqual(busTargets(last, false));
    expect(engine.radio.choice).toBe(0);
    expect(engine.radio.tunedTo).toBe('off');
    expect(engine.voice.level).toBe(0.5);
  });

  it('reports, before the engine loads, the bus targets and whether a voice could speak, as the engine does', async () => {
    const cases: { v: Volumes; mute: boolean; voiceGain: number }[] = [
      { v: { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 }, mute: false, voiceGain: 2 },
      { v: { master: 0.8, music: 0.6, effects: 0.9, voices: 0 }, mute: false, voiceGain: 2 },
      { v: { master: 1, music: 1, effects: 1, voices: 1 }, mute: true, voiceGain: 2 },
      { v: { master: 0.4, music: 0.2, effects: 0.5, voices: 0.6 }, mute: false, voiceGain: 0 },
    ];
    for (const c of cases) {
      const chunk = deferredLoad();
      const audio = createAudio({ ...quiet, createContext: contexts().create }, chunk.load);
      audio.setVolumes(c.v, c.mute);
      audio.setParam('audio.voiceGain', c.voiceGain);
      const before = audio.inspect();
      expect(before.radio.tunedTo).toBe('pending'); // the stations are still loading
      expect(before.lastCues).toEqual([]);
      await chunk.resolve();
      await flush();
      const after = audio.inspect();
      expect(before.busTargets).toEqual(after.busTargets);
      expect(before.voice.on).toBe(after.voice.on);
      expect(before.voice.level).toBe(after.voice.level);
      expect(before.radio.choice).toBe(after.radio.choice);
    }
  });

  it('plays nothing for frames and events before the engine loads, and keeps them out of it', async () => {
    const chunk = deferredLoad();
    const audio = createAudio({ ...quiet, createContext: contexts().create }, chunk.load);
    audio.frame(null, 0);
    audio.update(null);
    audio.onEvents([{ type: 'hit', tick: 1, actor: 1, target: 2, data: {} }], null);
    expect(audio.cutPlayingTrack('seed-1', 0)).toBeNull();
    await expect(audio.say('base:bark-set/x#y')).resolves.toBe(false);
    await chunk.resolve();
    await audio.resume();
    expect(audio.inspect().lastCues).toEqual([]);
  });

  it('stays silent when the engine fails to load, and fetches it again at the next start tap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chunk = deferredLoad();
    const ctxs = contexts();
    const audio = createAudio({ ...quiet, createContext: ctxs.create }, chunk.load);
    const tap = audio.resume();
    chunk.reject(new Error('offline'));
    await tap;
    expect(warn).toHaveBeenCalled();
    expect(audio.inspect().radio.tunedTo).toBe('pending');
    const again = audio.resume();
    expect(chunk.calls()).toBe(2);
    await chunk.resolve();
    await again;
    expect(ctxs.made.length).toBe(1);
    expect(audio.inspect().state).toBe('running');
    warn.mockRestore();
  });
});
