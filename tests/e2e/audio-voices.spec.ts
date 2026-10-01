import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// Spoken barks (the maintainer, 2026-10-01: "Voices go in"), in a real browser:
// - offline, through the real WebAudio graph and a real clip from the pack: a said line is heard on
//   the voices bus above a flat-out engine at the default settings, without clipping; a line cut
//   with "cut this", or with Voices off, is silent;
// - in the real build: no clip loads before the race (they are never in the first load), and the
//   first bark's clip is fetched while its subtitle is up.
// As in audio-radio.spec.ts, src/audio is transpiled as-is and served from a routed path.

const dir = new URL('../../src/audio/', import.meta.url);
const modules = new Map<string, string>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
  const js = ts.transpileModule(readFileSync(new URL(f, dir), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  modules.set(f.replace(/\.ts$/, '.js'), js.replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"));
}
const REF = 'base:bark-set/kevin-core#kevin-pass-email';
const clip = readFileSync(
  new URL('../../packs/base/assets/audio/barks/kevin-core/kevin-pass-email.ogg', import.meta.url),
);

async function openHarness(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.route('**/__audio-voices/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>voices</title>' });
    if (name === 'clip.ogg') return route.fulfill({ contentType: 'audio/ogg', body: clip });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__audio-voices/harness.html');
  return problems;
}

interface Args {
  ref: string;
  say: boolean;
  engine: boolean;
  voices: number;
  cut: boolean;
}

/** Renders 3 s offline: the engine flat out (or not), and the line said at 0.2 s (or not). */
async function render(page: Page, args: Args) {
  return page.evaluate(async (a) => {
    type Audio = {
      resume(): Promise<void>;
      setVolumes(v: Record<string, number>, mute: boolean): void;
      setRadioCut(refs: string[]): void;
      update(p: { rpm: number; throttle: number; speed: number } | null): void;
      say(ref: string): Promise<boolean>;
      inspect(): { voice: { playing: string | null; fxLevel: number }; duckLevel: number };
    };
    const url = '/__audio-voices/index.js';
    const m = (await import(url)) as {
      createAudio(o: Record<string, unknown>): Audio;
    };
    const rate = 44100;
    const dur = 3;
    const ctx = new OfflineAudioContext(1, dur * rate, rate);
    const audio = m.createAudio({
      createContext: () => ctx,
      offline: true,
      radioKeys: null,
      barkEvents: null,
      barkClipUrl: () => '/__audio-voices/clip.ogg',
    });
    // The settings record's defaults, with the music off so only the engine and the voice are heard.
    audio.setVolumes({ master: 0.8, music: 0, effects: 0.9, voices: a.voices }, false);
    if (a.cut) audio.setRadioCut([a.ref]);
    await audio.resume();
    const drive = () => (a.engine ? audio.update({ rpm: 9000, throttle: 1, speed: 45 }) : undefined);
    drive();
    let said = false;
    let playing: string | null = null;
    let fx = 1;
    const pending: Promise<void>[] = [];
    for (let t = 0.1; t < dur - 0.05; t += 0.1) {
      const at = t;
      pending.push(
        ctx.suspend(at).then(async () => {
          drive();
          if (a.say && at > 0.15 && at < 0.25) {
            said = await audio.say(a.ref);
            playing = audio.inspect().voice.playing;
            fx = audio.inspect().voice.fxLevel;
          }
          return ctx.resume();
        }),
      );
    }
    const buf = await ctx.startRendering();
    await Promise.all(pending);
    const x = buf.getChannelData(0);
    let peak = 0;
    let sq = 0;
    const i0 = Math.round(0.3 * rate);
    const i1 = Math.round(1.8 * rate);
    for (let i = i0; i < i1; i++) {
      const v = x[i] ?? 0;
      peak = Math.max(peak, Math.abs(v));
      sq += v * v;
    }
    return { said, playing, fx, rms: Math.sqrt(sq / (i1 - i0)), peak };
  }, args);
}

const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

test('voices: a said line is heard above a flat-out engine, unclipped; cut or Voices off is silent', async ({
  page,
}) => {
  const problems = await openHarness(page);
  const base = { ref: REF, say: true, engine: true, voices: 0.8, cut: false };
  const engineOnly = await render(page, { ...base, say: false });
  const both = await render(page, base);
  const voiceOnly = await render(page, { ...base, engine: false });
  const cut = await render(page, { ...base, engine: false, cut: true });
  const off = await render(page, { ...base, engine: false, voices: 0 });
  expect(problems).toEqual([]);
  expect(both.said).toBe(true);
  expect(both.playing).toBe(REF);
  // The voice's own level over the engine's, over the 1.5 s the line speaks.
  // The line's level over the engine's while it speaks: the engine dips to the voice's effects level.
  const snr = db(voiceOnly.rms) - db(engineOnly.rms * both.fx);
  console.log(
    `voices render: engine rms ${engineOnly.rms.toFixed(4)} (${db(engineOnly.rms).toFixed(1)} dBFS), ` +
      `voice alone rms ${voiceOnly.rms.toFixed(4)} peak ${voiceOnly.peak.toFixed(3)}, ` +
      `with the engine rms ${both.rms.toFixed(4)} peak ${both.peak.toFixed(3)}; voice over engine ${snr.toFixed(1)} dB`,
  );
  expect(voiceOnly.rms).toBeGreaterThan(0.02);
  expect(snr).toBeGreaterThan(3);
  expect(both.peak).toBeLessThan(1);
  expect(cut.said).toBe(false);
  expect(cut.rms).toBeLessThan(1e-4);
  expect(off.said).toBe(false);
  expect(off.rms).toBeLessThan(1e-4);
});

type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: { setBot(on: boolean): void } };

test('voices in the build: no clip in the first load; the first bark fetches its clip while it shows', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const clips: { url: string; at: number }[] = [];
  page.on('request', (req) => {
    if (/\.ogg(\?|$)/.test(req.url())) clips.push({ url: req.url(), at: Date.now() });
  });
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  expect(clips, 'no clip loads before a race').toEqual([]);
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  const bubble = page.locator('#bark-bubble');
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  const ref = (await bubble.getAttribute('data-content-ref')) ?? '';
  const line = ref.slice(ref.indexOf('#') + 1);
  expect(line.length).toBeGreaterThan(0);
  await expect.poll(() => clips.some((c) => c.url.includes(`/${line}-`)), { timeout: 5_000 }).toBe(true);
  console.log(`first bark ${ref}; clips fetched: ${clips.map((c) => c.url.split('/').pop()).join(', ')}`);
  expect(problems).toEqual([]);
});
