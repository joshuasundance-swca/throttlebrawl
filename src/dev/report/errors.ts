// Recent errors for the debug report: uncaught errors, unhandled promise rejections and anything
// logged with console.error, newest last, capped. The original console.error still runs, so the
// browser tests' "no console errors" checks see exactly what they saw before.
import type { ReportError } from './summary';

/** Errors kept for the report; the summary shows the newest few, the debug file all of them. */
export const MAX_ERRORS = 50;

export interface ErrorLog {
  list(): readonly ReportError[];
  add(message: string): void;
}

/** What the capture needs from `window`: its events and its console. */
export interface ErrorSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  console: { error: (...args: unknown[]) => void };
}

export function describeValue(value: unknown): string {
  if (value instanceof Error)
    return value.stack?.includes(value.message) ? value.stack : `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function createErrorLog(now: () => string = () => new Date().toISOString()): ErrorLog {
  const errors: ReportError[] = [];
  return {
    list: () => errors,
    add(message) {
      errors.push({ at: now(), message });
      if (errors.length > MAX_ERRORS) errors.shift();
    },
  };
}

/** Starts collecting errors from `source` (the page's window) into `log`. */
export function captureErrors(source: ErrorSource, log: ErrorLog): void {
  source.addEventListener('error', (event) => {
    const e = event as Event & { message?: string; error?: unknown; filename?: string; lineno?: number };
    const where = e.filename ? ` (${e.filename.split('/').pop() ?? ''}:${e.lineno ?? 0})` : '';
    const what = e.error !== undefined && e.error !== null ? describeValue(e.error) : (e.message ?? 'error');
    log.add(`${what}${where}`);
  });
  source.addEventListener('unhandledrejection', (event) => {
    log.add(`unhandled rejection: ${describeValue((event as Event & { reason?: unknown }).reason)}`);
  });
  const original = source.console.error.bind(source.console);
  source.console.error = (...args: unknown[]) => {
    log.add(`console.error: ${args.map(describeValue).join(' ')}`);
    original(...args);
  };
}
