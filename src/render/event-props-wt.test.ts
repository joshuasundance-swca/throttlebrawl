// Weird events that move (run W-T): render draws the shed logs (one shared mesh, rolling about
// their long axis), the lane-vote gantry (a frame and one panel naming both choices, redrawn once
// the vote lights the winning side), the small serial signs, and the gator crossing's guard.
// Draw cost is counted: posts are shared, so four serial signs are four panels plus one post mesh.
import { InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropKind, PropSnapshot, SimSnapshot } from '../sim/api';
import { EventProps } from './event-props';
import { createFlatLook } from './look';

function prop(id: number, kind: PropKind, extra: Partial<PropSnapshot> = {}): PropSnapshot {
  return {
    id,
    kind,
    variant: '',
    label: '',
    piece: 'test:piece',
    x: id * 3,
    y: 0,
    z: -id * 40,
    heading: 0,
    tilt: 0,
    moving: false,
    ...extra,
  };
}

const snap = (props: PropSnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities: [],
  race: { over: false, routeLength: 1000, finishOrder: [] },
  props,
});

/** Draw calls: every visible mesh under the root (instanced or not). */
function draws(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof InstancedMesh) n += o.visible && o.count > 0 ? 1 : 0;
    else if (o instanceof Mesh && o.visible) n++;
  });
  return n;
}

// A stand-in canvas: panels are painted only where there is a DOM.
beforeEach(() => {
  const own: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 12 }) };
  const ctx = new Proxy(own, {
    get: (target, key): unknown => (typeof key === 'string' && key in target ? target[key] : () => undefined),
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('render: weird events that move (W-T)', () => {
  it('draws every shed log in one mesh, turned about its long axis as it rolls', () => {
    const e = new EventProps(createFlatLook());
    const logs = Array.from({ length: 6 }, (_, i) => prop(i + 1, 'log', { tilt: i * 0.7, moving: i < 3 }));
    e.sync(snap(logs), 0);
    const mesh = e.root.children.find(
      (o): o is InstancedMesh => o instanceof InstancedMesh && o.name === 'event-log',
    );
    expect(mesh?.count).toBe(6);
    if (!mesh) return;
    // Instance 3 has rolled 2.1 rad about x: its long axis (x) stays across the road, its up does not.
    const q = new Quaternion();
    const matrix = new Matrix4();
    mesh.getMatrixAt(3, matrix);
    matrix.decompose(new Vector3(), q, new Vector3());
    const along = new Vector3(1, 0, 0).applyQuaternion(q);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(Math.abs(along.x)).toBeCloseTo(1, 5);
    expect(up.y).toBeCloseTo(Math.cos(2.1), 5);
  });

  it('a gantry is a frame plus one panel (two draws), and lights the winning side once voted', () => {
    const e = new EventProps(createFlatLook());
    const gantry = prop(1, 'gantry', { label: 'GATOR CROSSING | PARADE', spanM: 8 });
    e.sync(snap([gantry]), 0);
    const group = () => e.root.children.find((o) => o.name === 'event-gantry-1');
    expect(group()).toBeDefined();
    expect(draws(e.root)).toBe(2);
    const panel = group()?.children.find(
      (o): o is Mesh => o instanceof Mesh && o.geometry instanceof PlaneGeometry,
    );
    expect((panel?.geometry as PlaneGeometry | undefined)?.parameters.width).toBeCloseTo(8 * 0.94);
    const frame = group()?.children.find((o) => o.name === 'gantry-frame');
    const before = panel?.material;
    e.sync(snap([{ ...gantry, variant: 'left' }]), 0.5);
    const after = group()?.children.find(
      (o): o is Mesh => o instanceof Mesh && o.geometry instanceof PlaneGeometry,
    );
    // A new panel for the lit side; the frame is kept, still two draws.
    expect(after?.material).not.toBe(before);
    expect(group()?.children.find((o) => o.name === 'gantry-frame')).toBe(frame);
    expect(draws(e.root)).toBe(2);
    expect(e.counts().signs).toEqual(['GATOR CROSSING | PARADE']);
    e.sync(snap([]), 1);
    expect(group()).toBeUndefined();
    expect(draws(e.root)).toBe(0);
  });

  it('four serial signs are four small panels on one shared post mesh', () => {
    const e = new EventProps(createFlatLook());
    const lines = ['YOUR BOAT', 'IS NOT', 'IN THE WATER', 'CHECK LANE TWO'];
    e.sync(snap(lines.map((label, i) => prop(i + 1, 'sign', { variant: 'serial', label }))), 0);
    expect(draws(e.root)).toBe(5);
    const posts = e.root.children.find(
      (o): o is InstancedMesh => o instanceof InstancedMesh && o.name === 'event-signPost:serial',
    );
    expect(posts?.count).toBe(4);
    const panel = e.root.children
      .find((o) => o.name === 'event-sign-1')
      ?.children.find((o): o is Mesh => o instanceof Mesh);
    const width = (panel?.geometry as PlaneGeometry | undefined)?.parameters.width ?? 0;
    expect(width).toBeGreaterThan(1.5);
    expect(width).toBeLessThan(3);
    expect(e.counts().signs).toEqual(lines);
  });

  it("draws the gator crossing's guard as herself, not as the fallback marcher", () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap([prop(1, 'person', { variant: 'crossing-guard' })]), 0);
    const names = e.root.children.filter((o) => o instanceof InstancedMesh && o.visible).map((o) => o.name);
    expect(names).toContain('event-person:crossing-guard');
  });
});
