// Tuning presets (docs/content-packs.md, "Tuning presets"; docs/architecture.md, "Tuning"). A
// preset is a `tuning-preset` entry: `base` names the preset it builds on (the reserved id
// `registry` means the registry's own defaults) and `values` sets parameters by id. "Copy preset
// as JSON" gives an entry an agent commits under packs/base/tuning/; the device keeps one user
// preset as a versioned record (M1 ships the version field; migrations arrive in M4).
import { checkHeader, wrapRecord, type TuningParamDecl } from '../core';

export const REGISTRY_PRESET_ID = 'registry';
export const TUNING_PRESET_RECORD = 'tuning-preset';
export const TUNING_PRESET_RECORD_VERSION = 1;

/** A `tuning-preset` pack entry, as the panel exports it. */
export interface TuningPresetFile {
  type: 'tuning-preset';
  id: string;
  name: string;
  base: string;
  values: Record<string, number>;
  meta: {
    status: 'live';
    notes: string;
    provenance: { origin: 'human'; author: string; createdAt: string };
  };
}

/** What resolution needs from a preset: the content registry's entries fit this shape. */
export interface PresetLike {
  readonly id: string;
  readonly base: string;
  readonly values: Readonly<Record<string, number>>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A kebab-case id from the export time (UTC): `playtest-20260930-0102`. */
export function presetIdFor(now: Date): string {
  const d = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  return `playtest-${d}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

/** The pack entry for a set of values that differ from the registry defaults. */
export function exportPreset(
  changed: Readonly<Record<string, number>>,
  opts: { now: Date; build: string },
): TuningPresetFile {
  const { now } = opts;
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const values: Record<string, number> = {};
  for (const id of Object.keys(changed).sort()) {
    const v = changed[id];
    if (v !== undefined) values[id] = v;
  }
  return {
    type: 'tuning-preset',
    id: presetIdFor(now),
    name: `Playtest ${date} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`,
    base: REGISTRY_PRESET_ID,
    values,
    meta: {
      status: 'live',
      notes: `Exported from the tuning panel on build ${opts.build}.`,
      // A role, never a name (the pack lint's public-safety rule): a pasted preset is the
      // maintainer's playtest, committed by an agent.
      provenance: { origin: 'human', author: 'maintainer', createdAt: date },
    },
  };
}

/**
 * The tuning-key lint (docs/content-packs.md, "Validation"): every key is in the parameter
 * registry and every value is a finite number inside its range. Messages carry a JSON pointer.
 */
export function checkPresetValues(
  decls: readonly TuningParamDecl[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  const byId = new Map(decls.map((d) => [d.id, d]));
  const errors: string[] = [];
  for (const [id, v] of Object.entries(values)) {
    const d = byId.get(id);
    if (!d) errors.push(`/values/${id}: not in the parameter registry`);
    else if (typeof v !== 'number' || !Number.isFinite(v))
      errors.push(`/values/${id}: expected a finite number`);
    else if (v < d.min || v > d.max) errors.push(`/values/${id}: expected ${d.min}..${d.max}, got ${v}`);
  }
  return errors;
}

/**
 * The values a preset sets, its bases first: `registry` sets nothing. `lookup` finds a preset by
 * id (bare or `pack:id`); a missing preset or a cycle of bases throws.
 */
export function resolvePreset(
  lookup: (id: string) => PresetLike | undefined,
  id: string,
): Record<string, number> {
  const chain: PresetLike[] = [];
  const seen = new Set<string>();
  let at = id;
  while (at !== REGISTRY_PRESET_ID) {
    const p = lookup(at);
    if (!p) throw new Error(`tuning: no tuning preset ${at}`);
    if (seen.has(p.id)) throw new Error(`tuning: preset ${id} has a cycle of bases through ${p.id}`);
    seen.add(p.id);
    chain.push(p);
    at = p.base;
  }
  const out: Record<string, number> = {};
  for (const p of chain.reverse()) Object.assign(out, p.values);
  return out;
}

/** The subset of the Web Storage API the store uses. */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A Map-backed storage, for tests and as the no-storage fallback. */
export function createMemoryStorage(): PresetStorage & { removeItem(key: string): void } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

export interface PresetStore {
  /** The device's saved preset, or null when there is none (or it cannot be read). */
  load(): TuningPresetFile | null;
  /** Saves over the last one. False when storage is unavailable or holds a newer record. */
  save(preset: TuningPresetFile): boolean;
  /** False once storage has failed: saves then do not survive a reload. */
  readonly persistent: boolean;
  /** A plain-words reason when the last load or save could not use the device. */
  readonly notice: string | null;
}

export interface PresetStoreOptions {
  storage: PresetStorage | null;
  /** Name-neutral key prefix: platform's app id, handed in by app/. */
  keyPrefix: string;
  build: string;
  now?: () => string;
}

function isPresetFile(x: unknown): x is TuningPresetFile {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  const values = p['values'];
  return (
    p['type'] === 'tuning-preset' &&
    typeof p['id'] === 'string' &&
    typeof p['base'] === 'string' &&
    typeof values === 'object' &&
    values !== null &&
    Object.values(values).every((v) => typeof v === 'number')
  );
}

export function createPresetStore(opts: PresetStoreOptions): PresetStore {
  const key = `${opts.keyPrefix}:${TUNING_PRESET_RECORD}`;
  const now = opts.now ?? (() => new Date().toISOString());
  let usable = opts.storage !== null;
  let notice: string | null = usable ? null : 'Presets will not be saved on this device.';
  let newerKept = false;

  const read = (): string | null => {
    if (!usable || !opts.storage) return null;
    try {
      return opts.storage.getItem(key);
    } catch {
      usable = false;
      notice = 'Presets will not be saved on this device.';
      return null;
    }
  };

  return {
    get persistent() {
      return usable;
    },
    get notice() {
      return notice;
    },
    load() {
      const text = read();
      if (text === null) return null;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return null;
      }
      const head = checkHeader(raw, TUNING_PRESET_RECORD, TUNING_PRESET_RECORD_VERSION);
      if (head.kind === 'newer') {
        newerKept = true;
        notice = 'The saved preset is from a newer build; it is kept, not loaded.';
        return null;
      }
      if (head.kind !== 'ok') return null;
      const data = (raw as { data: unknown }).data;
      return isPresetFile(data) ? data : null;
    },
    save(preset) {
      if (!usable || !opts.storage) return false;
      // Never overwrite a record newer than this build understands.
      if (!newerKept) {
        const text = read();
        if (text !== null) {
          try {
            const head = checkHeader(JSON.parse(text), TUNING_PRESET_RECORD, TUNING_PRESET_RECORD_VERSION);
            if (head.kind === 'newer') newerKept = true;
          } catch {
            // A broken record is replaced.
          }
        }
      }
      if (newerKept) {
        notice = 'The saved preset is from a newer build; it is kept, not overwritten.';
        return false;
      }
      try {
        const record = wrapRecord(
          TUNING_PRESET_RECORD,
          TUNING_PRESET_RECORD_VERSION,
          opts.build,
          preset,
          now(),
        );
        opts.storage.setItem(key, JSON.stringify(record));
        return true;
      } catch {
        usable = false;
        notice = 'Presets will not be saved on this device.';
        return false;
      }
    },
  };
}
