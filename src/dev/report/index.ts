// The debug report (docs/milestones/M1.md, dev-3): one button that turns "something broke on my
// phone" into something an agent can fix. "Copy debug report" puts a plain-text summary of at most
// 2 KB on the clipboard; "save debug file" offers the full report plus the replay as a .txt file
// through the phone's share sheet, or downloads it. Both are wired in from src/main.ts, because
// nothing imports dev/. The replay and the settings arrive through the AppHandle
// (getReplayAndSettings, replayFile), so dev/ imports neither replay/ nor save/. Nothing is ever
// sent anywhere automatically [decided].
import type { AppHandle } from '../../app';
import { SIM_TUNING, tuningDefaults } from '../../sim/api';
import { percentiles } from '../perf';
import { pageErrors } from './errors';
import {
  buildDebugFile,
  buildSummary,
  debugFileName,
  utf8Bytes,
  type ReportData,
  type ResumeReport,
} from './summary';

export {
  buildDebugFile,
  buildSummary,
  debugFileName,
  fastForwardSeconds,
  parseDebugFile,
  SIX_MINUTE_TICKS,
  SUMMARY_MAX_BYTES,
} from './summary';
export type { ReportData, ReportError, ResumeReport } from './summary';

/**
 * The seam for app-4: once the AppHandle gains `resumeInfo()` (the saved recording's replay key
 * and tick, a refused one, and the last resume's measured fast-forward), the report prints it. Read
 * by feature detection so this lands before app-4 without an AppHandle contract change.
 */
function resumeInfo(app: AppHandle): ResumeReport | null {
  const get = (app as AppHandle & { resumeInfo?: () => ResumeReport | null }).resumeInfo;
  if (typeof get !== 'function') return null;
  try {
    return get.call(app) ?? null;
  } catch {
    return null;
  }
}
export { captureErrors, createErrorLog, installErrorCapture, MAX_ERRORS, pageErrors } from './errors';
export type { ErrorLog } from './errors';

interface MemoryInfo {
  usedJSHeapSize: number;
}

/** Everything the report says, read from the app right now. */
export function gatherReport(app: AppHandle): ReportData {
  const stats = app.rendererStats();
  const snap = app.snapshot();
  const state = app.state();
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
  return {
    takenAt: new Date().toISOString(),
    build: { ...app.build },
    replayKey: app.replayKey(),
    hashes: app.contentHashes(),
    renderer: stats,
    device: navigator.userAgent,
    state,
    tick: snap && (state === 'race' || state === 'results') ? snap.tick : null,
    settings: app.getReplayAndSettings().settings,
    tuningDefaults: tuningDefaults(SIM_TUNING),
    replay: app.replayFile(),
    frame: app.frameStats(),
    step: percentiles(app.stepTimes()),
    heapMB: memory ? memory.usedJSHeapSize / (1024 * 1024) : null,
    errors: [...pageErrors().list()],
    events: [...app.recentEvents()],
    resume: resumeInfo(app),
  };
}

/** The copied summary (at most 2 KB). */
export function reportText(app: AppHandle): string {
  return buildSummary(gatherReport(app));
}

/** The debug file's text: the summary, the full report and the replay. */
export function debugFileText(app: AppHandle): string {
  return buildDebugFile(gatherReport(app));
}

/** A short line at the top of the screen that says what happened, then fades. */
function toast(text: string): void {
  let box = document.getElementById('debug-report-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'debug-report-toast';
    box.setAttribute('role', 'status');
    box.style.cssText =
      'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);' +
      'z-index:1000;max-width:80vw;padding:8px 14px;border-radius:6px;background:#000d;color:#fff;' +
      'font:600 14px/1.3 system-ui,sans-serif;text-align:center;pointer-events:none';
    document.body.append(box);
  }
  box.textContent = text;
  box.hidden = false;
  const shown = box;
  setTimeout(() => {
    if (shown.textContent === text) shown.hidden = true;
  }, 2500);
}

/** The old way to copy, for browsers without the async clipboard (or when it refuses). */
function copyWithTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok: boolean;
  try {
    // Deprecated, but still the fallback that works on browsers without the async clipboard.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** "Copy debug report": the summary on the clipboard, with a line saying whether it worked. */
export async function copyReport(app: AppHandle): Promise<void> {
  const text = reportText(app);
  const size = `${(utf8Bytes(text) / 1024).toFixed(1)} KB`;
  let ok: boolean;
  try {
    // Called before any await, so the tap's user activation still counts.
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = copyWithTextarea(text);
  }
  toast(
    ok
      ? `Debug report copied (${size}). Paste it in the chat.`
      : 'Could not copy here. Try "Save debug file".',
  );
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * "Save debug file": the phone's share sheet when it can share files, else a download. A share the
 * player cancels is left alone; a share that fails for any other reason falls back to the download.
 */
export async function saveDebugFile(app: AppHandle): Promise<void> {
  const data = gatherReport(app);
  const text = buildDebugFile(data);
  const name = debugFileName(data);
  const file = new File([text], name, { type: 'text/plain' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true) {
    try {
      await nav.share({ files: [file], title: name });
      toast('Debug file shared.');
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  download(text, name);
  toast(`Debug file saved: ${name}`);
}
