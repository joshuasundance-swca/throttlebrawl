// The debug report's text (docs/milestones/M1.md, dev-3; docs/architecture.md, "Replay and input
// recording"): a plain-text summary of at most 2 KB for "copy debug report", and the debug file,
// which is the summary, the full report and the replay as one line of JSON. Pure functions over
// plain data, so the unit tests need no browser; index.ts gathers the data from the app.
import type { SimEvent } from '../../sim/api';

/** The copied summary's hard limit, in UTF-8 bytes. */
export const SUMMARY_MAX_BYTES = 2048;
/** Events the summary lists (the newest). The debug file lists every one the app kept. */
export const SUMMARY_EVENTS = 30;
/** Errors the summary lists (the newest). */
export const SUMMARY_ERRORS = 5;

const FULL_MARKER = '===== full report =====';
const REPLAY_MARKER = '===== replay (one line of JSON) =====';

export interface ReportError {
  /** ISO time the error was seen. */
  at: string;
  message: string;
}

export interface ReportPercentiles {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

/** Everything the report says, as plain data. */
export interface ReportData {
  /** ISO time the report was taken. */
  takenAt: string;
  build: { id: string; channel: string; branch: string };
  replayKey: string;
  hashes: { sim: string; full: string };
  renderer: {
    renderer: string;
    pixelRatio: number;
    width: number;
    height: number;
    drawCalls: number;
    triangles: number;
  };
  /** The browser's user-agent string: the device and browser. */
  device: string;
  state: string;
  /** The sim tick about to be stepped, or null outside a race. */
  tick: number | null;
  /** The settings record as stored (a versioned envelope) or the in-memory settings. */
  settings: unknown;
  /** Declared defaults of the sim-affecting tuning parameters, to list what differs. */
  tuningDefaults: Readonly<Record<string, number>>;
  /** The last race's replay file (replay-1's encoded recording), or null before any race. */
  replay: unknown;
  frame: ReportPercentiles;
  step: ReportPercentiles;
  heapMB: number | null;
  errors: readonly ReportError[];
  /** The app's recent events, oldest first. */
  events: readonly SimEvent[];
}

const encoder = new TextEncoder();

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** At most `max` characters (code points, so nothing is cut in half), with an ellipsis when cut. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** At most `max` UTF-8 bytes, cut on a character boundary. */
function clipBytes(text: string, max: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const n = utf8Bytes(ch);
    if (bytes + n > max) break;
    bytes += n;
    out += ch;
  }
  return out;
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' | ');
const num = (n: number, digits = 1) => (Number.isFinite(n) ? String(Number(n.toFixed(digits))) : String(n));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The settings themselves, whether stored in the versioned envelope or not. */
function settingsData(settings: unknown): Record<string, unknown> {
  if (isObject(settings) && isObject(settings['data'])) return settings['data'];
  return isObject(settings) ? settings : {};
}

function settingsLine(settings: unknown): string {
  const s = settingsData(settings);
  const v = isObject(s['volumes']) ? s['volumes'] : {};
  const vol = ['master', 'music', 'effects', 'voices'].map((k) =>
    typeof v[k] === 'number' ? num(v[k]) : '?',
  );
  const onOff = (x: unknown) => (x === true ? 'on' : x === false ? 'off' : '?');
  const units = typeof s['units'] === 'string' ? s['units'] : '?';
  const preset = typeof s['tuningPreset'] === 'string' ? s['tuningPreset'] : '?';
  return `settings vol ${vol.join('/')} · mute ${onOff(s['mute'])} · mirror ${onOff(s['mirror'])} · ${units} · preset ${clip(preset, 40)}`;
}

/** Veto flags (M2 stores them in the settings record) as content references. */
function vetoRefs(settings: unknown): string[] {
  const vetoes = settingsData(settings)['vetoes'];
  if (!Array.isArray(vetoes)) return [];
  return vetoes.map((v: unknown) =>
    isObject(v) && typeof v['contentRef'] === 'string' ? v['contentRef'] : String(v),
  );
}

interface ReplayView {
  seed: number | null;
  ticks: number | null;
  startTuning: Record<string, number>;
  params: { tick: number; id: string; value: number }[];
}

function replayView(replay: unknown): ReplayView | null {
  if (!isObject(replay)) return null;
  const header = isObject(replay['header']) ? replay['header'] : {};
  const inputs = isObject(replay['inputs']) ? replay['inputs'] : {};
  const tuning: Record<string, number> = {};
  if (isObject(header['tuning']))
    for (const [id, value] of Object.entries(header['tuning']))
      if (typeof value === 'number') tuning[id] = value;
  const params = Array.isArray(replay['params'])
    ? replay['params'].filter(
        (p): p is { tick: number; id: string; value: number } =>
          isObject(p) &&
          typeof p['tick'] === 'number' &&
          typeof p['id'] === 'string' &&
          typeof p['value'] === 'number',
      )
    : [];
  return {
    seed: typeof header['seed'] === 'number' ? header['seed'] : null,
    ticks: typeof inputs['ticks'] === 'number' ? inputs['ticks'] : null,
    startTuning: tuning,
    params,
  };
}

/** Race-start values that differ from the declared defaults, then the mid-race changes. */
function tuningLine(view: ReplayView | null, defaults: Readonly<Record<string, number>>): string {
  if (!view) return 'tuning no race yet';
  const start = Object.entries(view.startTuning)
    .filter(([id, value]) => defaults[id] !== value)
    .map(([id, value]) => `${id}=${num(value, 3)}`);
  const mid = view.params.slice(-5).map((p) => `t${p.tick} ${p.id}=${num(p.value, 3)}`);
  const more = view.params.length > mid.length ? ` (+${view.params.length - mid.length} earlier)` : '';
  return clip(
    `tuning start ${start.length ? start.join(', ') : 'defaults'} · mid-race ${view.params.length}${
      mid.length ? `: ${mid.join(', ')}${more}` : ''
    }`,
    300,
  );
}

function formatEvent(e: SimEvent): string {
  const who = e.target === undefined ? `${e.actor}` : `${e.actor}>${e.target}`;
  const data = Object.entries(e.data)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? num(v, 2) : String(v)}`)
    .join(' ');
  return ` t${e.tick} ${e.type} ${who}${data ? ` ${data}` : ''}`;
}

function formatError(e: ReportError, max: number): string {
  const time = e.at.length >= 19 ? e.at.slice(11, 19) : e.at;
  return ` ${time} ${clip(oneLine(e.message), max)}`;
}

/** The lines every report starts with; the summary clips the long ones. */
function headLines(d: ReportData, full: boolean): string[] {
  const c = (text: string, max: number) => (full ? text : clip(text, max));
  const r = d.renderer;
  const view = replayView(d.replay);
  const vetoes = vetoRefs(d.settings);
  const race = [
    `state ${d.state}`,
    d.tick === null ? '' : ` · tick ${d.tick}`,
    view?.seed === null || view === null ? '' : ` · seed ${view.seed}`,
    view === null ? ' · replay none' : ` · replay ${view.ticks ?? '?'} ticks`,
  ].join('');
  return [
    `throttlebrawl debug report · ${d.takenAt}`,
    `build ${d.build.id} · ${d.build.channel} · ${c(d.build.branch, 60)}`,
    `replay key ${c(d.replayKey, 80)}`,
    `content sim ${d.hashes.sim} full ${d.hashes.full}`,
    `renderer ${c(oneLine(r.renderer), 120)} · dpr ${num(r.pixelRatio, 2)} · ${r.width}x${r.height} · ${r.drawCalls} draws ${num(r.triangles / 1000)}k tris`,
    `device ${c(oneLine(d.device), 110)}`,
    race,
    settingsLine(d.settings),
    tuningLine(view, d.tuningDefaults),
    `frames p50 ${num(d.frame.p50)} p95 ${num(d.frame.p95)} max ${num(d.frame.max)} ms (n ${d.frame.samples}) · sim step p95 ${num(d.step.p95, 2)} ms${
      d.heapMB === null ? '' : ` · heap ${Math.round(d.heapMB)} MB`
    }`,
    vetoes.length ? c(`vetoes ${vetoes.length}: ${vetoes.join(', ')}`, 300) : 'vetoes none',
  ];
}

/**
 * The copied summary: at most 2 KB of UTF-8. When it would be longer, the oldest events go first,
 * then the older errors (the newest always stays), then a hard cut at the byte limit.
 */
export function buildSummary(d: ReportData): string {
  const head = headLines(d, false);
  const errors = d.errors.slice(-SUMMARY_ERRORS).map((e) => formatError(e, 160));
  const events = d.events.slice(-SUMMARY_EVENTS).map(formatEvent);
  const compose = () =>
    [
      ...head,
      `errors ${d.errors.length}${errors.length < d.errors.length ? ` (newest ${errors.length})` : ''}`,
      ...errors,
      `events ${d.events.length}${events.length < d.events.length ? ` (last ${events.length})` : ''}`,
      ...events,
    ].join('\n');
  let text = compose();
  while (utf8Bytes(text) > SUMMARY_MAX_BYTES && events.length > 0) {
    events.shift();
    text = compose();
  }
  while (utf8Bytes(text) > SUMMARY_MAX_BYTES && errors.length > 1) {
    errors.shift();
    text = compose();
  }
  return utf8Bytes(text) > SUMMARY_MAX_BYTES ? clipBytes(text, SUMMARY_MAX_BYTES) : text;
}

/** The debug file: the summary, then the full report, then the replay as one line of JSON. */
export function buildDebugFile(d: ReportData): string {
  const view = replayView(d.replay);
  return [
    buildSummary(d),
    '',
    FULL_MARKER,
    ...headLines(d, true),
    `tuning at race start ${JSON.stringify(view?.startTuning ?? null)}`,
    `tuning mid-race ${JSON.stringify(view?.params ?? [])}`,
    `settings record ${JSON.stringify(d.settings ?? null)}`,
    `frames ${JSON.stringify(d.frame)} · sim step ${JSON.stringify(d.step)}`,
    `errors ${d.errors.length}`,
    ...d.errors.map((e) => formatError(e, 4000)),
    `events ${d.events.length}`,
    ...d.events.map(formatEvent),
    '',
    REPLAY_MARKER,
    JSON.stringify(d.replay ?? null),
    '',
  ].join('\n');
}

/** Reads a debug file back: the summary and the replay (null when the file carries none). */
export function parseDebugFile(text: string): { summary: string; replay: unknown } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.indexOf(REPLAY_MARKER);
  const full = lines.indexOf(FULL_MARKER);
  if (at < 0 || full < 0) throw new Error('debug report: not a debug file (no replay section)');
  const replay: unknown = JSON.parse(lines[at + 1] ?? 'null');
  return { summary: lines.slice(0, full).join('\n').trimEnd(), replay };
}

/** `throttlebrawl-debug-<build>-<yyyymmdd>-<hhmmss>.txt`, from the report's own time. */
export function debugFileName(d: Pick<ReportData, 'build' | 'takenAt'>): string {
  const id = d.build.id.replace(/[^A-Za-z0-9]/g, '') || 'build';
  const digits = d.takenAt.replace(/[^0-9]/g, '');
  const stamp = digits.length >= 14 ? `${digits.slice(0, 8)}-${digits.slice(8, 14)}` : 'now';
  return `throttlebrawl-debug-${id}-${stamp}.txt`;
}
