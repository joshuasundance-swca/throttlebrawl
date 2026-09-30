/// <reference types="vite/client" />
// tuning-1 acceptance (unit tier): every declaration's default lies inside its range, over every
// module's declarations. The list is the one packs:check lints presets against (tools/packs/
// tuning.ts), so the panel, the registry and the validator agree on what a preset may set: every
// declaration the registry adds itself must be in it, or a copied preset fails packs:check with
// "unknown tuning key". The registry also refuses a bad declaration at boot.
import { describe, expect, it } from 'vitest';
import { createTuningRegistry, TUNING_OWN } from '../../src/tuning';
import { PANEL_GROUP_ORDER, placeOf } from '../../src/ui/tuning/model';
import { ALL_TUNING } from '../../tools/packs/tuning';

const ALL = ALL_TUNING;

describe('tuning declarations from every module', () => {
  it('examines a nonzero number of declarations', () => {
    const places = new Set(ALL.map(placeOf));
    const present = PANEL_GROUP_ORDER.filter((g) => places.has(g));
    const waiting = PANEL_GROUP_ORDER.filter((g) => !places.has(g));
    console.log(
      `tuning declarations: ${ALL.length} (${ALL.map((d) => d.id).join(', ')}); ` +
        `planned panel groups filled: ${present.join(', ') || 'none'}; not declared yet: ${waiting.join(', ') || 'none'}`,
    );
    expect(ALL.length).toBeGreaterThan(0);
  });

  it.each(ALL.map((d) => [d.id, d] as const))('%s: default inside [min, max], a positive step', (_id, d) => {
    expect(Number.isFinite(d.min) && Number.isFinite(d.max) && Number.isFinite(d.default)).toBe(true);
    expect(d.min).toBeLessThan(d.max);
    expect(d.default).toBeGreaterThanOrEqual(d.min);
    expect(d.default).toBeLessThanOrEqual(d.max);
    expect(d.step).toBeGreaterThan(0);
    expect(d.id).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/);
    expect(d.label.trim()).not.toBe('');
    expect(d.group.trim()).not.toBe('');
  });

  it('ids are unique and the registry accepts the whole list', () => {
    expect(new Set(ALL.map((d) => d.id)).size).toBe(ALL.length);
    expect(() => createTuningRegistry(ALL, () => {})).not.toThrow();
  });

  it('the preset lint knows every declaration the registry adds itself (a copied preset can use it)', () => {
    const linted = new Set(ALL.map((d) => d.id));
    expect(TUNING_OWN.map((d) => d.id).filter((id) => !linted.has(id))).toEqual([]);
  });
});
