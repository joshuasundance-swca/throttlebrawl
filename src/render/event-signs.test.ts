// The warning sign a road event plants ahead (playtest 2, 2026-10-02 + interview, 2026-10-02:
// "signs that come true"): a short headline with a small kicker that says what the rider is about
// to meet, on a panel whose post stands behind it.
import { Box3, InstancedMesh, Mesh, PlaneGeometry } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropSnapshot, SimSnapshot } from '../sim/api';
import { splitCopy } from './boards';
import { EventProps } from './event-props';
import { createFlatLook } from './look';

interface ModifierFile {
  id: string;
  effects?: { kind: string; piece?: string; signText?: string }[];
}
const MODIFIERS = import.meta.glob<ModifierFile>('/packs/*/modifiers/*.json', {
  eager: true,
  import: 'default',
});

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('road event warning signs', () => {
  it('reads as a short headline plus a kicker, on every set piece in every region', () => {
    const signs = Object.values(MODIFIERS).flatMap((m) =>
      (m.effects ?? [])
        .filter((e) => e.kind === 'set-piece' && e.signText !== undefined)
        .map((e) => ({ id: m.id, piece: e.piece ?? '', text: e.signText ?? '' })),
    );
    expect(signs.length).toBe(13);
    for (const s of signs) {
      const { headline, kicker } = splitCopy(s.text);
      expect(words(headline), `${s.id}: "${headline}"`).toBeGreaterThanOrEqual(2);
      expect(words(headline), `${s.id}: "${headline}"`).toBeLessThanOrEqual(4);
      expect(kicker, `${s.id} needs a kicker`).not.toBe('');
    }
    // Each piece type is announced by name: the sign says what is coming.
    const announces: Record<string, RegExp> = {
      roadwork: /ROAD WORK|FLAGGER/,
      'crash-scene': /INCIDENT|RECALCULATING/,
      'speed-trap': /RADAR|SPEED/,
      parade: /PARADE/,
      'hay-spill': /HAY/,
    };
    for (const s of signs) {
      const rx = announces[s.piece];
      expect(rx, `${s.id}: unknown piece ${s.piece}`).toBeDefined();
      expect(splitCopy(s.text).headline, s.id).toMatch(rx as RegExp);
    }
  });
});

describe('the sign on its post', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stands its post behind the panel, never through the words', () => {
    // A stand-in canvas: the sign draws its panel only where there is a DOM.
    const ctx = {
      measureText: (t: string) => ({ width: t.length * 12 }),
      fillRect: () => undefined,
      strokeRect: () => undefined,
      fillText: () => undefined,
    };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const e = new EventProps(createFlatLook());
    const prop: PropSnapshot = {
      id: 1,
      kind: 'sign',
      variant: 'roadwork',
      label: 'ROAD WORK AHEAD. Since 1987.',
      piece: 'test:piece',
      x: 0,
      y: 0,
      z: -100,
      heading: 0,
      tilt: 0,
      moving: false,
    };
    const snap: SimSnapshot = {
      tick: 1,
      timeScale: 1,
      entities: [],
      race: { over: false, routeLength: 1000, finishOrder: [] },
      props: [prop],
    };
    e.sync(snap, 0);
    const group = e.root.children.find((o) => o.name === 'event-sign-1');
    expect(group).toBeDefined();
    const panel = group?.children.find(
      (o): o is Mesh => o instanceof Mesh && o.geometry instanceof PlaneGeometry,
    );
    const post = group?.children.find((o): o is InstancedMesh => o instanceof InstancedMesh);
    expect(panel).toBeDefined();
    expect(post).toBeDefined();
    if (!panel || !post) return;
    post.geometry.computeBoundingBox();
    const postBox = post.geometry.boundingBox as Box3;
    // The panel's face is at z = panel.position.z (it faces +z); the post's front is behind it.
    expect(postBox.max.z).toBeLessThan(panel.position.z);
  });
});
