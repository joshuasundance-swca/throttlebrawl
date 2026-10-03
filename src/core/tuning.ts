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
  /**
   * True on the switch (or scale) of an optional WORLD SYSTEM: something a race brings around the
   * riders, such as traffic, animals, road events, the patrol, the heat meter, the ground beside the
   * road or the roadside weapons. A seeded test of one behaviour turns these off, so a new or
   * retuned system cannot reshuffle its races (tests/sim/batch.ts `ISOLATED`, which must name every
   * one; a guard test fails when one is missing). Neither the sim nor the panel reads it. Absent
   * means false. [default] (the determinism run, 2026-10-03)
   */
  readonly system?: boolean;
}

export type TuningValues = Readonly<Record<string, number>>;

/** The default value of every declaration, by id. */
export function tuningDefaults(decls: readonly TuningParamDecl[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decls) out[d.id] = d.default;
  return out;
}
