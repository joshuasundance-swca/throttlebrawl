import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// radio-1 acceptance (docs/milestones/M4.md, "radio-1"), rendered offline in a real browser with
// the real WebAudio graph (plucked-string buffers, the spring convolver, the slapback delay):
// - switching stations changes the playing track;
// - the music bus still follows its slider (radio at music 0 is silent, at music 1 it plays);
// - each station plays (not silent) without clipping.
// As in audio-mix.spec.ts, src/audio is transpiled as-is and served from a routed path; the
// stations are handed in as data read from packs/base/stations, so the page never loads content/.

const dir = new URL('../../src/audio/', import.meta.url);
const modules = new Map<string, string>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
  const js = ts.transpileModule(readFileSync(new URL(f, dir), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  modules.set(f.replace(/\.ts$/, '.js'), js.replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"));
}
const stationsDir = new URL('../../packs/base/stations/', import.meta.url);
const table: Record<string, unknown> = {};
for (const f of readdirSync(stationsDir).sort()) {
  if (f.endsWith('.json'))
    table[`base:${f.replace(/\.json$/, '')}`] = JSON.parse(readFileSync(new URL(f, stationsDir), 'utf8'));
}

async function openHarness(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.route('**/__audio-radio/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>radio</title>' });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__audio-radio/harness.html');
  return problems;
}

interface Args {
  choice: number;
  /** Switch to this choice halfway through. */
  switchTo: number | null;
  music: number;
  dur: number;
  table: Record<string, unknown>;
}

async function render(page: Page, args: Args) {
  return page.evaluate(async (a) => {
    type Audio = {
      resume(): Promise<void>;
      setVolumes(v: Record<string, number>, mute: boolean): void;
      setParam(id: string, v: number): void;
      update(p: { rpm: number; throttle: number; speed: number } | null): void;
      inspect(): { radio: { tunedTo: string; nowPlaying: { ref: string } | null } };
    };
    const url = '/__audio-radio/index.js';
    const m = (await import(url)) as {
      createAudio(o: Record<string, unknown>): Audio;
      stationsFromTable(t: Record<string, unknown>): unknown[];
    };
    const rate = 44100;
    const ctx = new OfflineAudioContext(1, Math.round(a.dur * rate), rate);
    const audio = m.createAudio({
      createContext: () => ctx,
      offline: true,
      radioKeys: null,
      radioSeed: 7,
      stations: m.stationsFromTable(a.table),
    });
    audio.setVolumes({ master: 1, music: a.music, effects: 0, voices: 0 }, false);
    await audio.resume();
    audio.setParam('audio.radio', a.choice);
    // The engine is on the effects bus (0 here), so only the music is heard.
    const drive = () => audio.update({ rpm: 4000, throttle: 1, speed: 30 });
    drive();
    const playing: { t: number; ref: string | null }[] = [];
    const pending: Promise<void>[] = [];
    const step = 1 / 30;
    const half = a.dur / 2;
    let switched = false;
    for (let t = step; t < a.dur - 0.05; t += step) {
      const at = t;
      pending.push(
        ctx.suspend(at).then(() => {
          if (a.switchTo !== null && !switched && at >= half) {
            switched = true;
            audio.setParam('audio.radio', a.switchTo);
          }
          drive();
          playing.push({ t: at, ref: audio.inspect().radio.nowPlaying?.ref ?? null });
          return ctx.resume();
        }),
      );
    }
    const buf = await ctx.startRendering();
    await Promise.all(pending);
    const x = buf.getChannelData(0);
    const stats = (from: number, to: number) => {
      let peak = 0;
      let sq = 0;
      const i0 = Math.round(from * rate);
      const i1 = Math.min(x.length, Math.round(to * rate));
      for (let i = i0; i < i1; i++) {
        const v = x[i] ?? 0;
        peak = Math.max(peak, Math.abs(v));
        sq += v * v;
      }
      return { peak, rms: Math.sqrt(sq / Math.max(1, i1 - i0)) };
    };
    return {
      first: stats(0.3, half),
      second: stats(half + 0.3, a.dur),
      refBefore: playing.find((p) => p.t > half - 0.2)?.ref ?? null,
      refAfter: playing.at(-1)?.ref ?? null,
    };
  }, args);
}

test('radio: switching stations changes the playing track; each station plays without clipping', async ({
  page,
}) => {
  const problems = await openHarness(page);
  // 2 = the rockabilly station, 3 = the surf station (sorted by id).
  const r = await render(page, { choice: 2, switchTo: 3, music: 1, dur: 4, table });
  expect(problems).toEqual([]);
  expect(r.refBefore).toMatch(/^base:station\/keys-rockabilly#/);
  expect(r.refAfter).toMatch(/^base:station\/keys-surf#/);
  console.log(
    `radio render: ${r.refBefore} rms ${r.first.rms.toFixed(4)} peak ${r.first.peak.toFixed(3)}; ` +
      `${r.refAfter} rms ${r.second.rms.toFixed(4)} peak ${r.second.peak.toFixed(3)}`,
  );
  for (const half of [r.first, r.second]) {
    expect(half.rms).toBeGreaterThan(0.02);
    expect(half.peak).toBeLessThan(1);
  }
});

// Run W-O: the Pacific Northwest's and San Francisco's own stations play, unclipped, through the
// real graph (the dial order is checked in src/app/regions.test.ts and app-wire-seams.spec.ts).
for (const [pack, id] of [
  ['region-pnw', 'pnw-drizzle'],
  ['region-pnw', 'pnw-salal'],
  ['region-sf', 'sf-burn-rate'],
  ['region-sf', 'sf-fog-bank'],
  // Run W-Q: the third station of each region.
  ['base', 'keys-tradewinds'],
  ['region-pnw', 'pnw-stump'],
  ['region-sf', 'sf-gold-rush'],
] as const) {
  test(`radio: ${pack}'s own station ${id} plays without clipping`, async ({ page }) => {
    const file = new URL(`../../packs/${pack}/stations/${id}.json`, import.meta.url);
    const regional = { [`${pack}:${id}`]: JSON.parse(readFileSync(file, 'utf8')) as unknown };
    const problems = await openHarness(page);
    const r = await render(page, { choice: 2, switchTo: null, music: 1, dur: 3, table: regional });
    expect(problems).toEqual([]);
    expect(r.refAfter).toMatch(new RegExp(`^${pack}:station/${id}#`));
    console.log(`radio render: ${r.refAfter} rms ${r.first.rms.toFixed(4)} peak ${r.first.peak.toFixed(3)}`);
    expect(r.first.rms).toBeGreaterThan(0.02);
    expect(r.first.peak).toBeLessThan(1);
  });
}

// Playtest 2 (2026-10-02, "different stations and music in different regions"): every band, the
// Keys' and the regional ones, plays unclipped and at about the same loudness, so switching
// stations or regions never jumps the level. One synthetic station per band, two songs each.
test('radio: every band plays unclipped, within 3.5 dB of the others', async ({ page }) => {
  test.setTimeout(300_000);
  const bands = [
    ['surf', 'surf-trio'],
    ['rockabilly', 'rockabilly-trio'],
    ['grunge', 'grunge-band'],
    ['folk', 'folk-band'],
    ['synth', 'synth-band'],
    ['psych', 'psych-band'],
    // Run W-Q: the six newer bands (a third station and a hidden pirate per region).
    ['island', 'island-band'],
    ['dub', 'dub-band'],
    ['stoner', 'stoner-band'],
    ['ambient', 'ambient-band'],
    ['funk', 'funk-band'],
    ['chip', 'chip-band'],
  ] as const;
  const problems = await openHarness(page);
  const levels: Record<string, number> = {};
  for (const [genre, preset] of bands) {
    const station = {
      id: `band-${genre}`,
      name: genre,
      genre,
      regions: [],
      tracks: ['a', 'b'].map((id) => ({
        id,
        title: id,
        procedural: { preset },
        origin: 'agent',
        status: 'live',
      })),
    };
    const r = await render(page, {
      choice: 2,
      switchTo: null,
      music: 1,
      dur: 8,
      table: { [`base:band-${genre}`]: station },
    });
    const rms = (r.first.rms + r.second.rms) / 2;
    const peak = Math.max(r.first.peak, r.second.peak);
    levels[genre] = 20 * Math.log10(rms);
    console.log(`band ${genre}: ${levels[genre].toFixed(1)} dBFS rms, peak ${peak.toFixed(3)}`);
    expect(r.refAfter).toMatch(new RegExp(`^base:station/band-${genre}#`));
    expect(rms).toBeGreaterThan(0.02);
    expect(peak).toBeLessThan(1);
  }
  const all = Object.values(levels);
  expect(Math.max(...all) - Math.min(...all)).toBeLessThan(3.5);
  expect(problems).toEqual([]);
});

test('radio: the music bus still follows its slider', async ({ page }) => {
  const problems = await openHarness(page);
  const off = await render(page, { choice: 3, switchTo: null, music: 0, dur: 2, table });
  const on = await render(page, { choice: 3, switchTo: null, music: 1, dur: 2, table });
  expect(problems).toEqual([]);
  console.log(
    `radio at music 0: peak ${off.first.peak.toFixed(5)}; at music 1: rms ${on.first.rms.toFixed(4)}`,
  );
  expect(off.first.peak).toBeLessThan(1e-3);
  expect(on.first.rms).toBeGreaterThan(0.02);
});

// In the real game: the R key tunes the radio during a race. Every pluck the band plays is a
// buffer source whose buffer is a Karplus-Strong string (radio-synth.ts: 0.6 s upright and 1.1 s
// twang on rockabilly, 0.8 s clean and 0.9 s bass on surf); the score and the cues only play the
// 1 s noise buffer. So the buffer lengths the page starts say which band is playing.
type ProbeWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { snapshot(): { tick: number } | null };
  __plucks?: number[];
};

test.describe('in the game', () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 720 } });

  test('radio: a Keys race starts on rockabilly; R tunes surf, island, then off, then the score', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(err.message));
    await page.addInitScript(() => {
      const w = window as ProbeWindow;
      w.__GAME_TEST__ = true;
      w.__plucks = [];
      const proto = AudioBufferSourceNode.prototype;
      const start = Object.getOwnPropertyDescriptor(proto, 'start')?.value as (
        this: AudioBufferSourceNode,
        ...args: number[]
      ) => void;
      proto.start = function (this: AudioBufferSourceNode, ...args: number[]) {
        if (this.buffer) w.__plucks?.push(Math.round(this.buffer.duration * 100) / 100);
        start.apply(this, args);
      };
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible();
    await page.waitForFunction(() => ((window as ProbeWindow).__game?.snapshot()?.tick ?? 0) > 30);

    const heard = async (ms: number) => {
      await page.evaluate(() => ((window as ProbeWindow).__plucks = []));
      await page.waitForTimeout(ms);
      const d = await page.evaluate(() => (window as ProbeWindow).__plucks ?? []);
      const count = (x: number) => d.filter((v) => v === x).length;
      return { noise: count(1), upright: count(0.6), twang: count(1.1), clean: count(0.8), bass: count(0.9) };
    };

    // Playtest 2 (2026-10-02): the race starts on the region's own station, the Keys' first.
    await page.waitForTimeout(800); // the stations load on first use
    const rockabilly = await heard(2000);
    await page.keyboard.press('r');
    const surf = await heard(2000);
    // The Keys' third station (run W-Q) is Salt Air, the island band, before the radio goes off.
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    const off = await heard(1000);
    await page.keyboard.press('r');
    const score = await heard(1500);
    console.log(
      `plucks heard: score ${JSON.stringify(score)}, rockabilly ${JSON.stringify(rockabilly)}, ` +
        `surf ${JSON.stringify(surf)}, off ${JSON.stringify(off)}`,
    );
    expect(problems).toEqual([]);
    // The score: drums from noise, no strings.
    expect(score.noise).toBeGreaterThan(0);
    expect(score.upright + score.twang + score.clean + score.bass).toBe(0);
    // Rockabilly: the upright bass and the twang guitar.
    expect(rockabilly.upright).toBeGreaterThan(0);
    expect(rockabilly.twang).toBeGreaterThan(0);
    // Surf: the electric bass and the clean rhythm guitar (or the tremolo-picked twang lead).
    expect(surf.bass).toBeGreaterThan(0);
    expect(surf.twang + surf.clean).toBeGreaterThan(0);
    expect(surf.upright).toBe(0);
    // Off: no band.
    expect(off.upright + off.twang + off.clean + off.bass).toBe(0);
  });
});
