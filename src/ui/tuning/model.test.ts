import { describe, expect, it } from 'vitest';
import type { TuningParamDecl } from '../../sim/api';
import { FRAME_DIVISOR_ID, TUNING_OWN } from '../../tuning';
import { formatValue, panelGroups, PANEL_GROUP_ORDER } from './model';

const decl = (id: string, group: string, over: Partial<TuningParamDecl> = {}): TuningParamDecl => ({
  id,
  group,
  label: id,
  default: 1,
  min: 0,
  max: 2,
  step: 0.05,
  unit: '×',
  affectsSim: false,
  ...over,
});

describe('tuning panel model', () => {
  const decls = [
    decl('camera.chaseDistanceM', 'camera', { unit: 'm', step: 0.25 }),
    decl('riders.steerScale', 'steering'),
    decl('combat.knockbackScale', 'knockback'),
    decl('audio.engineMix', 'audio'),
    ...TUNING_OWN,
  ];

  it('shows one control per declaration, each exactly once', () => {
    const ids = panelGroups(decls).flatMap((g) => g.controls.map((c) => c.decl.id));
    expect(ids.sort()).toEqual(decls.map((d) => d.id).sort());
  });

  it('places a declaration in a planned group by its group, or by its id when its module groups differently', () => {
    const real = [
      decl('combat.hitStopScale', 'combat'),
      decl('combat.knockbackScale', 'combat'),
      decl('camera.shakeScale', 'camera'),
      decl('traffic.oncomingDensityScale', 'traffic-density'),
      decl('riders.speedScale', 'speed'),
      decl('riders.crashImpactMps', 'crashes'),
      decl('camera.chaseDistanceM', 'camera'),
    ];
    const where = Object.fromEntries(
      panelGroups(real).flatMap((g) => g.controls.map((c) => [c.decl.id, g.group] as const)),
    );
    expect(where).toEqual({
      'combat.hitStopScale': 'hit-stop',
      'combat.knockbackScale': 'knockback',
      'camera.shakeScale': 'shake',
      'traffic.oncomingDensityScale': 'traffic',
      'riders.speedScale': 'speed',
      'riders.crashImpactMps': 'crashes',
      'camera.chaseDistanceM': 'camera',
    });
    expect(panelGroups(real).find((g) => g.group === 'combat')).toBeUndefined();
  });

  it('orders the decided groups first, then speed, traffic and the frame-rate cap, then the rest', () => {
    const groups = panelGroups(decls).map((g) => g.group);
    expect(groups).toEqual([...PANEL_GROUP_ORDER, 'audio', 'camera']);
    expect(PANEL_GROUP_ORDER.slice(0, 4)).toEqual(['hit-stop', 'knockback', 'steering', 'shake']);
  });

  it('keeps an empty planned group as a visible placeholder, so a missing slider is obvious', () => {
    const hitStop = panelGroups(decls).find((g) => g.group === 'hit-stop');
    expect(hitStop).toMatchObject({ title: 'Hit-stop', controls: [], empty: true });
  });

  it('draws the frame-rate cap as a choice of divisors, everything else as a slider', () => {
    const controls = panelGroups(decls).flatMap((g) => g.controls);
    expect(controls.find((c) => c.decl.id === FRAME_DIVISOR_ID)?.kind).toBe('frame-cap');
    expect(controls.filter((c) => c.kind === 'slider')).toHaveLength(decls.length - 1);
  });

  it('formats values to the step, with the unit', () => {
    expect(formatValue(decl('a.b', 'x', { step: 0.05 }), 1.2)).toBe('1.20×');
    expect(formatValue(decl('a.b', 'x', { step: 0.25, unit: 'm' }), 6.5)).toBe('6.50 m');
    expect(formatValue(decl('a.b', 'x', { step: 1, unit: '' }), 3)).toBe('3');
    expect(formatValue(decl('a.b', 'x', { step: 10, unit: 'ms' }), 60)).toBe('60 ms');
  });
});
