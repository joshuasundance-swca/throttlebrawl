import { describe, expect, it } from 'vitest';
import { ALL_TUNING } from '../../tools/packs/tuning';
import { createTuningRegistry } from '../tuning';
import { APP_TUNING, isRaceStartParam, isReadDirect, presentationOwner } from './tuning';

describe('app/tuning: presentationOwner', () => {
  it('routes every presentation-only value to the module that declares it', () => {
    const unrouted = APP_TUNING.filter(
      (d) =>
        !d.affectsSim && !isRaceStartParam(d.id) && !isReadDirect(d.id) && presentationOwner(d.id) === null,
    );
    expect(unrouted.map((d) => d.id)).toEqual([]);
  });

  it('keeps the race-start values (the difficulty scales) away from the sim and presentation', () => {
    const raceStart = APP_TUNING.filter((d) => isRaceStartParam(d.id));
    expect(raceStart).toHaveLength(9);
    expect(raceStart.filter((d) => d.affectsSim || presentationOwner(d.id) !== null)).toEqual([]);
  });

  it('never routes a sim value or the frame cap', () => {
    const routed = APP_TUNING.filter((d) => d.affectsSim && presentationOwner(d.id) !== null);
    expect(routed.map((d) => d.id)).toEqual([]);
    expect(presentationOwner('display.frameDivisor')).toBeNull();
    expect(presentationOwner('barks.minGapGlobalS')).toBe('barks');
    expect(presentationOwner('render.sparkCount')).toBe('render');
    expect(APP_TUNING.filter((d) => d.id.startsWith('render.')).length).toBeGreaterThan(0);
  });
});

describe('app/tuning: the collected tuning declarations', () => {
  it('declares every id once', () => {
    const ids = APP_TUNING.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reaches the panel for every module that declares parameters', () => {
    const groups = new Set(APP_TUNING.map((d) => d.id.split('.')[0]));
    for (const prefix of [
      'riders',
      'combat',
      'traffic',
      'cops',
      'tumble',
      'race',
      'ai',
      'camera',
      'audio',
      'input',
      'barks',
    ])
      expect(groups, prefix).toContain(prefix);
  });

  it("lists the style meter's two feel numbers in the tuning panel and the preset lint", () => {
    // The integration skeptic's mustFix 2 (2026-10-01): "every feel number is a slider".
    const panel = createTuningRegistry(APP_TUNING, () => undefined).decls.map((d) => d.id);
    const linted = ALL_TUNING.map((d) => d.id);
    for (const id of ['hud.meterShowAfterS', 'hud.meterLandS']) {
      expect(panel, id).toContain(id);
      expect(linted, id).toContain(id);
    }
  });

  it('gives the registry the same list packs:check lints presets against', () => {
    // The registry adds tuning/'s own declarations (the frame-rate cap) to what app/ hands it.
    const registry = createTuningRegistry(APP_TUNING, () => undefined);
    const panel = registry.decls.map((d) => d.id).sort();
    const linted = ALL_TUNING.map((d) => d.id).sort();
    expect(panel).toEqual(linted);
  });
});
