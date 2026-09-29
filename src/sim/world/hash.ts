// Hashing plain sim data (docs/architecture.md, sim.hash()): numbers by their exact float64 bits,
// strings by code units, objects by sorted keys. Because every system keeps plain data, a lane's
// new state is covered without touching this file.
import { fnvByte, fnvF64, fnvString } from '../../core';

export function hashPlain(hash: number, value: unknown): number {
  if (typeof value === 'number') return fnvF64(fnvByte(hash, 1), value);
  if (typeof value === 'string') return fnvString(fnvByte(hash, 2), value);
  if (typeof value === 'boolean') return fnvByte(fnvByte(hash, 3), value ? 1 : 0);
  if (value === null || value === undefined) return fnvByte(hash, 4);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    let h = fnvByte(hash, 5);
    const items = value as unknown as ArrayLike<unknown>;
    for (let i = 0; i < items.length; i++) h = hashPlain(h, items[i]);
    return fnvByte(h, 6);
  }
  if (typeof value === 'object') {
    let h = fnvByte(hash, 7);
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) h = hashPlain(fnvString(h, key), obj[key]);
    return fnvByte(h, 8);
  }
  throw new Error(`sim state must be plain data, found ${typeof value}`);
}
