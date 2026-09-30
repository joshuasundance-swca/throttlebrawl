// The settings' control fields reach input's options; each setting has a non-default test
// (docs/milestones/M2.md, "Cross-lane rules for M2").
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROL_OPTIONS } from '../input';
import { DEFAULT_SETTINGS } from '../save';
import { controlOptionsOf, liveControlSettings } from './controls';

describe('app: which control settings are live (the input-2 rows show, playtest 1b run)', () => {
  it('a phone that can vibrate gets all five control settings', () => {
    expect(liveControlSettings({ vibrate: true, tilt: true })).toEqual([
      'steering',
      'tiltSensitivity',
      'throttle',
      'pullBackBrake',
      'haptics',
    ]);
  });

  it('vibration stays hidden where the browser cannot vibrate (M2 input-2)', () => {
    expect(liveControlSettings({ vibrate: false, tilt: true })).not.toContain('haptics');
  });

  it('tilt steering and its sensitivity stay hidden where tilt cannot work', () => {
    expect(liveControlSettings({ vibrate: true, tilt: false })).toEqual([
      'throttle',
      'pullBackBrake',
      'haptics',
    ]);
  });

  it('every live control setting is a field of the settings record', () => {
    const got = liveControlSettings({ vibrate: true, tilt: true });
    expect(got.every((id) => id in DEFAULT_SETTINGS)).toBe(true);
  });
});

describe('app: settings to input control options', () => {
  it('the default settings give input its default options', () => {
    expect(controlOptionsOf(DEFAULT_SETTINGS)).toEqual(DEFAULT_CONTROL_OPTIONS);
  });

  it('every non-default control setting changes its option', () => {
    const got = controlOptionsOf({
      ...DEFAULT_SETTINGS,
      steering: 'both',
      tiltSensitivity: 2,
      throttle: 'auto',
      pullBackBrake: true,
      haptics: false,
      gamepadBindings: { kick: ['button4'] },
    });
    expect(got).toEqual({
      steering: 'both',
      tiltSensitivity: 2,
      autoThrottle: true,
      pullBackBrake: true,
      haptics: false,
      padBindings: { kick: ['button4'] },
    });
    for (const key of Object.keys(DEFAULT_CONTROL_OPTIONS) as (keyof typeof got)[])
      expect(got[key], key).not.toEqual(DEFAULT_CONTROL_OPTIONS[key]);
  });
});
