import { describe, expect, it } from 'vitest';
import { loadBasePack, lookup } from '../content';
import type { EntitySnapshot, LayoutElement, SimSnapshot } from '../sim/api';
import {
  buildIdFromStamp,
  formatSpeed,
  healthFraction,
  ordinal,
  resultText,
  riderCount,
  targetOf,
} from './format';
import { HUD_ELEMENTS, hudStyle } from './placement';
import { applySettingsChange } from './settings';
import { DEFAULT_SETTINGS } from '../save';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    lean: 0,
    contentId: `r${id}`,
    name: `Rider ${id}`,
    faction: 'rider',
    slot: -1,
    throttle: 0,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 0,
    place: 1,
    finished: false,
    ...over,
  };
}

function snap(entities: EntitySnapshot[]): SimSnapshot {
  return { tick: 1, timeScale: 1, entities, race: { over: false, routeLength: 100, finishOrder: [] } };
}

describe('ui formatting', () => {
  it('writes ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });

  it('shows speed in the chosen units, rounded, never negative or NaN', () => {
    expect(formatSpeed(38, 'mph')).toBe('85 mph');
    expect(formatSpeed(38, 'kmh')).toBe('137 km/h');
    expect(formatSpeed(-1, 'mph')).toBe('0 mph');
    expect(formatSpeed(Number.NaN, 'kmh')).toBe('0 km/h');
  });

  it('turns health into a 0..1 fraction that survives bad numbers', () => {
    expect(healthFraction(50, 100)).toBe(0.5);
    expect(healthFraction(150, 100)).toBe(1);
    expect(healthFraction(-5, 100)).toBe(0);
    expect(healthFraction(10, 0)).toBe(0);
    expect(healthFraction(Number.NaN, 100)).toBe(0);
  });

  it('writes the results: a placing and the prize, or Busted and the fine', () => {
    const win = resultText({ place: 1, of: 5, prizeCash: 1500, eventName: 'Causeway Sprint' });
    expect(win.headline).toBe('1st of 5');
    expect(win.headline).toMatch(/^\d+(st|nd|rd|th) of \d+$/); // dev-1's bot race reads this
    expect(win.detail).toContain('$1,500');
    expect(win.detail).toContain('Causeway Sprint');
    const bust = resultText({ place: 0, of: 5, prizeCash: 0, eventName: 'X', busted: true, fineCash: 400 });
    expect(bust.headline).toBe('Busted');
    expect(bust.detail).toContain('Fine: $400');
    expect(bust.busted).toBe(true);
  });

  it('reads the build id from the stamp', () => {
    expect(buildIdFromStamp('throttlebrawl · staging · lane/ui/screens · abc1234')).toBe('abc1234');
    expect(buildIdFromStamp('')).toBe('');
  });

  it('counts only riders, and finds the player target only when it is another rider', () => {
    const s = snap([rider(0), rider(1, { targetId: 0 }), rider(2, { kind: 'vehicle' })]);
    expect(riderCount(s)).toBe(2);
    // The law chases but never races, so "1st / N" leaves him out.
    expect(riderCount(snap([rider(0), rider(1), rider(2, { faction: 'law' })]))).toBe(2);
    const me = s.entities[1] ?? null;
    expect(targetOf(s, me)?.id).toBe(0);
    expect(targetOf(s, rider(1, { targetId: -1 }))).toBeNull();
    expect(targetOf(s, rider(1, { targetId: 1 }))).toBeNull(); // never yourself
    expect(targetOf(s, rider(1, { targetId: 2 }))).toBeNull(); // a vehicle has no health bar
    expect(targetOf(s, rider(1, { targetId: 9 }))).toBeNull();
  });
});

describe('HUD placement from the layout record', () => {
  const base: LayoutElement = {
    element: 'speedometer',
    visible: true,
    anchor: 'bottom-left',
    offset: [0.03, 0.04],
    scale: 1,
    opacity: 1,
  };

  it('measures offsets inward from the anchor, in fractions of the short side', () => {
    const s = hudStyle(base, 400, false);
    expect(s.left).toBe('12px');
    expect(s.bottom).toBe('16px');
    expect(s.right).toBe('');
    expect(s.top).toBe('');
    expect(s.transformOrigin).toBe('left bottom');
  });

  it('mirrors left and right for the left-handed option', () => {
    const s = hudStyle({ ...base, anchor: 'top-right', offset: [0.05, 0.02] }, 400, true);
    expect(s.left).toBe('20px');
    expect(s.top).toBe('8px');
    expect(s.right).toBe('');
    const plain = hudStyle({ ...base, anchor: 'top-right', offset: [0.05, 0.02] }, 400, false);
    expect(plain.right).toBe('20px');
  });

  it('centres on the centre axes and applies scale and opacity', () => {
    const s = hudStyle(
      { ...base, anchor: 'top-center', offset: [0.1, 0.05], scale: 1.5, opacity: 0.5 },
      400,
      false,
    );
    expect(s.left).toBe('50%');
    expect(s.top).toBe('20px');
    expect(s.transform).toBe('translate(calc(-50% + 40px), 0px) scale(1.5)');
    expect(s.opacity).toBe('0.5');
    const c = hudStyle({ ...base, anchor: 'center', offset: [0, 0] }, 400, false);
    expect(c.top).toBe('50%');
    expect(c.transform).toBe('translate(calc(-50% + 0px), calc(-50% + 0px)) scale(1)');
  });

  it('the shipped classic layout uses only known elements and has every M1 HUD piece', () => {
    const registry = loadBasePack({ includeDrafts: true });
    const classic = lookup(registry.hudLayouts, 'classic');
    const names = classic.elements.map((e) => e.element);
    for (const n of names) expect(HUD_ELEMENTS as readonly string[]).toContain(n);
    for (const needed of [
      'speedometer',
      'position',
      'health-self',
      'health-target',
      'touch-attack',
      'touch-brake',
      'touch-stick-zone',
    ]) {
      expect(names).toContain(needed);
    }
  });
});

describe('settings changes', () => {
  it('sets one volume, clamped to 0..1, without touching the others', () => {
    const s = applySettingsChange(DEFAULT_SETTINGS, { kind: 'volume', bus: 'master', value: 1.7 });
    expect(s.volumes.master).toBe(1);
    expect(s.volumes.music).toBe(DEFAULT_SETTINGS.volumes.music);
    expect(DEFAULT_SETTINGS.volumes.master).toBe(0.8); // the input is never mutated
    expect(applySettingsChange(s, { kind: 'volume', bus: 'voices', value: Number.NaN }).volumes.voices).toBe(
      0,
    );
  });

  it('toggles mute and the mirror', () => {
    const s = applySettingsChange(DEFAULT_SETTINGS, { kind: 'mute', value: true });
    expect(s.mute).toBe(true);
    expect(applySettingsChange(s, { kind: 'mirror', value: true }).mirror).toBe(true);
    expect(applySettingsChange(s, { kind: 'mirror', value: true }).mute).toBe(true);
  });
});
