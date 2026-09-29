// Fixture roads for tests in any lane (riders, traffic, tumble...): a chain of edges, each a
// constant-curvature arc, joined end to end by pass-through junctions, in the baked format.
// Built with core/math so it may live in src/road under the determinism rules.
import { cos, sin, type LaneInfo } from '../core';
import type { BakedNetworkBundle, BakedRoad } from './types';

export const FIXTURE_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.15, widthM: 1.5, direction: 1, kind: 'shoulder' },
];

export interface FixtureEdgeSpec {
  id: string;
  lengthM: number;
  /** Constant curvature, 1/m, positive = right turn. */
  kappa: number;
  /** Constant grade (rise over run). */
  grade?: number;
}

/** A network of arcs joined end to end, starting at the origin heading north. */
export function fixtureNetwork(specs: readonly FixtureEdgeSpec[], id = 'fixture'): BakedNetworkBundle {
  let x = 0;
  let y = 0;
  let z = 0;
  let heading = 0;
  const roads: BakedRoad[] = specs.map((spec, n) => {
    const intervals = Math.max(1, Math.round(spec.lengthM / 2));
    const spacing = spec.lengthM / intervals;
    const grade = spec.grade ?? 0;
    const data = { x: [x], y: [y], z: [z], kappa: [spec.kappa], grade: [grade], bankRad: [0] };
    const sub = 8;
    const h = spacing / sub;
    for (let i = 1; i <= intervals; i++) {
      for (let j = 0; j < sub; j++) {
        const mid = heading + (spec.kappa * h) / 2;
        x += sin(mid) * h;
        z -= cos(mid) * h;
        heading += spec.kappa * h;
      }
      y += grade * spacing;
      data.x.push(x);
      data.y.push(y);
      data.z.push(z);
      data.kappa.push(spec.kappa);
      data.grade.push(grade);
      data.bankRad.push(0);
    }
    return {
      id: spec.id,
      from: `j${n}`,
      to: `j${n + 1}`,
      lengthM: spec.lengthM,
      sampleSpacingM: spacing,
      laneSections: [{ s0: 0, lanes: FIXTURE_LANES }],
      samples: { encoding: 'json-columns', columns: Object.keys(data), data },
    };
  });
  const junctions = specs.map((_s, n) => ({ n })).concat([{ n: specs.length }]);
  return {
    network: {
      id,
      roads: specs.map((s) => s.id),
      junctions: junctions.map(({ n }) => {
        const prev = specs[n - 1];
        const next = specs[n];
        return {
          id: `j${n}`,
          x: 0,
          y: 0,
          z: 0,
          ends: [
            ...(prev ? [{ road: prev.id, end: 'to' as const }] : []),
            ...(next ? [{ road: next.id, end: 'from' as const }] : []),
          ],
          connectors: [],
        };
      }),
    },
    roads,
  };
}
