// Regional sign faces (playtest 4, P4-19: "The real roads do not have the characteristics of the
// roads in question"; the identity sheets' C6 and fix 7). A sign's face comes from its slot's own
// `params.style`, else its region's `style`, else the default green; billboards and the incident
// cones keep their looks. The rule under test: a style reaches the boards it names, and the
// default is the face the game always had.
import type { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import {
  Boards,
  SIGN_FACES,
  SIGN_STYLES,
  signStyleOf,
  type BoardCatalog,
  type BoardItem,
  type BoardSlot,
} from './boards';
import { createFlatLook } from './look';

const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 600, kappa: 0 }]));

const sign: BoardItem = { ref: 'p:region/r#sign', text: 'KEEP RIGHT. Or left.', kind: 'sign' };
const billboard: BoardItem = { ref: 'p:region/r#bb', text: 'BUY A HAT NOW. Hats.', kind: 'billboard' };
const cone: BoardItem = { ref: 'p:career/c#incident', text: 'INCIDENT SITE #3.', kind: 'cone' };

function catalogOf(style?: string): BoardCatalog {
  return {
    ...(style === undefined ? {} : { style }),
    items: { sign, bb: billboard, cone },
    pools: { signs: [sign], billboards: [billboard] },
  };
}

const slot = (id: string, s: number, extra: Partial<BoardSlot> = {}): BoardSlot => ({
  kind: 'billboard',
  id,
  s0: s,
  s1: s + 10,
  d0: 7,
  d1: 9.5,
  item: 'sign',
  ...extra,
});

/** Builds boards for these slots; returns each board's style and the colour its face prints on. */
function built(catalog: BoardCatalog, slots: BoardSlot[]) {
  const boards = new Boards(createFlatLook());
  boards.build(road, () => slots, catalog);
  return boards.all().map((v) => ({
    id: v.slotId,
    style: v.style,
    face: `#${(v.panel.material as MeshBasicMaterial).color.getHexString()}`,
  }));
}

describe('sign faces by style', () => {
  it('has a face of its own for every style but the default', () => {
    const backgrounds = new Set(SIGN_STYLES.map((s) => SIGN_FACES[s].bg));
    expect(backgrounds.size).toBe(SIGN_STYLES.length);
    for (const s of SIGN_STYLES) {
      expect(SIGN_FACES[s].fg, s).toMatch(/^#[0-9a-f]{6}$/);
      expect(SIGN_FACES[s].frame, s).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('draws a region style on every sign of that region', () => {
    for (const style of SIGN_STYLES) {
      const out = built(catalogOf(style), [slot('a', 100), slot('b', 300)]);
      expect(out.map((o) => o.style)).toEqual([style, style]);
      expect(out.map((o) => o.face)).toEqual([SIGN_FACES[style].bg, SIGN_FACES[style].bg]);
    }
  });

  it("lets a slot's own style override its region's, and only that slot", () => {
    const out = built(catalogOf('mile-marker'), [
      slot('plain', 100),
      slot('brown', 300, { params: { style: 'historic' } }),
      slot('guide', 500, { params: { style: 'guide' } }),
    ]);
    expect(out.map((o) => o.style)).toEqual(['mile-marker', 'historic', 'guide']);
    expect(new Set(out.map((o) => o.face)).size).toBe(3);
  });

  it("keeps today's face when nothing names a style: green signs, cream billboards", () => {
    const out = built(catalogOf(), [slot('s', 100), slot('b', 300, { item: 'bb' })]);
    expect(out.map((o) => o.style)).toEqual(['default', 'default']);
    expect(out[0]?.face).toBe('#1f6b3a');
    expect(out[1]?.face).toBe('#f4ecd8');
    expect(SIGN_FACES.default).toMatchObject({ bg: '#1f6b3a', fg: '#ffffff', frame: '#cfd3d6' });
  });

  it('leaves billboards and incident cones as they were, in any region and slot style', () => {
    const plain = built(catalogOf(), [slot('b', 100, { item: 'bb' }), slot('c', 300, { item: 'cone' })]);
    const styled = built(catalogOf('guide'), [
      slot('b', 100, { item: 'bb', params: { style: 'historic' } }),
      slot('c', 300, { item: 'cone', params: { style: 'historic' } }),
    ]);
    expect(styled.map((o) => o.face)).toEqual(plain.map((o) => o.face));
    expect(styled.map((o) => o.style)).toEqual(['default', 'default']);
  });

  it("shows a pooled sign in its slot's style too", () => {
    const pooled: BoardSlot = {
      kind: 'billboard',
      id: 'pooled',
      s0: 100,
      s1: 110,
      d0: 7,
      d1: 9.5,
      pool: 'signs',
    };
    const out = built(catalogOf('town'), [pooled]);
    expect(out.map((o) => o.style)).toEqual(['town']);
  });

  it('ignores a style it does not know, falling back to the region and then the default', () => {
    expect(signStyleOf('guide')).toBe('guide');
    expect(signStyleOf('neon-pink')).toBeNull();
    expect(signStyleOf(7)).toBeNull();
    expect(signStyleOf(undefined)).toBeNull();
    const out = built(catalogOf('blade'), [slot('x', 100, { params: { style: 'neon-pink' } })]);
    expect(out.map((o) => o.style)).toEqual(['blade']);
    expect(built(catalogOf('neon-pink'), [slot('y', 100)]).map((o) => o.style)).toEqual(['default']);
  });
});

describe('an interstate guide sign is a bigger board than a town sign (playtest 4, P4-19, run C5; sheet I1)', () => {
  /** The printed face's size and how high its lower edge stands, from the built board. */
  function dims(catalog: BoardCatalog, extra: Partial<BoardSlot>) {
    const boards = new Boards(createFlatLook());
    boards.build(road, () => [slot('s', 100, extra)], catalog);
    const v = boards.all()[0];
    if (!v) throw new Error('no board');
    v.panel.geometry.computeBoundingBox();
    const box = v.panel.geometry.boundingBox;
    return {
      w: (box?.max.x ?? 0) - (box?.min.x ?? 0),
      h: (box?.max.y ?? 0) - (box?.min.y ?? 0),
      bottom: v.panel.position.y,
      radius: v.radius,
    };
  }

  it('is wider and taller than the default sign in the same slot, and stands higher above the road', () => {
    const plain = dims(catalogOf(), {});
    const guide = dims(catalogOf(), { params: { style: 'guide' } });
    expect(guide.w).toBeGreaterThan(plain.w);
    expect(guide.h).toBeGreaterThan(plain.h);
    expect(guide.bottom).toBeGreaterThan(plain.bottom);
    // The footprint a slot reserves is the board's own width: the radius follows it.
    expect(guide.radius).toBeCloseTo(guide.w / 2, 3);
    // Only the sign's style does it: a region style does too, a billboard in a guide-style region does not.
    expect(dims(catalogOf('guide'), {}).w).toBeCloseTo(guide.w, 3);
    expect(dims(catalogOf('guide'), { item: 'bb' }).w).toBeCloseTo(dims(catalogOf(), { item: 'bb' }).w, 3);
  });

  it('keeps every other style the size it always was', () => {
    const plain = dims(catalogOf(), {});
    for (const style of SIGN_STYLES.filter((s) => s !== 'guide')) {
      const d = dims(catalogOf(), { params: { style } });
      expect([d.w, d.h, d.bottom], style).toEqual([plain.w, plain.h, plain.bottom]);
    }
  });
});
