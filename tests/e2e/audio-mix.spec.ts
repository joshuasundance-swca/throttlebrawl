import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// audio-2 acceptance (docs/milestones/M2.md, "audio-2 · The mix"), rendered offline in a real
// browser with the real WebAudio graph:
// - an offline render of a scripted takedown shows the slow-motion filter on the effects bus;
// - the bus gains still follow the settings;
// - a pile-up does not clip (the phone check's "nothing clips in a pile-up", as a render).
// The whole src/audio module is transpiled as-is and served from a routed path; it has no runtime
// imports outside its folder (its sim imports are type-only).

const dir = new URL('../../src/audio/', import.meta.url);
const modules = new Map<string, string>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
  const js = ts.transpileModule(readFileSync(new URL(f, dir), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  modules.set(f.replace(/\.ts$/, '.js'), js.replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"));
}

async function openHarness(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.route('**/__audio-mix/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>mix</title>' });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__audio-mix/harness.html');
  return problems;
}

// Runs in the page: a scripted race moment rendered offline, returning the samples' stats.
// `script` names the scenario; everything else is shared.
type Scenario = 'takedown' | 'control' | 'pileup' | 'busEffectsOff' | 'busEffectsOn' | 'busMusicOnly';

async function render(page: Page, scenario: Scenario) {
  return page.evaluate(async (scenario) => {
    type Snap = Record<string, unknown>;
    type Audio = {
      resume(): Promise<void>;
      setVolumes(v: Record<string, number>, mute: boolean): void;
      setParam(id: string, v: number): void;
      frame(s: Snap | null, playerId: number): void;
      onEvents(e: unknown[], s?: Snap | null): void;
      inspect(): { slowmo: { active: boolean; lowpassHz: number } };
    };
    const url = '/__audio-mix/index.js';
    const m = (await import(url)) as {
      createAudio(o: { createContext: () => BaseAudioContext; offline: boolean }): Audio;
    };
    const rate = 44100;
    const dur = scenario === 'takedown' || scenario === 'control' ? 2.2 : scenario === 'pileup' ? 1.6 : 0.8;
    const ctx = new OfflineAudioContext(1, Math.round(dur * rate), rate);
    const audio = m.createAudio({ createContext: () => ctx, offline: true });
    const vols =
      scenario === 'pileup'
        ? { master: 1, music: 1, effects: 1, voices: 1 }
        : scenario === 'busEffectsOff'
          ? { master: 1, music: 0, effects: 0, voices: 1 }
          : scenario === 'busMusicOnly'
            ? { master: 1, music: 1, effects: 0, voices: 1 }
            : { master: 1, music: 0, effects: 1, voices: 1 };
    // As the app does: the settings apply before the start tap builds the graph.
    audio.setVolumes(vols, false);
    await audio.resume();
    // The score: it plays at once (a race starts on a station since playtest 2, and the stations
    // load on first use, which a 0.8 s render would miss).
    audio.setParam('audio.radio', 1);

    const rider = (id: number, over: Record<string, unknown> = {}) => ({
      id,
      kind: 'rider',
      mode: 'Road',
      road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 30,
      lean: 0,
      contentId: id === 0 ? 'player' : 'rival',
      name: 'x',
      faction: 'rider',
      slot: id === 0 ? 0 : -1,
      throttle: 1,
      rpm: 7500,
      gear: 4,
      grounded: true,
      health: 100,
      healthMax: 100,
      attackPhase: 'idle',
      heldWeapon: null,
      targetId: -1,
      lastAttackerId: -1,
      progress: 0,
      distanceToFinish: 1000,
      place: 1,
      finished: false,
      ...over,
    });
    const slowFrom = 0.8;
    const slowTo = 1.6;
    const slowing = (t: number) => scenario === 'takedown' && t >= slowFrom && t < slowTo;
    const snap = (t: number): Snap => ({
      tick: Math.round(t * 60),
      timeScale: slowing(t) ? 0.3 : 1,
      entities: [rider(0), rider(1, { z: -4, x: 1 }), rider(2, { z: -9, x: -1 })],
      race: { over: false, routeLength: 5000, finishOrder: [] },
      slowmo: { active: slowing(t), remainingTicks: slowing(t) ? Math.round((slowTo - t) * 60) : 0 },
    });
    const ev = (type: string, actor: number, target?: number, data: Record<string, unknown> = {}) => ({
      tick: 0,
      type,
      actor,
      ...(target === undefined ? {} : { target }),
      data,
    });

    const log: { t: number; slowmo: boolean; lowpassHz: number }[] = [];
    let firedSlow = false;
    let firedEnd = false;
    let firedPile = false;
    audio.frame(snap(0), 0);
    const step = 1 / 30;
    const pending: Promise<void>[] = [];
    for (let t = step; t < dur - 0.05; t += step) {
      const at = t;
      pending.push(
        ctx.suspend(at).then(() => {
          const s = snap(at);
          if (scenario === 'takedown' && !firedSlow && at >= slowFrom) {
            firedSlow = true;
            audio.onEvents(
              [
                ev('hit', 0, 1, { weapon: 'kick' }),
                ev('crash', 1, undefined, { reason: 'knockedOff' }),
                ev('takedown', 0, 1, { kind: 'traffic' }),
                ev('slowmoStart', 0, 1, { ticks: 48, timeScale: 0.3 }),
              ],
              s,
            );
          }
          if (scenario === 'takedown' && !firedEnd && at >= slowTo) {
            firedEnd = true;
            audio.onEvents([ev('slowmoEnd', 0, 1)], s);
          }
          if (scenario === 'pileup' && !firedPile && at >= 0.2) {
            firedPile = true;
            const pile: unknown[] = [];
            for (let i = 0; i < 12; i++) {
              pile.push(ev('crash', i % 3, undefined, { cause: 'barrier', speed: 40, impactMps: 14 }));
              pile.push(ev('hit', 0, 1 + (i % 2), { weapon: i % 2 ? 'kick' : 'base:lead-pipe' }));
            }
            pile.push(
              ev('takedown', 0, 1),
              ev('railOver', 1),
              ev('splash', 1),
              ev('crash', 0, 7, { cause: 'traffic', hazard: 'big' }),
            );
            audio.onEvents(pile, s);
          }
          audio.frame(s, 0);
          const i = audio.inspect();
          log.push({ t: at, slowmo: i.slowmo.active, lowpassHz: i.slowmo.lowpassHz });
          return ctx.resume();
        }),
      );
    }
    const buf = await ctx.startRendering();
    await Promise.all(pending);
    const x = buf.getChannelData(0);

    // Share of a window's energy above 2 kHz (radix-2 FFT of a Hann-windowed block).
    const n = 16384;
    const brightness = (from: number) => {
      const off = Math.round(from * rate);
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const v = x[off + i] ?? 0;
        sq += v * v;
        re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      }
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
          [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0; k < len / 2; k++) {
            const wr = Math.cos(ang * k);
            const wi = Math.sin(ang * k);
            const a = i + k;
            const b = a + len / 2;
            const tr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
            const ti = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
            re[b] = (re[a] ?? 0) - tr;
            im[b] = (im[a] ?? 0) - ti;
            re[a] = (re[a] ?? 0) + tr;
            im[a] = (im[a] ?? 0) + ti;
          }
        }
      }
      const bin = Math.ceil((2000 * n) / rate);
      let total = 0;
      let high = 0;
      for (let i = 1; i < n / 2; i++) {
        const p = (re[i] ?? 0) ** 2 + (im[i] ?? 0) ** 2;
        total += p;
        if (i >= bin) high += p;
      }
      return { rms: Math.sqrt(sq / n), above2k: total > 0 ? high / total : 0 };
    };
    let peak = 0;
    let sq = 0;
    for (const v of x) {
      peak = Math.max(peak, Math.abs(v));
      sq += v * v;
    }
    return {
      peak,
      rms: Math.sqrt(sq / x.length),
      // 0.37 s windows: before the takedown, and inside the slow motion once its whoosh has passed.
      before: dur >= 2 ? brightness(0.35) : null,
      during: dur >= 2 ? brightness(1.12) : null,
      slowmoSeen: log.filter((l) => l.slowmo).map((l) => l.lowpassHz),
      slowmoAfter: log.filter((l) => l.t > slowTo + 0.05).some((l) => l.slowmo),
    };
  }, scenario);
}

test('a scripted takedown renders with the slow-motion filter on the effects bus', async ({ page }) => {
  const problems = await openHarness(page);
  const td = await render(page, 'takedown');
  const control = await render(page, 'control');
  const pct = (v: number | undefined) => `${(100 * (v ?? 0)).toFixed(2)}%`;
  console.log(
    `takedown: energy above 2 kHz ${pct(td.before?.above2k)} before, ${pct(td.during?.above2k)} in slow motion (rms ${td.during?.rms.toFixed(4)}); control ${pct(control.before?.above2k)} -> ${pct(control.during?.above2k)}`,
  );
  expect(problems).toEqual([]);
  // The treatment switched on for the slow motion, at the low-pass setting, and off afterwards.
  expect(td.slowmoSeen.length).toBeGreaterThan(10);
  expect(new Set(td.slowmoSeen)).toEqual(new Set([900]));
  expect(td.slowmoAfter).toBe(false);
  expect(control.slowmoSeen).toEqual([]);
  // The render itself: the effects are still heard, but the top end is gone during slow motion.
  expect(td.during!.rms).toBeGreaterThan(0.005);
  expect(td.before!.above2k).toBeGreaterThan(0.005);
  expect(td.during!.above2k).toBeLessThan(td.before!.above2k * 0.25);
  // Without the takedown the same engine keeps its brightness, so the darkening is the filter.
  expect(control.during!.above2k).toBeGreaterThan(control.before!.above2k * 0.6);
});

test('the rendered bus gains follow the settings', async ({ page }) => {
  const problems = await openHarness(page);
  const off = await render(page, 'busEffectsOff');
  const on = await render(page, 'busEffectsOn');
  const musicOnly = await render(page, 'busMusicOnly');
  console.log(
    `effects off rms ${off.rms.toFixed(5)}, effects on ${on.rms.toFixed(5)}, music only ${musicOnly.rms.toFixed(5)}`,
  );
  expect(problems).toEqual([]);
  expect(off.rms).toBeLessThan(0.0005);
  expect(on.rms).toBeGreaterThan(0.01);
  expect(musicOnly.rms).toBeGreaterThan(0.005);
});

test('a pile-up at full volume does not clip', async ({ page }) => {
  const problems = await openHarness(page);
  const pile = await render(page, 'pileup');
  console.log(`pile-up peak ${pile.peak.toFixed(4)}, rms ${pile.rms.toFixed(4)}`);
  expect(problems).toEqual([]);
  expect(pile.rms).toBeGreaterThan(0.01);
  expect(pile.peak).toBeLessThanOrEqual(1);
});

// Playtest 2 (2026-10-02): "Engine monotonous and maybe too loud", then ENGINE: "Richer and
// quieter". At the settings record's default volumes, the engine flat out now sits a few dB over a
// station's music instead of about 15 dB over it, and a ride with shifts, throttle snaps and decel
// pops at full volume does not clip. Each case renders 5 s offline through the real graph.
test('the engine sits a few dB over the music at the default volumes, and a busy ride does not clip', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stationsDir = new URL('../../packs/base/stations/', import.meta.url);
  const table: Record<string, unknown> = {};
  for (const f of readdirSync(stationsDir).sort())
    if (f.endsWith('.json'))
      table[`base:${f.replace(/\.json$/, '')}`] = JSON.parse(readFileSync(new URL(f, stationsDir), 'utf8'));
  const problems = await openHarness(page);
  type Case = {
    radio: number;
    music: number;
    effects: number;
    master: number;
    engineGain: number;
    ride: boolean;
  };
  const level = (c: Case) =>
    page.evaluate(
      async ({ c, table }) => {
        type Audio = {
          resume(): Promise<void>;
          setVolumes(v: Record<string, number>, mute: boolean): void;
          setParam(id: string, v: number): void;
          frame(s: Record<string, unknown> | null, playerId: number): void;
          inspect(): { engineFeel: { shifts: number; revs: number; pops: number } };
        };
        const url = '/__audio-mix/index.js';
        const m = (await import(url)) as {
          createAudio(o: Record<string, unknown>): Audio;
          stationsFromTable(t: Record<string, unknown>): unknown[];
        };
        // The radio's band is a lazy chunk in the game (radio-band.ts); handed in here, as the stations
        // are, so the render hears the station from its first note.
        const bandUrl = '/__audio-mix/radio-band.js';
        const band = (await import(bandUrl)) as { RADIO_BAND: unknown };
        const rate = 44100;
        const dur = 5;
        const ctx = new OfflineAudioContext(1, dur * rate, rate);
        const audio = m.createAudio({
          createContext: () => ctx,
          offline: true,
          radioKeys: null,
          barkEvents: null,
          radioSeed: 7,
          radioBand: band.RADIO_BAND,
          stations: m.stationsFromTable(table),
        });
        audio.setVolumes({ master: c.master, music: c.music, effects: c.effects, voices: 0.9 }, false);
        await audio.resume();
        audio.setParam('audio.radio', c.radio);
        audio.setParam('audio.engineGain', c.engineGain);
        // The level cases hear the engine alone; the ride keeps the wind.
        if (!c.ride) audio.setParam('audio.windGain', 0);
        // Flat out in top gear, or a ride: shifts up through the gears, snaps the throttle, shuts it.
        const me = (t: number) => {
          if (!c.ride) return { rpm: 9000, gear: 4, throttle: 1 };
          const phase = t % 2.5;
          const gear = 1 + Math.min(3, Math.floor(phase / 0.5));
          const rpm = 1200 + 8800 * ((phase % 0.5) / 0.5);
          return { rpm, gear, throttle: phase > 2.1 ? 0 : 1 };
        };
        const drive = (t: number) =>
          audio.frame(
            {
              tick: Math.round(t * 60),
              timeScale: 1,
              entities: [
                {
                  id: 0,
                  kind: 'rider',
                  mode: 'Riding',
                  x: 0,
                  y: 0,
                  z: -t * 40,
                  heading: 0,
                  speed: 40,
                  contentId: 'player',
                  ...me(t),
                },
              ],
            },
            0,
          );
        drive(0);
        const pending: Promise<void>[] = [];
        for (let t = 1 / 60; t < dur - 0.05; t += 1 / 60) {
          const at = t;
          pending.push(
            ctx.suspend(at).then(() => {
              drive(at);
              return ctx.resume();
            }),
          );
        }
        const buf = await ctx.startRendering();
        await Promise.all(pending);
        const x = buf.getChannelData(0);
        let peak = 0;
        let sq = 0;
        const i0 = Math.round(0.5 * rate);
        for (let i = i0; i < x.length; i++) {
          const v = x[i] ?? 0;
          peak = Math.max(peak, Math.abs(v));
          sq += v * v;
        }
        return { db: 10 * Math.log10(sq / (x.length - i0)), peak, feel: audio.inspect().engineFeel };
      },
      { c, table },
    );
  const defaults = { master: 0.8, music: 0.6, effects: 0.9, engineGain: 1, ride: false };
  const engine = await level({ ...defaults, radio: 0 });
  const before = await level({ ...defaults, radio: 0, engineGain: 0.5 / 0.15 });
  const music = await level({ ...defaults, radio: 2, effects: 0 });
  const ride = await level({ master: 1, music: 1, effects: 1, engineGain: 1, radio: 2, ride: true });
  console.log(
    `engine flat out ${engine.db.toFixed(1)} dBFS (at the level before playtest 2: ${before.db.toFixed(1)}), ` +
      `station music ${music.db.toFixed(1)} dBFS: the engine sits ${(engine.db - music.db).toFixed(1)} dB over ` +
      `the music (was ${(before.db - music.db).toFixed(1)}); a full-volume ride peaks at ${ride.peak.toFixed(3)} ` +
      `with ${ride.feel.shifts} shifts, ${ride.feel.revs} revs, ${ride.feel.pops} pops`,
  );
  expect(problems).toEqual([]);
  expect(before.db - engine.db).toBeGreaterThan(9);
  expect(engine.db - music.db).toBeGreaterThan(1);
  expect(engine.db - music.db).toBeLessThan(8);
  expect(ride.feel.shifts).toBeGreaterThanOrEqual(4);
  expect(ride.feel.pops).toBeGreaterThan(0);
  expect(ride.peak).toBeLessThan(1);
});
