import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, interpolateEntity, type ViewPose } from './index';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { canvasFake, NativeRendererFake } from './presentation.test-util';

vi.mock('three', async (original) => {
  const { NativeRendererFake } = await import('./presentation.test-util');
  return { ...(await original<typeof import('three')>()), WebGLRenderer: NativeRendererFake };
});
vi.mock('./chunk-gate', () => ({
  createChunkGate: () => ({
    chunk: () => Promise.resolve(null),
    later: () => {},
    newRoad: () => {},
    raceStart: () => {},
    gaveUp: () => [],
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderCamera() {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const draw = vi.spyOn(NativeRendererFake.prototype, 'render');
  const renderer = createRenderer(canvasFake());
  return (p: ViewPose): PerspectiveCamera => {
    renderer.render(null, null, 1, p);
    const camera = draw.mock.calls.at(-1)?.[1];
    if (!(camera instanceof PerspectiveCamera)) throw new Error('no rendered perspective camera');
    return camera;
  };
}

const pose: ViewPose = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: -1, fov: 70, roll: 0.3 };
const snapshot = (mode: EntitySnapshot['mode'], pitch?: number): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  race: { over: false, routeLength: 100, finishOrder: [] },
  entities: [
    {
      id: 0,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 20,
      lean: 0,
      mode,
      ...(pitch === undefined ? {} : { pitch }),
    } as EntitySnapshot,
  ],
});

describe('the renderer camera basis', () => {
  it('honors supplied up through vertical and inverted views and applies its roll once', () => {
    const render = renderCamera();
    for (const pitch of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = new Vector3(0, Math.sin(pitch), -Math.cos(pitch));
      const u = new Vector3(
        -Math.sin(pose.roll ?? 0),
        Math.cos(pitch) * Math.cos(pose.roll ?? 0),
        Math.sin(pitch) * Math.cos(pose.roll ?? 0),
      );
      const camera = render({ ...pose, lookY: f.y, lookZ: f.z, upX: u.x, upY: u.y, upZ: u.z });
      expect(camera.getWorldDirection(new Vector3()).distanceTo(f)).toBeLessThan(1e-10);
      const renderedUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      expect(renderedUp.distanceTo(u)).toBeLessThan(1e-10);
    }
  });

  it('resets world-up for legacy roll-only callers, including an incomplete up seed', () => {
    const render = renderCamera();
    const control = new PerspectiveCamera();
    render({ ...pose, upX: 0, upY: -1, upZ: 0 });
    for (const next of [
      pose,
      { ...pose, upY: -1 },
      { ...pose, upX: NaN, upY: 1, upZ: 0 },
      { ...pose, upX: 0, upY: 0, upZ: 0 },
      { ...pose, upX: 0, upY: 0, upZ: -1 },
    ]) {
      const camera = render(next);
      control.up.set(0, 1, 0);
      control.lookAt(0, 0, -1);
      control.rotateZ(pose.roll ?? 0);
      expect(camera.quaternion.angleTo(control.quaternion)).toBeLessThan(1e-7);
      expect(camera.up.toArray()).toEqual([0, 1, 0]);
    }
  });
});

describe('camera pitch interpolation', () => {
  it('preserves continuous turns in the air and takes the short reset path when landing', () => {
    const a = snapshot('Airborne', 10 * Math.PI - 0.1);
    const air = snapshot('Airborne', 10 * Math.PI + 0.1);
    expect(interpolateEntity(a, air, 0.5, 0)?.pitch).toBeCloseTo(10 * Math.PI);
    const land = snapshot('Road', 0.1);
    const p = interpolateEntity(a, land, 0.5, 0)?.pitch ?? NaN;
    expect(Math.cos(p)).toBeCloseTo(1);
    expect(Math.sin(p)).toBeCloseTo(0);
    // Same-air multi-turn difference must not be reduced to a shortest-angle interpolation.
    expect(
      interpolateEntity(snapshot('Airborne', 0), snapshot('Airborne', 4 * Math.PI), 0.25, 0)?.pitch,
    ).toBeCloseTo(Math.PI);
  });

  it('preserves absence and accepts the current pitch when the previous snapshot has none', () => {
    expect(interpolateEntity(snapshot('Airborne', 4), snapshot('Road'), 0.5, 0)).not.toHaveProperty('pitch');
    expect(interpolateEntity(snapshot('Road'), snapshot('Airborne', 0.8), 0.5, 0)?.pitch).toBe(0.8);
  });
});
