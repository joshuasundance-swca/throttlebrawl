import { describe, expect, it } from 'vitest';
import { debugRequested, formatOverlay, percentiles, refreshHz, type PerfReport } from './index';

describe('dev/perf: the numbers', () => {
  it('percentiles: nearest-rank p50, p95 and max over the samples', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentiles(values)).toEqual({ samples: 100, p50: 51, p95: 96, max: 100 });
    expect(percentiles([])).toEqual({ samples: 0, p50: 0, p95: 0, max: 0 });
    expect(percentiles([7])).toEqual({ samples: 1, p50: 7, p95: 7, max: 7 });
  });

  it('refresh rate: from the fast frames, so dropped frames do not drag it down', () => {
    const at60 = Array.from({ length: 120 }, (_, i) => (i % 10 === 0 ? 33.3 : 16.67));
    expect(refreshHz(at60)).toBeCloseTo(60, 0);
    const at120 = Array.from({ length: 120 }, () => 8.33);
    expect(refreshHz(at120)).toBeCloseTo(120, 0);
    expect(refreshHz([])).toBeNull();
  });

  it('the overlay line names fps, frame time, sim step, draw calls and the renderer', () => {
    const r: PerfReport = {
      renderer: 'ANGLE (test)',
      pixelRatio: 1.5,
      width: 915,
      height: 412,
      drawCalls: 18,
      triangles: 42820,
      frameMs: { samples: 600, p50: 16.7, p95: 18.2, max: 40 },
      fps: 59.8,
      stepMs: { samples: 600, p50: 0.3, p95: 0.61, max: 2 },
      refreshHz: 60,
      heapMB: 41.2,
    };
    const text = formatOverlay(r);
    expect(text).toContain('60 fps');
    expect(text).toContain('frame 16.7 ms');
    expect(text).toContain('p95 18.2');
    expect(text).toContain('sim 0.61 ms p95');
    expect(text).toContain('60 Hz display');
    expect(text).toContain('18 draws');
    expect(text).toContain('42.8k tris');
    expect(text).toContain('heap 41 MB');
    expect(text).toContain('ANGLE (test)');
    expect(formatOverlay({ ...r, heapMB: null, refreshHz: null })).not.toContain('heap');
  });

  it('is requested by ?debug=1 only', () => {
    expect(debugRequested('?debug=1')).toBe(true);
    expect(debugRequested('?selftest=1&debug=1')).toBe(true);
    expect(debugRequested('?debug=0')).toBe(false);
    expect(debugRequested('')).toBe(false);
  });
});
