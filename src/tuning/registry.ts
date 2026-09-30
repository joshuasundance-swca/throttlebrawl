// The parameter registry (docs/architecture.md, "Tuning"). Declarations live beside the systems
// they tune; app/ gathers them and hands the list here, and the registry adds tuning's own (the
// frame-rate cap). A sim-affecting change goes out through the injected recordTuningChange (app/
// applies it with sim.applyParam between steps and records it at that tick); a presentation change
// reaches listeners at once and is not recorded.
import { tuningDefaults, type RecordTuningChange, type TuningParamDecl } from '../core';
import { FRAME_CAP_TUNING } from './frame-cap';
import { exportPreset, type PresetStore, type TuningPresetFile } from './presets';

/** The declarations tuning/ owns itself; the registry always includes them. */
export const TUNING_OWN: readonly TuningParamDecl[] = FRAME_CAP_TUNING;

export type TuningListener = (id: string, value: number) => void;

export interface TuningRegistry {
  readonly decls: readonly TuningParamDecl[];
  decl(id: string): TuningParamDecl | undefined;
  get(id: string): number;
  /** Sets a value (clamped to its range; a non-number is ignored). Returns the value stored. */
  set(id: string, value: number): number;
  values(): Readonly<Record<string, number>>;
  /** Only the sim-affecting values, for SimConfig at race start. */
  simValues(): Readonly<Record<string, number>>;
  /** The values that differ from the declared defaults (what a preset exports). */
  changed(): Readonly<Record<string, number>>;
  /**
   * Makes a preset's values current: every parameter back to its declared default, then the
   * preset's values on top (through set, so sim changes are recorded). Returns the ids it skipped
   * because no module declares them.
   */
  applyPreset(values: Readonly<Record<string, number>>): string[];
  /** Back to the shipped preset (the pack's default, or the registry defaults). */
  reset(): void;
  /** The current values as a `tuning-preset` pack entry. */
  exportPreset(now: Date): TuningPresetFile;
  /** Whether a device store was handed in. */
  readonly canSaveToDevice: boolean;
  /** Saves the current values as the device's preset. False when that did not happen. */
  saveToDevice(now: Date): boolean;
  /** The device store's plain-words notice, if any. */
  readonly storeNotice: string | null;
  onChange(listener: TuningListener): () => void;
}

export interface TuningRegistryOptions {
  /** The device's preset store; without one, "Save preset" says it cannot save. */
  store?: PresetStore;
  /** The shipped default preset's resolved values (pack.json `defaults.tuning`). */
  shippedPreset?: Readonly<Record<string, number>>;
  /** The build id, written into exported presets. */
  build?: string;
}

function checkDecl(d: TuningParamDecl): void {
  if (![d.default, d.min, d.max, d.step].every(Number.isFinite))
    throw new Error(`tuning: ${d.id} has a non-number`);
  if (!(d.min < d.max)) throw new Error(`tuning: ${d.id} min must be below max`);
  if (!(d.step > 0)) throw new Error(`tuning: ${d.id} step must be positive`);
  if (d.default < d.min || d.default > d.max) throw new Error(`tuning: ${d.id} default is out of range`);
}

export function createTuningRegistry(
  declared: readonly TuningParamDecl[],
  recordTuningChange: RecordTuningChange,
  options: TuningRegistryOptions = {},
): TuningRegistry {
  const byId = new Map<string, TuningParamDecl>();
  for (const d of declared) {
    if (byId.has(d.id)) throw new Error(`tuning: ${d.id} is declared twice`);
    checkDecl(d);
    byId.set(d.id, d);
  }
  const decls = [...declared, ...TUNING_OWN.filter((d) => !byId.has(d.id))];
  for (const d of TUNING_OWN) byId.set(d.id, byId.get(d.id) ?? d);

  const values = tuningDefaults(decls);
  const listeners = new Set<TuningListener>();
  const shipped = options.shippedPreset ?? {};
  const store = options.store ?? null;
  const build = options.build ?? 'dev';
  let booting = true;

  const declOf = (id: string): TuningParamDecl => {
    const d = byId.get(id);
    if (!d) throw new Error(`tuning: unknown parameter ${id}`);
    return d;
  };

  const registry: TuningRegistry = {
    decls,
    decl: (id) => byId.get(id),
    get: (id) => values[declOf(id).id] ?? 0,
    set(id, value) {
      const d = declOf(id);
      const current = values[id] ?? d.default;
      if (typeof value !== 'number' || !Number.isFinite(value)) return current;
      const v = Math.min(d.max, Math.max(d.min, value));
      if (current === v) return v;
      values[id] = v;
      // At boot no race exists and the caller's closure may not be initialised yet: the boot
      // values reach the sim through simValues() in SimConfig instead.
      if (d.affectsSim && !booting) recordTuningChange(id, v);
      for (const l of listeners) l(id, v);
      return v;
    },
    values: () => ({ ...values }),
    simValues() {
      const out: Record<string, number> = {};
      for (const d of decls) if (d.affectsSim) out[d.id] = values[d.id] ?? d.default;
      return out;
    },
    changed() {
      const out: Record<string, number> = {};
      for (const d of decls) {
        const v = values[d.id];
        if (v !== undefined && v !== d.default) out[d.id] = v;
      }
      return out;
    },
    applyPreset(preset) {
      const skipped = Object.keys(preset).filter((id) => !byId.has(id));
      for (const d of decls) registry.set(d.id, preset[d.id] ?? d.default);
      return skipped;
    },
    reset() {
      registry.applyPreset(shipped);
    },
    exportPreset: (now) => exportPreset(registry.changed(), { now, build }),
    canSaveToDevice: store !== null,
    saveToDevice(now) {
      return store ? store.save(registry.exportPreset(now)) : false;
    },
    get storeNotice() {
      return store?.notice ?? null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // Boot: the shipped preset, then the device's own preset (a full state) when one is saved.
  registry.applyPreset(shipped);
  const saved = store?.load() ?? null;
  if (saved) registry.applyPreset(saved.values);
  booting = false;
  return registry;
}
