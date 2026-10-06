import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../save';
import { motionAmounts } from './motion';

// Reduce motion and Reduce screen shake (M5's a11y-1): which of the camera's two amounts, and the
// renderer's switch, each setting turns on. Reduce shake is the narrow, decided switch; Reduce motion
// is the wider one and takes the shake with it; the phone's own reduce-motion preference counts as
// Reduce motion being on.
const withSettings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('motionAmounts', () => {
  it('leaves everything at full by default', () => {
    expect(motionAmounts(DEFAULT_SETTINGS, false)).toEqual({ shake: 1, motion: 1, calm: false });
  });

  it('Reduce screen shake cuts the shake and nothing else', () => {
    expect(motionAmounts(withSettings({ reduceShake: true }), false)).toEqual({
      shake: 0,
      motion: 1,
      calm: false,
    });
  });

  it('Reduce motion cuts the shake, softens the camera and calms the picture', () => {
    expect(motionAmounts(withSettings({ reduceMotion: true }), false)).toEqual({
      shake: 0,
      motion: 0,
      calm: true,
    });
  });

  it("the phone's own preference turns Reduce motion on, and the setting does not need to be", () => {
    expect(motionAmounts(DEFAULT_SETTINGS, true)).toEqual({ shake: 0, motion: 0, calm: true });
  });
});
