// The settings record's control fields (save-2) as input's control options (input-2): the
// steering method, tilt sensitivity, auto-throttle (`throttle: 'auto'`), pull-back brake, haptics
// and the gamepad remaps. Presentation-side: they shape which SimInput is produced, and the
// inputs are what a replay records.
import type { ControlOptions } from '../input';
import type { Settings } from '../save';

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
