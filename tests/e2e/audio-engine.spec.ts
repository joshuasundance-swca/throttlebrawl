import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// audio-1 acceptance: render the real engine patch offline in a real browser and check that it is
// not silent and carries energy above 300 Hz (phone speakers play little below that). The patch
// file has no runtime imports, so it is transpiled as-is and loaded into a blank page.

const source = readFileSync(new URL('../../src/audio/engine-patch.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

test('the engine patch renders offline with energy above 300 Hz', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  await page.goto('about:blank');
  await page.addScriptTag({
    type: 'module',
    content: `${js}\nwindow.__enginePatch = { ENGINE_PRESETS, createEngineVoice };`,
  });
  await page.waitForFunction(() => '__enginePatch' in window);

  const results = await page.evaluate(async () => {
    type Voice = {
      set(s: { rpm: number; throttle: number }, at?: number): void;
      setLevel(v: number, at?: number): void;
    };
    type Patch = {
      ENGINE_PRESETS: Record<string, { preset: string; idleRpm: number; redlineRpm: number }>;
      createEngineVoice(ctx: BaseAudioContext, out: AudioNode, p: unknown, q: 'full' | 'lite'): Voice;
    };
    const patch = (window as unknown as { __enginePatch: Patch }).__enginePatch;
    const rate = 44100;
    const n = 16384; // analysed window, after 0.15 s of settling
    const skip = Math.round(0.15 * rate);

    // Radix-2 FFT magnitude-squared spectrum of a Hann-windowed block.
    const powerSpectrum = (x: Float32Array): Float64Array => {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) re[i] = (x[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
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
      const p = new Float64Array(n / 2);
      for (let i = 0; i < n / 2; i++) p[i] = (re[i] ?? 0) ** 2 + (im[i] ?? 0) ** 2;
      return p;
    };

    const out: { preset: string; rpm: number; rms: number; above300: number; fractionAbove300: number }[] =
      [];
    for (const profile of Object.values(patch.ENGINE_PRESETS)) {
      const rpms = [profile.idleRpm, (profile.idleRpm + profile.redlineRpm) / 2, profile.redlineRpm];
      for (const rpm of rpms) {
        const ctx = new OfflineAudioContext(1, skip + n, rate);
        const voice = patch.createEngineVoice(ctx, ctx.destination, profile, 'full');
        voice.set({ rpm, throttle: 0.8 }, 0);
        voice.setLevel(0.5, 0);
        const buf = await ctx.startRendering();
        const x = buf.getChannelData(0).subarray(skip, skip + n);
        let sq = 0;
        for (const v of x) sq += v * v;
        const p = powerSpectrum(x);
        const bin300 = Math.ceil((300 * n) / rate);
        let total = 0;
        let high = 0;
        for (let i = 1; i < p.length; i++) {
          total += p[i] ?? 0;
          if (i >= bin300) high += p[i] ?? 0;
        }
        out.push({
          preset: profile.preset,
          rpm,
          rms: Math.sqrt(sq / n),
          above300: Math.sqrt(high) / n,
          fractionAbove300: total > 0 ? high / total : 0,
        });
      }
    }
    return out;
  });

  for (const r of results) {
    console.log(
      `engine ${r.preset} @ ${r.rpm} rpm: rms ${r.rms.toFixed(4)}, energy above 300 Hz ${(100 * r.fractionAbove300).toFixed(1)}%`,
    );
  }
  expect(problems).toEqual([]);
  expect(results.length).toBeGreaterThanOrEqual(12); // 4 presets x 3 rpms
  for (const r of results) {
    const label = `${r.preset} @ ${r.rpm}`;
    expect(r.rms, `${label} is not silent`).toBeGreaterThan(0.02);
    expect(r.fractionAbove300, `${label} has energy above 300 Hz`).toBeGreaterThan(0.25);
  }
});
