// Run W-T, "the road fights back": the roadside smashables as render draws them from the snapshot.
// Standing ones are one batched mesh, of every kind (run W-T); a smashed one comes apart into its boxes, thrown
// along what hit it, which hang during a hit-stop and land on the ground. Driven by hand-built
// snapshots and explicit frame times, never the wall clock.
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SMASHABLE_KINDS, type SimSnapshot, type SmashableSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import { MAX_DEBRIS, smashableParts, Smashables } from './smashables';
import { mergeBoxes } from './geometry';

const prop = (
  id: number,
  kind: SmashableSnapshot['kind'],
  extra: Partial<SmashableSnapshot> = {},
): SmashableSnapshot => ({
  id,
  kind,
  name: 'RETURN TO SENDER',
  x: id * 2,
  y: 1,
  z: 0,
  heading: 0,
  smashedTick: -1,
  hitVx: 0,
  hitVz: 0,
  ...extra,
});

const snap = (smashables: SmashableSnapshot[], timeScale = 1): SimSnapshot => ({
  tick: 0,
  timeScale,
  entities: [],
  race: { over: false, routeLength: 1000, finishOrder: [] },
  smashables,
});

const meshOf = (s: Smashables, name: string) =>
  s.root.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name);

describe('render: roadside smashables', () => {
  it('has a shape for every kind, each small enough to stand beside the road and cheap in triangles', () => {
    for (const kind of SMASHABLE_KINDS) {
      const parts = smashableParts(kind);
      expect(parts.length, kind).toBeGreaterThan(1);
      expect(
        parts.some((p) => p.color === '#ff00ff'),
        kind,
      ).toBe(false);
      const g = mergeBoxes(parts);
      g.computeBoundingBox();
      const size = (g.boundingBox ?? new Box3()).getSize(new Vector3());
      expect(size.x, kind).toBeLessThan(2.5);
      expect(size.z, kind).toBeLessThan(2.5);
      expect(size.y, kind).toBeLessThan(3);
      expect((g.index?.count ?? 0) / 3, kind).toBeLessThanOrEqual(150);
    }
  });

  it('draws every standing one, of every kind, as one mesh (run W-T, the draw-call headroom)', () => {
    const s = new Smashables(createFlatLook(), () => 0.5);
    s.sync(snap([prop(1, 'mailbox'), prop(2, 'mailbox'), prop(3, 'lobster-traps')]), 0);
    expect(s.counts()).toEqual({ standing: { mailbox: 2, 'lobster-traps': 1 }, smashed: 0, debris: 0 });
    const standing = s.root.children.find(
      (c): c is Mesh => c instanceof Mesh && c.name === 'smashable-standing',
    );
    expect(standing?.visible).toBe(true);
    const tris = (kind: SmashableSnapshot['kind']) => mergeBoxes(smashableParts(kind)).index?.count ?? 0;
    expect(standing?.geometry.drawRange.count).toBe(2 * tris('mailbox') + tris('lobster-traps'));
    expect(meshOf(s, 'smashable-debris')).toBeUndefined();
    // All of them smashed: nothing stands, and the standing mesh draws nothing.
    const smashed = [1, 2, 3].map((id) => prop(id, id < 3 ? 'mailbox' : 'lobster-traps', { smashedTick: 5 }));
    s.sync(snap(smashed), 0.016);
    expect(standing?.visible).toBe(false);
  });

  it('breaks a smashed one into its boxes, thrown along the hit, frozen in a hit-stop, then landed', () => {
    const s = new Smashables(createFlatLook(), () => 0.5);
    s.sync(snap([prop(1, 'mailbox'), prop(2, 'mailbox')]), 0);
    const hit = prop(1, 'mailbox', { smashedTick: 10, hitVx: 20, hitVz: 0 });
    s.sync(snap([hit, prop(2, 'mailbox')]), 0.016);
    const parts = smashableParts('mailbox').length;
    expect(s.counts()).toEqual({ standing: { mailbox: 1 }, smashed: 1, debris: parts });
    const debris = meshOf(s, 'smashable-debris');
    if (!debris) throw new Error('no debris mesh');
    const xAt = () => {
      const m = new Matrix4();
      debris.getMatrixAt(0, m);
      return new Vector3().setFromMatrixPosition(m);
    };
    const start = xAt();
    // A hit-stop (time scale 0): nothing moves.
    s.sync(snap([hit, prop(2, 'mailbox')], 0), 0.05);
    expect(xAt().x).toBeCloseTo(start.x, 6);
    // Normal time: it flies along +x (the hit), then lies on the ground.
    for (let i = 1; i <= 120; i++) s.sync(snap([hit, prop(2, 'mailbox')]), 0.05 + i * 0.05);
    const end = xAt();
    expect(end.x).toBeGreaterThan(start.x + 2);
    expect(end.y).toBeGreaterThanOrEqual(1);
    expect(end.y).toBeLessThan(1.5);
  });

  it('drops a wreck once it leaves the snapshot, and caps the debris', () => {
    const s = new Smashables(createFlatLook(), () => 0.5);
    const many = Array.from({ length: 80 }, (_v, i) =>
      prop(i + 1, 'lobster-traps', { smashedTick: 1, hitVx: 10 }),
    );
    s.sync(snap(many), 0);
    expect(s.counts().debris).toBe(MAX_DEBRIS);
    s.sync(snap([]), 0.016);
    expect(s.counts().debris).toBe(0);
  });
});
