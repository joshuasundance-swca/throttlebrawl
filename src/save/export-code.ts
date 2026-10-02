// The export code (docs/architecture.md, "Save format": "canonical JSON -> optional deflate-raw via
// CompressionStream -> base64url, prefixed EC1. (export code, format 1), with a flag for compressed
// or plain and a CRC32 checksum. Import validates the checksum, then migrates. Browser support for
// CompressionStream on the target phone is unverified, so the plain form must always decode").
// The product spec's Save: "Progress saves on the device, plus a copyable export code for backup
// and moving between devices" [decided]. The code carries the profile record and, optionally, the
// settings record, each with its own header, so an older code still migrates.
//
// The shape [default]: `EC1.<flag>.<payload>.<crc>`, where flag is `p` (plain) or `z` (deflate-raw),
// payload is base64url without padding, and crc is the CRC32 of the canonical JSON's UTF-8 bytes,
// 8 lowercase hex digits. Canonical JSON: object keys sorted, no spaces. DOM-free (CompressionStream
// and DecompressionStream are platform streams, present in browsers and Node alike).
import type { VersionedRecord } from '../core';
import { migrateProfile, sanitiseProfile, type Profile } from './profile';

export const EXPORT_PREFIX = 'EC1';

/** What a code carries: the profile record, and the settings record when asked. */
export interface ExportBundle {
  profile: VersionedRecord<'profile', unknown>;
  settings?: VersionedRecord<'settings', unknown> | null;
}

export type ImportResult =
  | { kind: 'ok'; profile: Profile; settings: unknown; migrated: number }
  | { kind: 'newer'; version: number }
  | { kind: 'invalid'; reason: string };

/** JSON with every object's keys sorted, so the same data always gives the same code. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    return v;
  };
  return JSON.stringify(sort(value));
}

let crcTable: Uint32Array | null = null;
/** CRC-32 (IEEE 802.3, the zip one) of some bytes, as 8 lowercase hex digits. */
export function crc32(bytes: Uint8Array): string {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = (crcTable[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Whether this browser can write (and read) compressed codes. */
export function compressionSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * The export code for a bundle. Compressed when asked and supported (and only when it is shorter);
 * plain otherwise.
 */
export async function encodeExportCode(
  bundle: ExportBundle,
  opts: { compress?: boolean } = {},
): Promise<string> {
  const json = canonicalJson(bundle.settings ? bundle : { profile: bundle.profile });
  const raw = new TextEncoder().encode(json);
  const crc = crc32(raw);
  const plain = `${EXPORT_PREFIX}.p.${toBase64Url(raw)}.${crc}`;
  if (opts.compress === false || !compressionSupported()) return plain;
  try {
    const packed = await pipe(raw, new CompressionStream('deflate-raw'));
    const zipped = `${EXPORT_PREFIX}.z.${toBase64Url(packed)}.${crc}`;
    return zipped.length < plain.length ? zipped : plain;
  } catch {
    return plain;
  }
}

/**
 * Reads a code: checks its shape and checksum, then migrates the profile to this build's version.
 * Whitespace (a code pasted across lines) is ignored. A profile newer than the build is refused.
 */
export async function decodeExportCode(code: string): Promise<ImportResult> {
  const parts = code.replace(/\s+/g, '').split('.');
  if (parts.length !== 4 || parts[0] !== EXPORT_PREFIX)
    return { kind: 'invalid', reason: 'not an export code' };
  const [, flag, payload = '', crc = ''] = parts;
  if (flag !== 'p' && flag !== 'z') return { kind: 'invalid', reason: 'unknown code flag' };
  if (!/^[0-9a-f]{8}$/.test(crc)) return { kind: 'invalid', reason: 'no checksum' };
  const bytes = fromBase64Url(payload);
  if (!bytes) return { kind: 'invalid', reason: 'the code has characters it should not' };
  let raw = bytes;
  if (flag === 'z') {
    if (!compressionSupported())
      return { kind: 'invalid', reason: 'this browser cannot read a compressed code' };
    try {
      raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } catch {
      return { kind: 'invalid', reason: 'the code is damaged' };
    }
  }
  if (crc32(raw) !== crc) return { kind: 'invalid', reason: 'the checksum does not match (a typo?)' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { kind: 'invalid', reason: 'the code is damaged' };
  }
  const bundle = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const m = migrateProfile(bundle['profile']);
  if (m.kind === 'newer') return { kind: 'newer', version: m.version };
  if (m.kind !== 'ok') return { kind: 'invalid', reason: `no profile in the code (${m.reason})` };
  return {
    kind: 'ok',
    profile: sanitiseProfile(m.data),
    settings: bundle['settings'] ?? null,
    migrated: m.migrated,
  };
}
