// The perf probe (docs/architecture.md, "Testing seams"; M1 dev-2): frame-time percentiles, the
// measured display refresh rate, sim step time (the app's step timer), draw calls and triangles
// (render's stats, reached through the AppHandle), and heap size where the browser shows it. It
// feeds the `?debug=1` overlay, the test handle's `perf()` (the CI perf check) and, later, the
// debug report (dev-3).
import type { AppHandle } from '../../app';
import { fastForwardSeconds } from '../report/summary';

export interface Percentiles {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

export interface PerfReport {
  renderer: string;
  pixelRatio: number;
  width: number;
  height: number;
  drawCalls: number;
  triangles: number;
  /** Intervals between animation frames, ms (last ~600 frames). */
  frameMs: Percentiles;
  /** Frames per second over the last ~60 frames. */
  fps: number;
  /** Wall-clock time per sim step, ms (last ~600 steps). */
  stepMs: Percentiles;
  /** The display's refresh rate, from the fast frames; null before enough frames. */
  refreshHz: number | null;
  /** Used JS heap, MB, where the browser exposes it (Chromium); else null. */
  heapMB: number | null;
}

/** Nearest-rank percentiles (p = the value at index floor(p · n) of the sorted samples). */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { samples: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

/**
 * The display refresh rate from frame intervals: 1000 / the 20th-percentile interval, so late
 * (dropped) frames do not drag it down. Null with fewer than 30 samples.
 */
export function refreshHz(intervalsMs: readonly number[]): number | null {
  if (intervalsMs.length < 30) return null;
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const fast = sorted[Math.floor(0.2 * sorted.length)] ?? 0;
  return fast > 0 ? 1000 / fast : null;
}

export function debugRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

const round1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** The overlay's text: one short line of numbers, then the renderer string. */
export function formatOverlay(r: PerfReport): string {
  const parts = [
    `${Math.round(r.fps)} fps`,
    `frame ${round1(r.frameMs.p50)} ms (p95 ${round1(r.frameMs.p95)})`,
    `sim ${r.stepMs.p95.toFixed(2)} ms p95`,
  ];
  // replay-2's resume re-runs the race headlessly: at this step time a 6-minute race takes this
  // long to fast-forward (an estimate from the live sim step p50; the measured one is in the report).
  if (r.stepMs.samples > 0) parts.push(`6-min ff ~${fastForwardSeconds(r.stepMs.p50).toFixed(1)} s`);
  if (r.refreshHz !== null) parts.push(`${Math.round(r.refreshHz)} Hz display`);
  parts.push(`${r.drawCalls} draws`, `${(r.triangles / 1000).toFixed(1)}k tris`);
  if (r.heapMB !== null) parts.push(`heap ${Math.round(r.heapMB)} MB`);
  parts.push(`${r.width}x${r.height} @${r.pixelRatio}`);
  return `${parts.join(' · ')}\n${r.renderer}`;
}

export interface PerfProbe {
  report(): PerfReport;
  stop(): void;
}

interface MemoryInfo {
  usedJSHeapSize: number;
}

/** Starts sampling animation-frame intervals; report() combines them with the app's numbers. */
export function createPerfProbe(app: AppHandle): PerfProbe {
  const intervals: number[] = [];
  let last = -1;
  let running = true;
  const frame = (now: number) => {
    if (!running) return;
    if (last >= 0) {
      intervals.push(now - last);
      if (intervals.length > 600) intervals.shift();
    }
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // Hidden pages get no frames; the gap on return is not a frame interval.
  document.addEventListener('visibilitychange', () => {
    last = -1;
  });

  return {
    report() {
      const stats = app.rendererStats();
      const recent = intervals.slice(-60);
      const mean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
      const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
      return {
        renderer: stats.renderer,
        pixelRatio: stats.pixelRatio,
        width: stats.width,
        height: stats.height,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        frameMs: percentiles(intervals),
        fps: mean > 0 ? 1000 / mean : 0,
        stepMs: percentiles(app.stepTimes()),
        refreshHz: refreshHz(intervals),
        heapMB: memory ? memory.usedJSHeapSize / (1024 * 1024) : null,
      };
    },
    stop() {
      running = false;
    },
  };
}

/** The `?debug=1` overlay: the probe's numbers, four times a second, in a corner. */
export function mountDebugOverlay(doc: Document, probe: PerfProbe): HTMLElement {
  const box = doc.createElement('div');
  box.id = 'debug-overlay';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText =
    'position:fixed;left:max(8px,env(safe-area-inset-left));bottom:8px;z-index:900;max-width:70vw;' +
    'padding:4px 8px;background:#000b;color:#9f9;border-radius:4px;white-space:pre-wrap;' +
    'font:11px/1.35 ui-monospace,monospace;pointer-events:none';
  doc.body.append(box);
  const update = () => {
    box.textContent = formatOverlay(probe.report());
  };
  update();
  setInterval(update, 250);
  return box;
}
