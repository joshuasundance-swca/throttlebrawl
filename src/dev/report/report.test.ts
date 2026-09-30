import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/api';
import { captureErrors, createErrorLog, MAX_ERRORS } from './errors';
import {
  buildDebugFile,
  buildSummary,
  debugFileName,
  parseDebugFile,
  SUMMARY_MAX_BYTES,
  utf8Bytes,
  type ReportData,
} from './summary';

// dev-3's unit acceptance (docs/milestones/M1.md, dev-3): the copied summary stays within 2 KB even
// with long error lists, and still carries what an agent needs first. The debug file carries the
// full report plus the replay, and reads back.

function events(n: number): SimEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    tick: 100 + i * 7,
    type: i % 3 === 0 ? 'hit' : 'overtake',
    actor: i % 5,
    target: (i + 1) % 5,
    data: i % 3 === 0 ? { damage: 12, weapon: 'punch' } : { place: 2 },
  }));
}

const replay = {
  header: {
    formatVersion: 1,
    replayKey: 'abc1234+0badf00d',
    seed: 77,
    eventId: 'm1-skeleton-sprint',
    tuning: { 'riders.steerScale': 1.25, 'combat.hitStopScale': 1 },
  },
  inputs: { ticks: 3, slots: [[3, 0, 255, 0, 0]] },
  params: [{ tick: 900, id: 'riders.steerScale', value: 1.1 }],
  hashes: [{ tick: 0, hash: 12345 }],
};

function data(over: Partial<ReportData> = {}): ReportData {
  return {
    takenAt: '2026-09-30T03:00:00.000Z',
    build: { id: 'abc1234', channel: 'staging', branch: 'lane/dev/debug-report' },
    replayKey: 'abc1234+0badf00d',
    hashes: { sim: '0badf00d', full: 'cafe1234' },
    renderer: {
      renderer: 'ANGLE (test GPU)',
      pixelRatio: 1.5,
      width: 915,
      height: 412,
      drawCalls: 18,
      triangles: 42820,
    },
    device: 'Mozilla/5.0 (Linux; Android 14) test',
    state: 'race',
    tick: 1234,
    settings: {
      format: 'settings',
      version: 1,
      build: 'abc1234',
      savedAt: '2026-09-30T02:00:00.000Z',
      data: {
        volumes: { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 },
        mute: false,
        mirror: true,
        tuningPreset: 'registry',
        units: 'kmh',
      },
    },
    tuningDefaults: { 'riders.steerScale': 1, 'combat.hitStopScale': 1 },
    replay,
    frame: { samples: 600, p50: 16.7, p95: 18.2, max: 40.1 },
    step: { samples: 600, p50: 0.31, p95: 0.62, max: 2.5 },
    heapMB: 41.2,
    errors: [{ at: '2026-09-30T02:59:58.000Z', message: 'TypeError: boom at render' }],
    events: events(40),
    ...over,
  };
}

describe('dev/report: the copied summary', () => {
  it('carries the build, replay key, hashes, renderer, settings, tuning, frames, errors, events and vetoes', () => {
    const text = buildSummary(data());
    expect(text).toContain('abc1234 · staging · lane/dev/debug-report');
    expect(text).toContain('replay key abc1234+0badf00d');
    expect(text).toContain('sim 0badf00d');
    expect(text).toContain('full cafe1234');
    expect(text).toContain('ANGLE (test GPU)');
    expect(text).toContain('dpr 1.5');
    expect(text).toContain('915x412');
    expect(text).toMatch(/settings .*mirror on.*kmh.*preset registry/);
    expect(text).toContain('riders.steerScale=1.25'); // differs from the default at race start
    expect(text).not.toContain('combat.hitStopScale'); // at its default: not a change
    expect(text).toContain('t900 riders.steerScale=1.1'); // the mid-race change
    expect(text).toMatch(/frames p50 16\.7 p95 18\.2 max 40\.1 ms/);
    expect(text).toContain('TypeError: boom at render');
    expect(text).toContain('vetoes none');
    // The last 30 of 40 events, oldest first, the newest last.
    const eventLines = text.split('\n').filter((l) => /^ t\d+ /.test(l));
    expect(eventLines).toHaveLength(30);
    expect(eventLines[29]).toContain(`t${100 + 39 * 7} hit`);
    expect(eventLines[0]).toContain(`t${100 + 10 * 7} `);
    expect(utf8Bytes(text)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
  });

  it('stays within 2 KB even with long error lists, and keeps the build id and replay key', () => {
    const long = 'x'.repeat(5000);
    const text = buildSummary(
      data({
        errors: Array.from({ length: 200 }, (_, i) => ({
          at: '2026-09-30T02:59:58.000Z',
          message: `Error ${i} ${long}`,
        })),
        events: events(300),
        renderer: {
          renderer: 'R'.repeat(600),
          pixelRatio: 3,
          width: 2400,
          height: 1080,
          drawCalls: 1,
          triangles: 1,
        },
        device: 'U'.repeat(2000),
        build: { id: 'abc1234', channel: 'dev', branch: `lane/${'b'.repeat(400)}` },
      }),
    );
    expect(utf8Bytes(text)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(text).toContain('abc1234');
    expect(text).toContain('replay key abc1234+0badf00d');
    expect(text).toContain('vetoes none');
    // The newest error survives the trim, the oldest does not.
    expect(text).toContain('Error 199 ');
    expect(text).not.toContain('Error 0 ');
    expect(text).toContain('errors 200');
  });

  it('counts bytes, not characters: multi-byte errors still fit', () => {
    const text = buildSummary(
      data({
        errors: Array.from({ length: 50 }, () => ({
          at: '2026-09-30T02:59:58.000Z',
          message: '💥·é'.repeat(400),
        })),
      }),
    );
    expect(utf8Bytes(text)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    // No character was cut in half: the text survives a UTF-8 round trip unchanged.
    expect(new TextDecoder().decode(new TextEncoder().encode(text))).toBe(text);
  });

  it('lists vetoes from the settings record as content references', () => {
    const settings = data().settings as { data: Record<string, unknown> };
    const text = buildSummary(
      data({
        settings: {
          ...settings,
          data: {
            ...settings.data,
            vetoes: [{ contentRef: 'base:bark-set/kevin-core#kevin-pass-email', raceId: 'r1', tick: 40 }],
          },
        },
      }),
    );
    expect(text).toContain('vetoes 1: base:bark-set/kevin-core#kevin-pass-email');
  });

  it('copes with no race yet: no replay, no events, plain settings', () => {
    const text = buildSummary(
      data({ replay: null, events: [], errors: [], tick: null, state: 'menu', settings: { mute: true } }),
    );
    expect(text).toContain('state menu');
    expect(text).toContain('replay none');
    expect(text).toContain('errors 0');
    expect(text).toContain('events 0');
    expect(text).toContain('mute on');
  });
});

describe('dev/report: the debug file', () => {
  it('holds the summary, every error and event, and the replay, which reads back unchanged', () => {
    const d = data({
      errors: Array.from({ length: 12 }, (_, i) => ({
        at: '2026-09-30T02:59:58.000Z',
        message: `Error ${i}`,
      })),
      events: events(300),
    });
    const file = buildDebugFile(d);
    expect(file.startsWith(buildSummary(d))).toBe(true);
    for (let i = 0; i < 12; i++) expect(file).toContain(`Error ${i}\n`);
    expect(file.split('\n').filter((l) => /^ t\d+ /.test(l)).length).toBeGreaterThanOrEqual(300);
    const parsed = parseDebugFile(file);
    expect(parsed.replay).toEqual(replay);
    expect(parsed.summary).toContain('replay key abc1234+0badf00d');
  });

  it('reads back a file whose replay is missing, and refuses text that is not a debug file', () => {
    expect(parseDebugFile(buildDebugFile(data({ replay: null }))).replay).toBeNull();
    expect(() => parseDebugFile('hello')).toThrow(/not a debug file/);
  });

  it('names the file after the build and the time, with no characters a phone would mangle', () => {
    expect(debugFileName(data())).toBe('throttlebrawl-debug-abc1234-20260930-030000.txt');
  });
});

describe('dev/report: recent errors', () => {
  function fakeWindow() {
    const target = new EventTarget();
    const logged: unknown[][] = [];
    const source = {
      addEventListener: (type: string, fn: (e: Event) => void) => target.addEventListener(type, fn),
      console: { error: (...args: unknown[]) => void logged.push(args) },
    };
    const fire = (type: string, props: Record<string, unknown>) =>
      target.dispatchEvent(Object.assign(new Event(type), props));
    return { source, logged, fire };
  }

  it('collects uncaught errors, unhandled rejections and console.error, and still logs to the console', () => {
    const w = fakeWindow();
    const log = createErrorLog(() => '2026-09-30T03:00:00.000Z');
    captureErrors(w.source, log);
    w.fire('error', {
      message: 'Uncaught boom',
      filename: 'https://example.test/assets/index-abc.js',
      lineno: 42,
    });
    w.fire('unhandledrejection', { reason: new RangeError('bad range') });
    w.source.console.error('render failed', { code: 7 });
    const messages = log.list().map((e) => e.message);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe('Uncaught boom (index-abc.js:42)');
    expect(messages[1]).toMatch(/^unhandled rejection: RangeError: bad range/);
    expect(messages[2]).toBe('console.error: render failed {"code":7}');
    expect(w.logged).toEqual([['render failed', { code: 7 }]]);
  });

  it(`keeps only the newest ${MAX_ERRORS}`, () => {
    const log = createErrorLog();
    for (let i = 0; i < MAX_ERRORS + 25; i++) log.add(`error ${i}`);
    expect(log.list()).toHaveLength(MAX_ERRORS);
    expect(log.list()[0]?.message).toBe('error 25');
  });
});
