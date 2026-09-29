// Version headers for every persisted record (docs/architecture.md, "Save format"): an envelope
// {format, version, build, savedAt, data}. The format strings are name-neutral.

export interface VersionedRecord<F extends string, D> {
  format: F;
  version: number;
  build: string;
  savedAt: string;
  data: D;
}

export function wrapRecord<F extends string, D>(
  format: F,
  version: number,
  build: string,
  data: D,
  savedAt: string,
): VersionedRecord<F, D> {
  return { format, version, build, savedAt, data };
}

export type HeaderCheck =
  { kind: 'ok'; version: number } | { kind: 'newer'; version: number } | { kind: 'invalid'; reason: string };

/**
 * Reads a raw parsed record's header. A record newer than the build understands is reported as
 * `newer`: the caller must refuse it and keep it, never overwrite it.
 */
export function checkHeader(raw: unknown, format: string, supportedVersion: number): HeaderCheck {
  if (typeof raw !== 'object' || raw === null) return { kind: 'invalid', reason: 'not an object' };
  const rec = raw as Record<string, unknown>;
  if (rec['format'] !== format) return { kind: 'invalid', reason: `format is not ${format}` };
  const version = rec['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'invalid', reason: 'version is not a positive integer' };
  }
  if (!('data' in rec)) return { kind: 'invalid', reason: 'no data' };
  if (version > supportedVersion) return { kind: 'newer', version };
  return { kind: 'ok', version };
}
