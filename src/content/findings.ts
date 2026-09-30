// Validation findings (docs/content-packs.md, "Validation"): every message carries a file path and
// a JSON pointer, so an agent can fix it without searching. Errors fail packs:check; warnings
// print and pass.

export interface Finding {
  level: 'error' | 'warning';
  /** The rule that produced it: schema, ids, refs, public-safety, steal-window, tuning-keys, ... */
  rule: string;
  /** Pack-relative path (`bikes/rustbucket-400.json`); the tool prefixes the pack folder. */
  file: string;
  /** JSON pointer into the file (`/handling/topSpeedMps`), or '' for the whole file. */
  pointer: string;
  message: string;
}

/** Escapes one JSON pointer segment (RFC 6901). */
function segment(part: string | number): string {
  return String(part).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** A JSON pointer from path parts: pointer(['steal', 'windowEndS']) is '/steal/windowEndS'. */
export function pointer(parts: readonly (string | number)[]): string {
  return parts.map((p) => `/${segment(p)}`).join('');
}

/** `packs/base/weapons/lead-pipe.json /steal/windowEndS: message`, with an optional prefix. */
export function formatFinding(f: Finding, prefix = ''): string {
  const where = f.pointer ? `${prefix}${f.file} ${f.pointer}` : `${prefix}${f.file}`;
  return `${where}: ${f.message}`;
}

export function error(rule: string, file: string, ptr: string, message: string): Finding {
  return { level: 'error', rule, file, pointer: ptr, message };
}

export function warning(rule: string, file: string, ptr: string, message: string): Finding {
  return { level: 'warning', rule, file, pointer: ptr, message };
}
