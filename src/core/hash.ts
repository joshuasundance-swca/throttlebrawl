// FNV-1a, 32-bit (docs/architecture.md, "Sim contract": sim.hash()). A running hash is a plain
// number, so callers can fold numbers and strings into it without allocating.

export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new DataView(new ArrayBuffer(8));

/** Folds one byte into the hash. */
export function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Folds the exact IEEE 754 bits of a float64 into the hash (little-endian byte order). */
export function fnvF64(hash: number, value: number): number {
  scratch.setFloat64(0, value, true);
  let h = hash;
  for (let i = 0; i < 8; i++) h = fnvByte(h, scratch.getUint8(i));
  return h;
}

/** Folds a 32-bit integer into the hash (little-endian byte order). */
export function fnvU32(hash: number, value: number): number {
  let h = hash;
  for (let i = 0; i < 4; i++) h = fnvByte(h, (value >>> (8 * i)) & 0xff);
  return h;
}

/** Folds a string's UTF-16 code units into the hash, low byte first. */
export function fnvString(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = fnvByte(fnvByte(h, c & 0xff), c >>> 8);
  }
  return h;
}

/** The FNV-1a hash of a string on its own. */
export function hashString(text: string): number {
  return fnvString(FNV_OFFSET, text);
}

/** A hash as 8 lowercase hex digits. */
export function hashHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}
