// Tuning declarations (docs/architecture.md, "Tuning"). Each module exports the declarations for
// the systems it owns as plain data typed here; app/ gathers them (the sim's arrive aggregated
// through src/sim/api.ts) and hands the combined list to tuning/.

export interface TuningParamDecl {
  /** Dotted id, grouped by system: `riders.steerScale`, `camera.chaseDistanceM`. */
  readonly id: string;
  /** Panel group, such as `steering`, `speed`, `camera`. */
  readonly group: string;
  /** Short label for the panel. */
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Display unit, or '' for a unitless scale. */
  readonly unit: string;
  /** True when the value changes outcomes: it then goes through SimConfig and sim.applyParam. */
  readonly affectsSim: boolean;
}

export type TuningValues = Readonly<Record<string, number>>;

/** The default value of every declaration, by id. */
export function tuningDefaults(decls: readonly TuningParamDecl[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decls) out[d.id] = d.default;
  return out;
}
