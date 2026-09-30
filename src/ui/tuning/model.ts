// The tuning panel's layout, as plain data (so it is testable without a DOM): one control per
// declaration, grouped. The decided groups come first (hit-stop, knockback, steering, shake), then
// speed, traffic density and the frame-rate cap, then any other group a module declares. A planned
// group with no declaration yet stays on the panel as a placeholder, so a missing slider shows.
import type { TuningParamDecl } from '../../sim/api';
import { FRAME_DIVISOR_ID } from '../../tuning';

/** Group ids a module's declaration uses to land in a planned place on the panel. */
export const PANEL_GROUP_ORDER = [
  'hit-stop',
  'knockback',
  'steering',
  'shake',
  'speed',
  'traffic',
  'frame-rate',
] as const;

const TITLES: Readonly<Record<string, string>> = {
  'hit-stop': 'Hit-stop',
  knockback: 'Knockback',
  steering: 'Steering',
  shake: 'Shake',
  speed: 'Speed',
  traffic: 'Traffic density',
  'frame-rate': 'Frame-rate cap',
};

export interface PanelControl {
  kind: 'slider' | 'frame-cap';
  decl: TuningParamDecl;
}

export interface PanelGroup {
  group: string;
  title: string;
  controls: PanelControl[];
  /** A planned group that no module declares yet. */
  empty: boolean;
}

function titleOf(group: string): string {
  return TITLES[group] ?? group.charAt(0).toUpperCase() + group.slice(1).replace(/-/g, ' ');
}

/**
 * Where a declaration sits on the panel: its own group when that is a planned one; otherwise a
 * planned group its id names (modules group by system, so `combat.hitStopScale` in group `combat`
 * still lands under Hit-stop); otherwise its own group, after the planned ones.
 */
const BY_ID: readonly (readonly [RegExp, string])[] = [
  [/hitstop/i, 'hit-stop'],
  [/knockback/i, 'knockback'],
  [/steer/i, 'steering'],
  [/shake/i, 'shake'],
  [/^traffic\./, 'traffic'],
];

export function placeOf(d: TuningParamDecl): string {
  if ((PANEL_GROUP_ORDER as readonly string[]).includes(d.group)) return d.group;
  return BY_ID.find(([re]) => re.test(d.id))?.[1] ?? d.group;
}

export function panelGroups(decls: readonly TuningParamDecl[]): PanelGroup[] {
  const byGroup = new Map<string, PanelControl[]>();
  for (const d of decls) {
    const place = placeOf(d);
    const list = byGroup.get(place) ?? [];
    list.push({ kind: d.id === FRAME_DIVISOR_ID ? 'frame-cap' : 'slider', decl: d });
    byGroup.set(place, list);
  }
  const planned: readonly string[] = PANEL_GROUP_ORDER;
  const others = [...byGroup.keys()].filter((g) => !planned.includes(g)).sort();
  return [...planned, ...others].map((group) => {
    const controls = byGroup.get(group) ?? [];
    return { group, title: titleOf(group), controls, empty: controls.length === 0 };
  });
}

function decimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** The value as the panel shows it: to the step's precision, with the unit. */
export function formatValue(d: TuningParamDecl, value: number): string {
  const text = value.toFixed(decimals(d.step));
  if (!d.unit) return text;
  return d.unit === '×' || d.unit === '%' ? `${text}${d.unit}` : `${text} ${d.unit}`;
}
