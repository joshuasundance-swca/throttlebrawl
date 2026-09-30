import { describe, expect, it } from 'vitest';

// camera-1 acceptance: "the camera reads only snapshot and road data". The module-map lint rule
// (scripts/module-map.mjs: camera -> sim, road) already refuses any other edge, and
// tools/lint/real-folders.test.ts lints these files with it. This test pins the stronger promise:
// the camera's shipped files import nothing but types from the sim contract and the road model, so
// every number it uses arrives as data (the interpolated snapshot, the events, the road handle).
const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'";]*?\bfrom\s+'([^']+)'/gm;
const BARE_IMPORT = /^\s*import\s+'([^']+)'/gm;

describe('the camera module reads only snapshot and road data', () => {
  const files = Object.keys(sources).sort();

  it('examines the shipped camera files', () => {
    console.log(`[examined] ${files.length} camera source files: ${files.join(', ')}`);
    expect(files).toContain('./index.ts');
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('imports only types from ../sim/api and ../road, plus its own files', () => {
    let crossModule = 0;
    for (const file of files) {
      const text = sources[file] ?? '';
      expect([...text.matchAll(BARE_IMPORT)], `${file} has a side-effect import`).toEqual([]);
      expect(text, `${file} uses a dynamic import`).not.toMatch(/\bimport\s*\(/);
      for (const m of text.matchAll(IMPORT)) {
        const [, , typeOnly, spec = ''] = m;
        if (spec.startsWith('./')) continue;
        crossModule++;
        expect(['../sim/api', '../road'], `${file} imports ${spec}`).toContain(spec);
        expect(typeOnly, `${file} imports values from ${spec}`).toBeTruthy();
      }
    }
    expect(crossModule).toBeGreaterThan(0);
  });

  it('touches no browser or clock global, so it can never read the screen or the sim clock', () => {
    for (const file of files) {
      const code = (sources[file] ?? '').replace(/\/\/.*$/gm, '');
      for (const g of [
        'window',
        'document',
        'performance',
        'Date',
        'localStorage',
        'requestAnimationFrame',
      ]) {
        expect(code, `${file} uses ${g}`).not.toMatch(new RegExp(`\\b${g}\\b`));
      }
      expect(code, `${file} uses Math.random`).not.toMatch(/Math\.random/);
    }
  });
});
