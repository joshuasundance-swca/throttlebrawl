// Spoken barks (the maintainer, 2026-10-01: "Voices go in"; bark-voices.ts) on the fake context:
// a subtitle's line speaks on the voices bus and ducks the music a little; a cut line never speaks
// again; the Voices switch and level apply at once; one voice at a time. The real graph renders
// a real clip offline in tests/e2e/audio-voices.spec.ts.
import { describe, expect, it } from 'vitest';
import { BARK_SHOWN_EVENT, BARK_VOICE_EVENT, barkClipPath, STALE_S } from './bark-voices';
import { fakeContextFactory, type FakeAudioContext, type FakeNode } from './fake-context';
import { createAudio, DUCK_DEFAULTS, VOICE_DEFAULTS } from './index';

const KEVIN = 'base:bark-set/kevin-core#kevin-pass-email';
const DEACON = 'base:bark-set/deacon-core#deacon-hit-ditch';

/** An audio system whose clips are `size` bytes (one second per 1000), from a fake fetch. */
async function setup(opts: { size?: number; delayS?: number; events?: EventTarget } = {}) {
  const { ctx, create } = fakeContextFactory();
  const fetched: string[] = [];
  const audio = createAudio({
    createContext: create,
    radioKeys: null,
    barkEvents: opts.events ?? null,
    barkClipUrl: (ref) => (ref.includes('#missing') ? null : `clip:${ref}`),
    barkFetch: (url) => {
      fetched.push(url);
      // The audio clock moves while the clip loads (a slow phone network).
      ctx.currentTime += opts.delayS ?? 0;
      return Promise.resolve(new ArrayBuffer(opts.size ?? 1500));
    },
  });
  await audio.resume();
  return { ctx, audio, fetched };
}

/** The clip sources started on the context (buffer sources fed by a buffer with a duration). */
const clips = (ctx: FakeAudioContext): FakeNode[] =>
  ctx.nodes.filter((n) => n.kind === 'bufferSource' && (n.buffer as { duration?: number } | null)?.duration);

describe('bark clip paths', () => {
  it('follow the line content reference into its pack', () => {
    expect(barkClipPath(KEVIN)).toEqual({
      packId: 'base',
      path: 'assets/audio/barks/kevin-core/kevin-pass-email.ogg',
    });
    expect(barkClipPath('region-pnw:bark-set/juniper-core#juniper-hit-last-call')).toEqual({
      packId: 'region-pnw',
      path: 'assets/audio/barks/juniper-core/juniper-hit-last-call.ogg',
    });
  });
  it('are null for anything that is not a bark line', () => {
    expect(barkClipPath('base:station/keys-surf#causeway-twang')).toBeNull();
    expect(barkClipPath('base:region/florida-keys#sign-1')).toBeNull();
    expect(barkClipPath('kevin-pass-email')).toBeNull();
  });
});

describe('spoken barks', () => {
  it('speak the line on the voices bus and dip the music a little under it', async () => {
    const { ctx, audio } = await setup();
    expect(await audio.say(KEVIN)).toBe(true);
    const [src] = clips(ctx);
    expect(src?.startedAt).toBe(0);
    expect(audio.inspect().voice.playing).toBe(KEVIN);
    expect(audio.inspect().voice.played).toEqual([KEVIN]);
    // Under a voice the music dips to the voice duck, lighter than a crash's.
    expect(audio.inspect().duckLevel).toBe(VOICE_DEFAULTS.duck);
    expect(VOICE_DEFAULTS.duck).toBeGreaterThan(DUCK_DEFAULTS.level);
    // The engine and effects dip a touch too, so the line carries over a flat-out engine.
    expect(audio.inspect().voice.fxLevel).toBe(VOICE_DEFAULTS.fxDuck);
  });

  it('never speak a line cut on this device, and stop one cut while it speaks', async () => {
    const { ctx, audio, fetched } = await setup();
    audio.setRadioCut([DEACON]);
    expect(await audio.say(DEACON)).toBe(false);
    expect(fetched).toEqual([]);
    expect(await audio.say(KEVIN)).toBe(true);
    const [src] = clips(ctx);
    audio.setRadioCut([DEACON, KEVIN]);
    expect(src?.stoppedAt).not.toBeNull();
    expect(audio.inspect().voice.playing).toBeNull();
    expect(await audio.say(KEVIN)).toBe(false);
    expect(clips(ctx)).toHaveLength(1);
  });

  it('a cut made before the sound starts still holds once it does', async () => {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({
      createContext: create,
      radioKeys: null,
      barkEvents: null,
      barkClipUrl: (ref) => `clip:${ref}`,
      barkFetch: () => Promise.resolve(new ArrayBuffer(1000)),
    });
    audio.setRadioCut([KEVIN]);
    await audio.resume();
    expect(await audio.say(KEVIN)).toBe(false);
    expect(clips(ctx)).toHaveLength(0);
  });

  it('follow the Voices switch and slider (the voices bus) and mute', async () => {
    const { ctx, audio, fetched } = await setup();
    const on = { master: 0.8, music: 0.6, effects: 0.9, voices: 0.8 };
    // Voices off: the settings record hands audio a silent voices bus (save's audioVolumes).
    audio.setVolumes({ ...on, voices: 0 }, false);
    expect(await audio.say(KEVIN)).toBe(false);
    audio.setVolumes(on, true);
    expect(await audio.say(KEVIN)).toBe(false);
    expect(fetched).toEqual([]);
    expect(audio.inspect().voice.on).toBe(false);
    audio.setVolumes(on, false);
    expect(audio.inspect().voice.on).toBe(true);
    expect(audio.inspect().busTargets.voices).toBeCloseTo(0.64);
    expect(await audio.say(KEVIN)).toBe(true);
    // Switching Voices off mid-line silences it at once.
    audio.setVolumes({ ...on, voices: 0 }, false);
    expect(clips(ctx)[0]?.stoppedAt).not.toBeNull();
    expect(audio.inspect().voice.playing).toBeNull();
  });

  it('a clip still loading when the race is left never starts', async () => {
    const { ctx, create } = fakeContextFactory();
    let release: (b: ArrayBuffer) => void = () => {};
    const audio = createAudio({
      createContext: create,
      radioKeys: null,
      barkEvents: null,
      barkClipUrl: (ref) => `clip:${ref}`,
      barkFetch: () => new Promise<ArrayBuffer>((r) => (release = r)),
    });
    await audio.resume();
    const said = audio.say(KEVIN);
    // The fetch is under way (its URL resolved) when the race is left.
    await new Promise((r) => setTimeout(r, 0));
    audio.frame(null, 0);
    release(new ArrayBuffer(1000));
    expect(await said).toBe(false);
    expect(clips(ctx)).toHaveLength(0);
  });

  it('play clips at the bark voice slider level, under the voices bus', async () => {
    const { audio } = await setup();
    expect(audio.inspect().voice).toMatchObject({ on: true, level: VOICE_DEFAULTS.gain });
    audio.setParam('audio.voiceGain', 1.5);
    expect(audio.inspect().voice.level).toBeCloseTo(1.5);
    audio.setParam('audio.voiceGain', 0);
    expect(await audio.say(KEVIN)).toBe(false);
  });

  it('speak one voice at a time: a new bark fades out the one before', async () => {
    const { ctx, audio } = await setup();
    await audio.say(KEVIN);
    await audio.say(DEACON);
    const [first, second] = clips(ctx);
    expect(first?.stoppedAt).not.toBeNull();
    expect(second?.stoppedAt).toBeNull();
    expect(audio.inspect().voice.playing).toBe(DEACON);
  });

  it('stay silent when a clip is missing, or arrives after its moment passed', async () => {
    const slow = await setup({ delayS: STALE_S + 0.2 });
    expect(await slow.audio.say(KEVIN)).toBe(false);
    expect(slow.audio.inspect().voice.silent).toEqual([KEVIN]);
    const missing = await setup();
    expect(await missing.audio.say('base:bark-set/kevin-core#missing')).toBe(false);
    expect(await missing.audio.say('base:station/keys-surf#causeway-twang')).toBe(false);
    expect(missing.fetched).toEqual([]);
  });

  it('decode each clip once and keep it for the next time the line is said', async () => {
    const { ctx, audio, fetched } = await setup();
    await audio.say(KEVIN);
    await audio.say(KEVIN);
    expect(fetched).toHaveLength(1);
    expect(ctx.decoded).toHaveLength(1);
    expect(clips(ctx)).toHaveLength(2);
  });

  it('stay quiet while the sound is not running, and stop when the race is left', async () => {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({
      createContext: create,
      radioKeys: null,
      barkEvents: null,
      barkClipUrl: (ref) => `clip:${ref}`,
      barkFetch: () => Promise.resolve(new ArrayBuffer(1000)),
    });
    expect(await audio.say(KEVIN)).toBe(false);
    await audio.resume();
    expect(await audio.say(KEVIN)).toBe(true);
    audio.frame(null, 0);
    expect(clips(ctx)[0]?.stoppedAt).not.toBeNull();
  });

  it("speak when the subtitle's event arrives", async () => {
    const events = new EventTarget();
    const { audio } = await setup({ events });
    events.dispatchEvent(new CustomEvent(BARK_SHOWN_EVENT, { detail: { contentRef: KEVIN } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.inspect().voice.played).toEqual([KEVIN]);
    // Junk details are ignored.
    events.dispatchEvent(new CustomEvent(BARK_SHOWN_EVENT, { detail: { contentRef: 7 } }));
    events.dispatchEvent(new CustomEvent(BARK_SHOWN_EVENT));
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.inspect().voice.played).toEqual([KEVIN]);
  });

  it('tell the subtitle how long the voice speaks, so it stays up that long', async () => {
    const events = new EventTarget();
    type Detail = { contentRef: string; durationS: number };
    const heard: Detail[] = [];
    events.addEventListener(BARK_VOICE_EVENT, (e) => heard.push((e as CustomEvent<Detail>).detail));
    const { audio } = await setup({ events, size: 3200 });
    await audio.say(KEVIN);
    expect(heard).toEqual([{ contentRef: KEVIN, durationS: 3.2 }]);
  });

  it('listen for the event the bark bubble sends, and the bubble for the voice event', () => {
    const [bubble] = Object.values(
      import.meta.glob<string>('../ui/narrative/bubble.ts', {
        eager: true,
        query: '?raw',
        import: 'default',
      }),
    );
    expect(bubble).toContain(`'${BARK_SHOWN_EVENT}'`);
    expect(bubble).toContain(`'${BARK_VOICE_EVENT}'`);
  });

  it('a voice duck never lifts a crash duck still holding', async () => {
    const { audio } = await setup();
    audio.duck();
    expect(audio.inspect().duckLevel).toBe(0.4);
    await audio.say(KEVIN);
    expect(audio.inspect().duckLevel).toBe(0.4);
  });
});
