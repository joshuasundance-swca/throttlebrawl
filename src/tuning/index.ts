// tuning: the parameter registry and presets (docs/architecture.md, "Tuning"). Declarations live
// beside the systems they tune; app/ gathers them and hands the list here. A sim-affecting change
// goes out through the injected recordTuningChange (app applies it with sim.applyParam between
// steps and records it at that tick); a presentation change applies at once. tuning-1 owns this.
import { tuningDefaults, type RecordTuningChange, type TuningParamDecl } from '../core';

export type TuningListener = (id: string, value: number) => void;

export interface TuningRegistry {
  readonly decls: readonly TuningParamDecl[];
  get(id: string): number;
  /** Sets a value (clamped to its range). Returns the value stored. */
  set(id: string, value: number): number;
  values(): Readonly<Record<string, number>>;
  /** Only the sim-affecting values, for SimConfig at race start. */
  simValues(): Readonly<Record<string, number>>;
  onChange(listener: TuningListener): () => void;
}

export function createTuningRegistry(
  decls: readonly TuningParamDecl[],
  recordTuningChange: RecordTuningChange,
): TuningRegistry {
  const byId = new Map<string, TuningParamDecl>();
  for (const d of decls) {
    if (byId.has(d.id)) throw new Error(`tuning: ${d.id} is declared twice`);
    if (d.default < d.min || d.default > d.max) throw new Error(`tuning: ${d.id} default is out of range`);
    byId.set(d.id, d);
  }
  const values = tuningDefaults(decls);
  const listeners = new Set<TuningListener>();
  const declOf = (id: string): TuningParamDecl => {
    const d = byId.get(id);
    if (!d) throw new Error(`tuning: unknown parameter ${id}`);
    return d;
  };
  return {
    decls,
    get: (id) => values[declOf(id).id] ?? 0,
    set(id, value) {
      const d = declOf(id);
      const v = Math.min(d.max, Math.max(d.min, value));
      if (values[id] === v) return v;
      values[id] = v;
      if (d.affectsSim) recordTuningChange(id, v);
      for (const l of listeners) l(id, v);
      return v;
    },
    values: () => ({ ...values }),
    simValues() {
      const out: Record<string, number> = {};
      for (const d of decls) if (d.affectsSim) out[d.id] = values[d.id] ?? d.default;
      return out;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
