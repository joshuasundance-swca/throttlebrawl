import { describe, expect, it } from 'vitest';
import {
  atan2,
  checkHeader,
  cos,
  createStreams,
  FNV_OFFSET,
  fnvByte,
  fnvF64,
  nextFloat,
  nextU32,
  placeElement,
  secondsToTicks,
  sin,
  streamSeed,
  tuningDefaults,
  wrapAngle,
  wrapRecord,
  type LayoutElement,
} from './index';

describe('core/math', () => {
  it('sin and cos match Math within 1e-10 over many turns', () => {
    let worst = 0;
    for (let x = -50; x <= 50; x += 0.0137) {
      worst = Math.max(worst, Math.abs(sin(x) - Math.sin(x)), Math.abs(cos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-10);
  });

  it('atan2 matches Math.atan2 within 1e-12 in every quadrant', () => {
    let worst = 0;
    for (let a = -Math.PI; a <= Math.PI; a += 0.0071) {
      for (const r of [0.001, 1, 250]) {
        const y = r * Math.sin(a);
        const x = r * Math.cos(a);
        worst = Math.max(worst, Math.abs(atan2(y, x) - Math.atan2(y, x)));
      }
    }
    expect(worst).toBeLessThan(1e-12);
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(1, 0)).toBeCloseTo(Math.PI / 2, 15);
  });

  it('wraps angles into [-pi, pi]', () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI, 12);
  });

  it('converts seconds to ticks by the content rule (M1 starting numbers)', () => {
    expect([0.12, 0.08, 0.25, 0.22, 0.1, 0.45, 0.5, 5, 0.001].map((s) => secondsToTicks(s))).toEqual([
      7, 5, 15, 13, 6, 27, 30, 300, 1,
    ]);
  });
});

describe('core/rng', () => {
  it('is reproducible from the race seed', () => {
    const a = createStreams(42);
    const b = createStreams(42);
    const seqA = Array.from({ length: 5 }, () => nextU32(a.traffic));
    const seqB = Array.from({ length: 5 }, () => nextU32(b.traffic));
    expect(seqA).toEqual(seqB);
  });

  it('keeps named streams independent', () => {
    const a = createStreams(7);
    const b = createStreams(7);
    for (let i = 0; i < 100; i++) nextU32(a.traffic); // extra traffic rolls...
    expect(nextU32(a.ai)).toBe(nextU32(b.ai)); // ...do not shift the AI's rolls
    expect(streamSeed(7, 'ai')).not.toBe(streamSeed(7, 'traffic'));
    expect(streamSeed(7, 'ai', 3)).not.toBe(streamSeed(7, 'ai', 4));
  });

  it('draws floats in [0, 1)', () => {
    const s = createStreams(1).combat;
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('core/hash (FNV-1a 32)', () => {
  const ascii = (text: string) => [...text].reduce((h, c) => fnvByte(h, c.charCodeAt(0)), FNV_OFFSET);
  it('matches the published test vectors', () => {
    expect(ascii('')).toBe(0x811c9dc5);
    expect(ascii('a')).toBe(0xe40c292c);
    expect(ascii('foobar')).toBe(0xbf9cf968);
  });
  it('hashes float bits exactly', () => {
    expect(fnvF64(FNV_OFFSET, 0.1 + 0.2)).not.toBe(fnvF64(FNV_OFFSET, 0.3));
    expect(fnvF64(FNV_OFFSET, 1.5)).toBe(fnvF64(FNV_OFFSET, 1.5));
  });
});

describe('core/version', () => {
  const rec = wrapRecord('settings', 2, 'abc1234', { mute: false }, '2026-09-29T00:00:00Z');
  it('accepts a record the build understands', () => {
    expect(checkHeader(rec, 'settings', 2)).toEqual({ kind: 'ok', version: 2 });
  });
  it('flags a record newer than the build, so it is refused and kept', () => {
    expect(checkHeader(rec, 'settings', 1)).toEqual({ kind: 'newer', version: 2 });
  });
  it('rejects the wrong format and junk', () => {
    expect(checkHeader(rec, 'profile', 2).kind).toBe('invalid');
    expect(checkHeader('{', 'settings', 2).kind).toBe('invalid');
    expect(checkHeader({ format: 'settings', version: 0, data: 1 }, 'settings', 2).kind).toBe('invalid');
  });
});

describe('core/layout and tuning', () => {
  const attack: LayoutElement = {
    element: 'touch-attack',
    visible: true,
    anchor: 'bottom-right',
    offset: [0.1, 0.1],
    scale: 1,
    opacity: 0.7,
  };
  it('places an element from its anchor, and the mirror swaps sides', () => {
    const r = placeElement(attack, 900, 400, false);
    expect(r).toEqual({ x: 900 - 40 - 80, y: 400 - 40 - 80, w: 80, h: 80 });
    expect(placeElement(attack, 900, 400, true).x).toBe(40);
  });
  it('collects declaration defaults', () => {
    const decl = { group: 'g', label: 'l', min: 0, max: 2, step: 0.1, unit: '', affectsSim: true };
    expect(tuningDefaults([{ ...decl, id: 'a.b', default: 1 }])).toEqual({ 'a.b': 1 });
  });
});
