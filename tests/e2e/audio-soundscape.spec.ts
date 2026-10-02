import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// Run W-Q audio: the regional soundscape, rendered offline in a real browser with the real WebAudio
// graph (the same harness as audio-wind.spec.ts). The player's engine, the wind, the horns and the
// music are off, so what reaches the effects bus is the region's own sound:
// - the Keys: bridge-joint thumps whose rate follows the speed (counted in the rendered signal);
// - the Pacific Northwest: rain on the helmet, broadband and louder at speed;
// - San Francisco: the two-tone foghorn (low tones heard) and a cable car's bell (a bright clang
//   heard only when the car stands on a cable-line stretch).

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
  await page.route('**/__audio-scape/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>scape</title>' });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__audio-scape/harness.html');
  return problems;
}

interface Ride {
  region: string;
  /** Scenery tags over the whole road (edge 0) and, when given, over edge 1 (the cable car's). */
  tags: string[];
  carTags?: string[];
  speed: number;
  seconds: number;
  /** Add a cable car 40 m away on edge 1. */
  car?: boolean;
}

interface Heard {
  rms: number;
  /** Thump clusters per second in the low band. */
  thumpsPerS: number;
  /** Energy near 98 Hz and 73 Hz (the foghorn) and in the 1.1-1.3 kHz bell band, rms. */
  low: number;
  bell: number;
  /** Raw played-event kinds the mixer reports. */
  played: string[];
}

async function render(page: Page, ride: Ride): Promise<Heard> {
  return page.evaluate(async (ride) => {
    type Audio = {
      resume(): Promise<void>;
      setVolumes(v: Record<string, number>, mute: boolean): void;
      setParam(id: string, value: number): void;
      setRegion(id: string | null): void;
      setRoad(r: unknown): void;
      frame(s: Record<string, unknown> | null, playerId: number): void;
      inspect(): { soundscape: { played: { kind: string }[] } };
    };
    const url = '/__audio-scape/index.js';
    const m = (await import(url)) as {
      createAudio(o: Record<string, unknown>): Audio;
    };
    const rate = 44100;
    const ctx = new OfflineAudioContext(1, Math.round(ride.seconds * rate), rate);
    const audio = m.createAudio({
      createContext: () => ctx,
      offline: true,
      radioKeys: null,
      barkEvents: null,
      radioSeed: 11,
    });
    audio.setVolumes({ master: 1, music: 0, effects: 1, voices: 1 }, false);
    audio.setParam('audio.engineGain', 0);
    audio.setParam('audio.windGain', 0);
    audio.setParam('audio.hornRangeM', 0);
    audio.setRegion(ride.region);
    audio.setRoad({
      edges: [
        {
          tags: [
            { s0: 0, s1: 1e6, tag: ride.tags[0] ?? 'none' },
            ...ride.tags.slice(1).map((tag) => ({ s0: 0, s1: 1e6, tag })),
          ],
        },
        { tags: (ride.carTags ?? []).map((tag) => ({ s0: 0, s1: 1e6, tag })) },
      ],
    });
    await audio.resume();
    const entity = (id: number, over: Record<string, unknown>) => ({
      id,
      kind: 'rider',
      mode: 'Road',
      road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: ride.speed,
      lean: 0,
      contentId: 'player',
      slot: 0,
      throttle: 1,
      rpm: 7000,
      gear: 4,
      faction: 'rider',
      targetId: -1,
      health: 100,
      healthMax: 100,
      ...over,
    });
    const at = (s: number) => {
      const entities = [entity(0, { road: { edge: 0, s, d: 0, h: 0, dir: 1, yaw: 0 } })];
      if (ride.car) {
        entities.push(
          entity(7, {
            kind: 'vehicle',
            slot: -1,
            contentId: 'region-sf:cable-car',
            road: { edge: 1, s: 40, d: 0, h: 0, dir: 1, yaw: 0 },
            z: -40,
            speed: 6,
          }),
        );
      }
      return { tick: 1, timeScale: 1, entities, race: { over: false, routeLength: 1, finishOrder: [] } };
    };
    // Frames at 30 Hz through the render, as the app's loop would.
    audio.frame(at(10), 0);
    const pending: Promise<void>[] = [];
    const frames = Math.floor(ride.seconds * 30) - 1;
    for (let i = 1; i < frames; i++) {
      pending.push(
        ctx.suspend(i / 30).then(() => {
          audio.frame(at(10 + (ride.speed * i) / 30), 0);
          return ctx.resume();
        }),
      );
    }
    const buf = await ctx.startRendering();
    await Promise.all(pending);
    const x = buf.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i]! * x[i]!;
    // Low band envelope: a one-pole low-pass at about 180 Hz of the rectified signal, then the
    // clusters of thumps above a threshold, a cluster being any run closer than 0.2 s.
    const a = 1 - Math.exp((-2 * Math.PI * 180) / rate);
    let lp = 0;
    let env = 0;
    const env2: number[] = [];
    for (let i = 0; i < x.length; i++) {
      lp += a * (x[i]! - lp);
      env += a * (Math.abs(lp) - env);
      env2.push(env);
    }
    let peak = 0;
    for (const v of env2) if (v > peak) peak = v;
    const thr = peak * 0.35;
    let clusters = 0;
    let last = -1;
    let above = false;
    for (let i = 0; i < env2.length; i++) {
      const hi = env2[i]! > thr;
      if (hi && !above && (last < 0 || (i - last) / rate > 0.2)) clusters++;
      if (hi) last = i;
      above = hi;
    }
    // Goertzel energy at a frequency.
    const goertzel = (f: number) => {
      const w = (2 * Math.PI * f) / rate;
      const c = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < x.length; i++) {
        const s0 = x[i]! + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
    };
    return {
      rms: Math.sqrt(sum / x.length),
      thumpsPerS: clusters / ride.seconds,
      low: Math.max(goertzel(98), goertzel(73.4)),
      bell: Math.max(goertzel(1180), goertzel(2830)),
      played: audio.inspect().soundscape.played.map((e) => e.kind),
    };
  }, ride);
}

test('the Keys: bridge joints thump at a rate that follows your speed', async ({ page }) => {
  const problems = await openHarness(page);
  const slow = await render(page, { region: 'base:florida-keys', tags: ['bridge'], speed: 15, seconds: 8 });
  const fast = await render(page, { region: 'base:florida-keys', tags: ['bridge'], speed: 30, seconds: 8 });
  console.log(
    `thump clusters per second at 15 and 30 m/s: ${slow.thumpsPerS}, ${fast.thumpsPerS}; rms ${slow.rms.toFixed(4)}, ${fast.rms.toFixed(4)}`,
  );
  expect(problems).toEqual([]);
  // 15 m/s over 12.2 m is 1.2 joints a second; 30 m/s is 2.5.
  expect(slow.thumpsPerS).toBeGreaterThan(0.9);
  expect(slow.thumpsPerS).toBeLessThan(1.6);
  expect(fast.thumpsPerS).toBeGreaterThan(slow.thumpsPerS * 1.6);
  expect(fast.rms).toBeGreaterThan(slow.rms * 0.8);
  // Off a bridge the same ride is quiet.
  const dry = await render(page, { region: 'base:florida-keys', tags: ['town'], speed: 30, seconds: 4 });
  expect(dry.rms).toBeLessThan(0.0005);
});

test('the Pacific Northwest: rain on the helmet, harder at speed', async ({ page }) => {
  const problems = await openHarness(page);
  const parked = await render(page, {
    region: 'region-pnw:pacific-northwest',
    tags: ['town'],
    speed: 0,
    seconds: 3,
  });
  const riding = await render(page, {
    region: 'region-pnw:pacific-northwest',
    tags: ['town'],
    speed: 35,
    seconds: 3,
  });
  console.log(`rain rms parked and at 35 m/s: ${parked.rms.toFixed(5)}, ${riding.rms.toFixed(5)}`);
  expect(problems).toEqual([]);
  expect(parked.rms).toBeGreaterThan(0.0015);
  expect(riding.rms).toBeGreaterThan(parked.rms * 1.2);
  // The same ride in the Keys, off a bridge, has no rain at all.
  const keys = await render(page, { region: 'base:florida-keys', tags: ['town'], speed: 35, seconds: 3 });
  expect(keys.rms).toBeLessThan(0.0005);
});

test('San Francisco: the foghorn sounds, and the bell only on a cable line', async ({ page }) => {
  const problems = await openHarness(page);
  const fog = await render(page, {
    region: 'region-sf:san-francisco',
    tags: ['fog'],
    speed: 20,
    seconds: 20,
  });
  console.log(`foghorn low-band energy ${fog.low.toFixed(5)}; played ${fog.played.join(',')}`);
  expect(problems).toEqual([]);
  expect(fog.played).toContain('foghorn');
  expect(fog.low).toBeGreaterThan(0.002);
  const onLine = await render(page, {
    region: 'region-sf:san-francisco',
    tags: ['row-houses'],
    carTags: ['cable-line'],
    car: true,
    speed: 10,
    seconds: 3,
  });
  const strayed = await render(page, {
    region: 'region-sf:san-francisco',
    tags: ['row-houses'],
    carTags: ['forest'],
    car: true,
    speed: 10,
    seconds: 3,
  });
  console.log(
    `bell-band energy on a cable line ${onLine.bell.toFixed(5)}, off one ${strayed.bell.toFixed(5)}`,
  );
  expect(onLine.played).toContain('bell');
  expect(strayed.played).not.toContain('bell');
  expect(onLine.bell).toBeGreaterThan(0.0003);
  expect(strayed.bell).toBeLessThan(onLine.bell * 0.2);
});
