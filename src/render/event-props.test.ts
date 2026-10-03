// W-P road events: render draws every set-piece prop the sim puts in SimSnapshot.props, batched
// (run W-T: the props standing still in one mesh, the moving ones in another, so a live piece is a
// few draw calls and none without one), hides what left the snapshot, and keeps the glowing parts
// (flares, light bars) on the unlit material.
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PROP_KINDS, type PropKind, type PropSnapshot, type SimSnapshot } from '../sim/api';
import { EventProps } from './event-props';
import { createFlatLook } from './look';

function prop(id: number, kind: PropKind, variant = '', extra: Partial<PropSnapshot> = {}): PropSnapshot {
  return {
    id,
    kind,
    variant,
    label: '',
    piece: 'test:piece',
    x: id,
    y: 0,
    z: -id,
    heading: 0.3,
    tilt: 0,
    moving: false,
    ...extra,
  };
}

function snap(props: PropSnapshot[]): SimSnapshot {
  return {
    tick: 1,
    timeScale: 1,
    entities: [],
    race: { over: false, routeLength: 1000, finishOrder: [] },
    props,
  };
}

/** The instanced meshes drawn (the glowing shapes: flares' glow and light bars). */
const visible = (e: EventProps) =>
  e.root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.visible && c.count > 0);

/** Draw calls under the root: every visible mesh with something to draw. */
function draws(e: EventProps): number {
  let n = 0;
  e.root.traverseVisible((o) => {
    if (o instanceof InstancedMesh) n += o.count > 0 ? 1 : 0;
    else if (o instanceof Mesh) n++;
  });
  return n;
}

/** The shape keys in a batch, in order. */
function shapes(batch: ReturnType<EventProps['batches']>['still']): string[] {
  const m = new Matrix4();
  return Array.from({ length: batch.count }, (_, i) => batch.item(i, m)?.name ?? '?');
}

describe('render: road event props', () => {
  it('draws every prop kind the sim can send, and counts them', () => {
    const e = new EventProps(createFlatLook());
    const variants: Partial<Record<PropKind, string>> = {
      person: 'flagger',
      floatDecor: 'sf-0',
      sign: 'roadwork',
    };
    const labels: Partial<Record<PropKind, Partial<PropSnapshot>>> = {
      sign: { label: 'ROAD WORK AHEAD' },
      gantry: { label: 'GATOR CROSSING | PARADE', spanM: 8 },
    };
    const props = PROP_KINDS.map((k, i) => prop(i + 1, k, variants[k] ?? '', labels[k] ?? {}));
    e.sync(snap(props), 1);
    const c = e.counts();
    expect(c.total).toBe(PROP_KINDS.length);
    for (const k of PROP_KINDS) expect(c.byKind[k], k).toBe(1);
    expect(c.signs).toEqual(['ROAD WORK AHEAD', 'GATOR CROSSING | PARADE']);
    // Every prop is drawn: in the still or moving batch (run W-T), or as a glowing instance. The
    // sign gives its post, the gantry its frame, the flare adds its glow and the flagger an arm.
    const { still, moving } = e.batches();
    const instances = visible(e).reduce((n, m) => n + m.count, 0);
    expect(still.count + moving.count + instances).toBe(PROP_KINDS.length + 2);
    expect(shapes(still)).toEqual(
      expect.arrayContaining(['cone', 'flare', 'barricade', 'signPost:tall', 'gantryFrame:8', 'radar']),
    );
    expect(shapes(moving)).toEqual(expect.arrayContaining(['arm:#c8ff2e', 'inflatable']));
    // No DOM here, so no printed panels: the sign stands as its own (empty) group.
    expect(e.root.children.some((o) => o.name.startsWith('event-sign-'))).toBe(true);
  });

  it('one draw however many props share it: twenty cones are one draw', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap(Array.from({ length: 20 }, (_, i) => prop(i + 1, 'cone'))), 0);
    expect(draws(e)).toBe(1);
    expect(e.batches().still.count).toBe(20);
  });

  it('hides what left the snapshot, and draws nothing when no piece is live', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap([prop(1, 'cone'), prop(2, 'hayBale'), prop(3, 'sign', 'parade', { label: 'PARADE' })]), 0);
    // The cone, the bale and the sign's post, in the still batch (no DOM: no panel).
    expect(draws(e)).toBe(1);
    expect(shapes(e.batches().still)).toEqual(['cone', 'hayBale', 'signPost:tall']);
    e.sync(snap([]), 0.5);
    expect(draws(e)).toBe(0);
    expect(e.root.children.some((o) => o.name.startsWith('event-sign-'))).toBe(false);
    expect(e.counts().total).toBe(0);
    e.sync(null, 1);
    expect(draws(e)).toBe(0);
  });

  it('keeps flares and light bars glowing (unlit) and the rest on the lit prop material', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap([prop(1, 'flare'), prop(2, 'lightbar'), prop(3, 'cone')]), 0);
    const byName = new Map(visible(e).map((m) => [m.name, m]));
    expect(byName.get('event-flareGlow')?.material).toBeInstanceOf(MeshBasicMaterial);
    expect(byName.get('event-lightbar')?.material).toBeInstanceOf(MeshBasicMaterial);
    const still = e.batches().still;
    expect(shapes(still)).toEqual(['flare', 'cone']);
    expect(still.mesh.material).not.toBeInstanceOf(MeshBasicMaterial);
  });

  it('grows past its first buffer, and an unknown person variant falls back to a marcher', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap(Array.from({ length: 40 }, (_, i) => prop(i + 1, 'person', 'mystery'))), 0);
    const still = e.batches().still;
    expect(still.count).toBe(40);
    expect(new Set(shapes(still))).toEqual(new Set(['person:marcher']));
    const pos = still.mesh.geometry.getAttribute('position');
    expect(Math.abs(pos.getX(0) - 1)).toBeLessThan(1);
    expect(still.mesh.geometry.drawRange.count).toBeGreaterThan(0);
  });
});
