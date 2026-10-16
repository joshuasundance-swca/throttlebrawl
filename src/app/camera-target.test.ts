import { describe, expect, it } from 'vitest';
import { cameraTargetOf } from './camera-target';
import type { EntitySnapshot } from '../sim/api';

describe('the camera target attitude', () => {
  it('passes interpolated pitch instead of replacing it with the current snapshot angle', () => {
    const me = { id: 0, x: 0, y: 0, z: 0, heading: 0, lean: 0, speed: 20, pitch: 0.6 };
    const at = { mode: 'Airborne', pitch: 0.8, wheelie: 0.2 } as EntitySnapshot;
    expect(cameraTargetOf(me, at)).toMatchObject({ pitch: 0.6, wheelie: 0.2, mode: 'Airborne' });
    const { pitch: _pitch, ...without } = me;
    expect(cameraTargetOf(without, at)).not.toHaveProperty('pitch');
  });
});
