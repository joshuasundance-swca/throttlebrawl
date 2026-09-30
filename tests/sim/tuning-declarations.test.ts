/// <reference types="vite/client" />
// tuning-1 acceptance (unit tier): every declaration's default lies inside its range, over every
// module's declarations (the sim's arrive aggregated through sim/api). The registry also refuses a
// bad declaration at boot, so the browser race would fail too. The list includes declarations app/
// does not hand the registry yet (the barks), so a bad one is caught before it is wired.
import { describe, expect, it } from 'vitest';
import { AUDIO_TUNING } from '../../src/audio';
import { CAMERA_TUNING } from '../../src/camera';
import { SIM_TUNING, type TuningParamDecl } from '../../src/sim/api';
import { createTuningRegistry, TUNING_OWN } from '../../src/tuning';
import { BARK_TUNING } from '../../src/ui/narrative';
import { PANEL_GROUP_ORDER, placeOf } from '../../src/ui/tuning/model';

const ALL: readonly TuningParamDecl[] = [
  ...SIM_TUNING,
  ...CAMERA_TUNING,
  ...AUDIO_TUNING,
  ...BARK_TUNING,
  ...TUNING_OWN,
];

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
});
