// The warning sign a road event plants ahead (playtest 2, 2026-10-02 + interview, 2026-10-02:
// "signs that come true"): a short headline with a small kicker that says what the rider is about
// to meet, on a panel whose post stands behind it.
import { Matrix4, Mesh, type Box3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropSnapshot, SimSnapshot } from '../sim/api';
import { splitCopy } from './boards';
import { EventProps } from './event-props';
import { createFlatLook } from './look';

interface ModifierFile {
  id: string;
  effects?: { kind: string; piece?: string; signText?: string; serial?: string[] }[];
}
const MODIFIERS = import.meta.glob<ModifierFile>('/packs/*/modifiers/*.json', {
  eager: true,
  import: 'default',
});

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('road event warning signs', () => {
  it('reads as a short headline plus a kicker, on every set piece in every region', () => {
    // A piece whose serial signs stand in for its warning sign (W-T) has an empty signText.
    const signs = Object.values(MODIFIERS).flatMap((m) =>
      (m.effects ?? [])
        .filter((e) => e.kind === 'set-piece' && e.signText !== undefined && e.signText !== '')
        .map((e) => ({ id: m.id, piece: e.piece ?? '', text: e.signText ?? '' })),
    );
    // Every warning sign the packs carry is checked (a count, not a fixed list: content lanes add
    // road events freely).
    console.log(`[examined] ${signs.length} road-event warning signs`);
    expect(signs.length).toBeGreaterThan(0);
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
      'animal-crossing': /CROSSING/,
      'lane-vote': /LANE VOTE/,
    };
    for (const s of signs) {
      const rx = announces[s.piece];
      expect(rx, `${s.id}: unknown piece ${s.piece}`).toBeDefined();
      expect(splitCopy(s.text).headline, s.id).toMatch(rx as RegExp);
    }
  });

  it('serial signs (W-T): one joke over four small all-caps signs, a few words each', () => {
    const serials = Object.values(MODIFIERS).flatMap((m) =>
      (m.effects ?? [])
        .filter((e) => e.serial !== undefined)
        .map((e) => ({ id: m.id, lines: e.serial ?? [] })),
    );
    console.log(`[examined] ${serials.length} serial sign runs`);
    expect(serials.length).toBeGreaterThan(0);
    for (const s of serials) {
      expect(s.lines, s.id).toHaveLength(4);
      for (const line of s.lines) {
        expect(line, s.id).toBe(line.toUpperCase());
        expect(words(line), `${s.id}: "${line}"`).toBeGreaterThanOrEqual(1);
        expect(words(line), `${s.id}: "${line}"`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('the sign on its post', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stands its post behind the panel, never through the words', () => {
    // A stand-in canvas: the sign draws its panel only where there is a DOM.
    const own: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 12 }) };
    const ctx = new Proxy(own, {
      get: (target, key): unknown =>
        typeof key === 'string' && key in target ? target[key] : () => undefined,
      set: () => true,
    });
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
    // Run W-T (the draw-call headroom): every panel is in one mesh over a shared atlas, every post
    // in the batch of props standing still, both placed in the world.
    const panels = e.root.children.find((o): o is Mesh => o instanceof Mesh && o.name === 'event-panels');
    const still = e.batches().still;
    expect(panels?.visible).toBe(true);
    expect(still.item(0, new Matrix4())?.name).toBe('signPost:tall');
    if (!panels) return;
    panels.geometry.computeBoundingBox();
    const face = panels.geometry.boundingBox as Box3;
    const posts = still.mesh.geometry.boundingBox as Box3;
    // The panel's face is the plane z = -100 (it faces +z); the post's front is behind it.
    expect(face.min.z).toBeCloseTo(-100, 5);
    expect(posts.max.z).toBeLessThan(face.min.z);
  });
});
