// The settings record's control fields (save-2) as input's control options (input-2): the
// steering method, tilt sensitivity, auto-throttle (`throttle: 'auto'`), pull-back brake, haptics
// and the gamepad remaps. Presentation-side: they shape which SimInput is produced, and the
// inputs are what a replay records.
import type { ControlOptions } from '../input';
import type { Settings } from '../save';
import type { SettingId } from '../ui';

export function controlOptionsOf(s: Readonly<Settings>): ControlOptions {
  return {
    steering: s.steering,
    tiltSensitivity: s.tiltSensitivity,
    autoThrottle: s.throttle === 'auto',
    pullBackBrake: s.pullBackBrake,
    haptics: s.haptics,
    padBindings: s.gamepadBindings,
  };
}

/** What this device can do, for which control settings would change anything. */
export interface ControlDevice {
  /** The browser can vibrate (input's `haptics.supported`). */
  vibrate: boolean;
  /** A touch device with motion sensors, so tilt steering can work. */
  tilt: boolean;
}

/**
 * The control settings app/ has wired to input (the settings screen's `liveSettings`, M2 ui-2):
 * throttle and pull-back brake always; the steering method and tilt sensitivity only where tilt
 * can work [default]; vibration only where the browser can vibrate (M2 input-2).
 */
export function liveControlSettings(d: Readonly<ControlDevice>): SettingId[] {
  return [
    ...(d.tilt ? (['steering', 'tiltSensitivity'] as const) : []),
    'throttle',
    'pullBackBrake',
    ...(d.vibrate ? (['haptics'] as const) : []),
  ];
}

/** The browser's answer for `liveControlSettings`. */
export function browserControlDevice(vibrate: boolean): ControlDevice {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const sensors = typeof DeviceOrientationEvent !== 'undefined' || typeof DeviceMotionEvent !== 'undefined';
  return { vibrate, tilt: coarse && sensors };
}
