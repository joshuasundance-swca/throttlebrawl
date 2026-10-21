import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { BAR_FADE_M, type ScapeRoad } from '../../src/audio/soundscape';

// Render the actual market data through the production mixer and WebAudio voices. Dry weather,
// no traffic, no engine/wind/radio and the authored town tags isolate the roadside guitar.
const kessler = JSON.parse(
  readFileSync(
    new URL(
      '../../packs/region-pnw/regions/pacific-northwest/roads/osm-longview-diamond-kessler.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ScapeRoad['edges'][number];
const market = kessler.features!.find((f) => f.id === 'street-plant-market')!;
const midpoint = (market.s0 + market.s1) / 2;
const dir = new URL('../../src/audio/', import.meta.url);
const modules = new Map<string, string>();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
  const js = ts.transpileModule(readFileSync(new URL(f, dir), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  modules.set(f.replace(/\.ts$/, '.js'), js.replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"));
}

interface Control {
  removeMusic?: boolean;
  s?: number;
  effects?: number;
  master?: number;
  music?: number;
  soundscape?: number;
  mute?: boolean;
}

async function render(page: Page, control: Control = {}) {
  return page.evaluate(
    async ({ edge, s, control }) => {
      type Audio = {
        resume(): Promise<void>;
        setVolumes(v: Record<string, number>, mute: boolean): void;
        setParam(id: string, value: number): void;
        setRegion(id: string): void;
        setRoad(road: unknown, wet: boolean): void;
        frame(s: unknown, playerId: number): void;
        inspect(): { soundscape: { played: { kind: string }[]; rain: number; beds: Record<string, number> } };
      };
      const url = '/__longview-market/system.js';
      const bandUrl = '/__longview-market/radio-band.js';
      const { createAudio } = (await import(url)) as {
        createAudio: (opts: Record<string, unknown>) => Audio;
      };
      const { RADIO_BAND } = (await import(bandUrl)) as { RADIO_BAND: unknown };
      const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
      const audio = createAudio({
        createContext: () => ctx,
        offline: true,
        radioKeys: null,
        barkEvents: null,
        radioSeed: 11,
        radioBand: RADIO_BAND,
      });
      audio.setVolumes(
        { master: control.master ?? 1, music: control.music ?? 1, effects: control.effects ?? 1, voices: 0 },
        control.mute ?? false,
      );
      for (const id of [
        'audio.engineGain',
        'audio.enginePops',
        'audio.windGain',
        'audio.hornRangeM',
        'audio.radio',
      ])
        audio.setParam(id, 0);
      audio.setParam('audio.soundscape', control.soundscape ?? 1);
      audio.setRegion('region-pnw:pacific-northwest');
      const actual = {
        ...edge,
        features: edge.features!.map((f) => {
          if (!control.removeMusic || f.id !== 'street-plant-market') return f;
          const params = { ...f.params };
          delete params['music'];
          return { ...f, params };
        }),
      };
      audio.setRoad({ edges: [actual] }, false);
      await audio.resume();
      const me = {
        id: 0,
        kind: 'rider',
        mode: 'Road',
        road: { edge: 0, s: control.s ?? s, d: 0, h: 0, dir: 1, yaw: 0 },
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        speed: 0,
        lean: 0,
        contentId: 'player',
        slot: 0,
        throttle: 0,
        rpm: 1000,
        gear: 1,
        faction: 'rider',
        targetId: -1,
        health: 100,
        healthMax: 100,
      };
      audio.frame(
        { tick: 1, timeScale: 1, entities: [me], race: { over: false, routeLength: 2000, finishOrder: [] } },
        0,
      );
      // One real mixer frame schedules one finite phrase. Rendering advances the audio clock directly.
      const pcm = (await ctx.startRendering()).getChannelData(0);
      let sum = 0;
      for (const sample of pcm) sum += sample * sample;
      return { rms: Math.sqrt(sum / pcm.length), ...audio.inspect().soundscape };
    },
    { edge: kessler, s: midpoint, control },
  );
}

test('the authored Kessler market reaches the effects mixer, with location and volume controls', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.route('**/__longview-market/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'harness.html')
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>market audio</title>' });
    const body = modules.get(name);
    return body === undefined
      ? route.fulfill({ status: 404, body: 'missing audio module' })
      : route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto('/__longview-market/harness.html');
  expect(market.kind).toBe('roadsideZone');
  expect(market.params?.['music']).toBe('busker');
  const on = await render(page);
  expect(on.played.map((e) => e.kind)).toContain('barMusic');
  expect(on.rain).toBe(0);
  expect(Object.values(on.beds).every((level) => level === 0)).toBe(true);
  expect(on.rms).toBeGreaterThan(0.001);
  for (const control of [
    { removeMusic: true },
    { s: market.s1 + BAR_FADE_M },
    { effects: 0 },
    { master: 0 },
    { soundscape: 0 },
    { mute: true },
  ]) {
    const off = await render(page, control);
    expect(off.rms, JSON.stringify(control)).toBeLessThan(0.000001);
  }
  const musicOff = await render(page, { music: 0 });
  expect(musicOff.rms).toBeGreaterThan(on.rms * 0.99);
  expect(musicOff.rms).toBeLessThan(on.rms * 1.01);
  expect(problems).toEqual([]);
});
