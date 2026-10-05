import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// Playtest 1 item 10 (speed cues, [decided]): the wind rises with speed, rendered offline in a real
// browser with the real WebAudio graph. The player's engine is turned down to nothing and the music
// bus is off, so what is left on the effects bus at a steady speed is the wind. Same harness as
// audio-mix.spec.ts: src/audio is transpiled as-is and served from a routed path.

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
  await page.route('**/__audio-wind/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>wind</title>' });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__audio-wind/harness.html');
  return problems;
}

/** The rms of 0.8 s of the effects bus with the player riding steadily at `speed` m/s. */
async function windRms(page: Page, speed: number): Promise<number> {
  return page.evaluate(async (speed) => {
    type Audio = {
      resume(): Promise<void>;
      setVolumes(v: Record<string, number>, mute: boolean): void;
      setParam(id: string, value: number): void;
      frame(s: Record<string, unknown> | null, playerId: number): void;
    };
    const url = '/__audio-wind/system.js';
    const m = (await import(url)) as {
      createAudio(o: { createContext: () => BaseAudioContext; offline: boolean }): Audio;
    };
    const rate = 44100;
    const ctx = new OfflineAudioContext(1, Math.round(0.8 * rate), rate);
    const audio = m.createAudio({ createContext: () => ctx, offline: true });
    audio.setVolumes({ master: 1, music: 0, effects: 1, voices: 1 }, false);
    audio.setParam('audio.engineGain', 0);
    audio.setParam('audio.hornRangeM', 0);
    await audio.resume();
    const me = {
      id: 0,
      kind: 'rider',
      mode: 'Road',
      road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed,
      lean: 0,
      contentId: 'player',
      slot: 0,
      throttle: 1,
      rpm: 7000,
      gear: 4,
      faction: 'rider',
      targetId: -1,
    };
    const snap = {
      tick: 1,
      timeScale: 1,
      entities: [me],
      race: { over: false, routeLength: 1, finishOrder: [] },
    };
    // Frames at 30 Hz through the render, as the app's loop would.
    audio.frame(snap, 0);
    const pending: Promise<void>[] = [];
    for (let i = 1; i < 23; i++) {
      pending.push(
        ctx.suspend(i / 30).then(() => {
          audio.frame(snap, 0);
          return ctx.resume();
        }),
      );
    }
    const buf = await ctx.startRendering();
    await Promise.all(pending);
    const data = buf.getChannelData(0);
    let sum = 0;
    const from = Math.round(0.3 * rate); // after the level has settled
    for (let i = from; i < data.length; i++) sum += data[i]! * data[i]!;
    return Math.sqrt(sum / (data.length - from));
  }, speed);
}

test('the wind rises with speed in the real graph', async ({ page }) => {
  const problems = await openHarness(page);
  const still = await windRms(page, 2);
  const cruising = await windRms(page, 25);
  const flatOut = await windRms(page, 44);
  console.log(
    `wind rms at 2, 25 and 44 m/s: ${still.toFixed(5)}, ${cruising.toFixed(5)}, ${flatOut.toFixed(5)}`,
  );
  expect(problems).toEqual([]);
  expect(still).toBeLessThan(0.0005);
  expect(cruising).toBeGreaterThan(0.002);
  expect(flatOut).toBeGreaterThan(cruising * 2);
});
