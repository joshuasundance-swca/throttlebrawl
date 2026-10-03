// W-P road events: render draws every set-piece prop the sim puts in SimSnapshot.props, one
// instanced mesh per shape (a few draw calls per live piece, none without one), hides what left the
// snapshot, and keeps the glowing parts (flares, light bars) on the unlit material.
import { InstancedMesh, MeshBasicMaterial } from 'three';
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

const visible = (e: EventProps) =>
  e.root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.visible && c.count > 0);

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
    // Every prop but the sign's panel and the gantry is an instance in some shared visible mesh: the
    // flare adds its glow, the flagger an arm, and the sign its post (W-T: posts are shared).
    const instances = visible(e).reduce((n, m) => n + m.count, 0);
    expect(instances).toBe(PROP_KINDS.length - 2 + 3);
    // The sign stands as its own group (a post, plus the printed panel where there is a DOM).
    expect(e.root.children.some((o) => o.name.startsWith('event-sign-'))).toBe(true);
  });

  it('one mesh per shape, however many props share it: twenty cones are one draw', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap(Array.from({ length: 20 }, (_, i) => prop(i + 1, 'cone'))), 0);
    const meshes = visible(e);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.count).toBe(20);
  });

  it('hides what left the snapshot, and draws nothing when no piece is live', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap([prop(1, 'cone'), prop(2, 'hayBale'), prop(3, 'sign', 'parade', { label: 'PARADE' })]), 0);
    // The cone, the bale, and the shared sign posts.
    expect(visible(e)).toHaveLength(3);
    e.sync(snap([]), 0.5);
    expect(visible(e)).toHaveLength(0);
    expect(e.root.children.some((o) => o.name.startsWith('event-sign-'))).toBe(false);
    expect(e.counts().total).toBe(0);
    e.sync(null, 1);
    expect(visible(e)).toHaveLength(0);
  });

  it('keeps flares and light bars glowing (unlit) and the rest on the lit prop material', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap([prop(1, 'flare'), prop(2, 'lightbar'), prop(3, 'cone')]), 0);
    const byName = new Map(visible(e).map((m) => [m.name, m]));
    expect(byName.get('event-flareGlow')?.material).toBeInstanceOf(MeshBasicMaterial);
    expect(byName.get('event-lightbar')?.material).toBeInstanceOf(MeshBasicMaterial);
    expect(byName.get('event-cone')?.material).not.toBeInstanceOf(MeshBasicMaterial);
  });

  it('grows a shape mesh past its first capacity, and an unknown person variant falls back to a marcher', () => {
    const e = new EventProps(createFlatLook());
    e.sync(snap(Array.from({ length: 40 }, (_, i) => prop(i + 1, 'person', 'mystery'))), 0);
    const people = visible(e).find((m) => m.name === 'event-person:marcher');
    expect(people?.count).toBe(40);
    expect(Number.isFinite(people?.instanceMatrix.array[12] ?? NaN)).toBe(true);
  });
});
