// Readable boards (playtest 2, 2026-10-02: "billboard legs block the text", "pass too fast to
// read"): the copy is a 3-4 word headline plus a small kicker, the posts stand behind the printed
// face, and the face is turned toward the rider coming up the road.
import { Box3, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { Boards, conePartsAt, splitCopy, type BoardCatalog, type BoardSlot } from './boards';
import { createFlatLook } from './look';

interface RegionCopy {
  billboards?: { id: string; text: string }[];
  signs?: { id: string; text: string; tags?: string[] }[];
}
const REGIONS = import.meta.glob<RegionCopy>('/packs/*/regions/*/region.json', {
  eager: true,
  import: 'default',
});

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('board copy', () => {
  it('splits a headline from its kicker at the first sentence', () => {
    expect(splitCopy('ROAD MAY BE WET. Road is wet.')).toEqual({
      headline: 'ROAD MAY BE WET',
      kicker: 'Road is wet.',
    });
    expect(splitCopy('NOW HIRING: PROMPT WHISPERER. Senior role. 10 years.')).toEqual({
      headline: 'NOW HIRING: PROMPT WHISPERER',
      kicker: 'Senior role. 10 years.',
    });
    expect(splitCopy('BRIDGE TOLL $9. View not included.').headline).toBe('BRIDGE TOLL $9');
    expect(splitCopy('JUST A HEADLINE')).toEqual({ headline: 'JUST A HEADLINE', kicker: '' });
  });

  it('gives every billboard a 3-4 word headline and every sign a short one, each with a kicker', () => {
    const files = Object.keys(REGIONS);
    expect(files.length).toBe(3);
    let billboards = 0;
    let signs = 0;
    let surfaces = 0;
    for (const [file, region] of Object.entries(REGIONS)) {
      for (const b of region.billboards ?? []) {
        const { headline, kicker } = splitCopy(b.text);
        expect(words(headline), `${file} ${b.id}: "${headline}"`).toBeGreaterThanOrEqual(3);
        expect(words(headline), `${file} ${b.id}: "${headline}"`).toBeLessThanOrEqual(4);
        expect(kicker, `${file} ${b.id} needs a kicker`).not.toBe('');
        billboards++;
      }
      for (const sgn of region.signs ?? []) {
        // The words on a model's blank board (the roof sign, a cart's name: playtest 3, T12.6) are painted by
        // text-surfaces.ts, not printed on a board: a name board holds a few words, no kicker.
        if (sgn.tags?.includes('surface')) {
          expect(words(sgn.text), `${file} ${sgn.id}: "${sgn.text}"`).toBeLessThanOrEqual(5);
          expect(sgn.tags, `${file} ${sgn.id} is pooled nowhere`).toContain('site');
          surfaces++;
          continue;
        }
        const { headline, kicker } = splitCopy(sgn.text);
        expect(words(headline), `${file} ${sgn.id}: "${headline}"`).toBeGreaterThanOrEqual(2);
        expect(words(headline), `${file} ${sgn.id}: "${headline}"`).toBeLessThanOrEqual(5);
        expect(kicker, `${file} ${sgn.id} needs a kicker`).not.toBe('');
        signs++;
      }
    }
    // Floors, not exact counts, so new content in any region does not break this check (run W-Q's
    // distinct keys added 6 billboards and 12 signs); they prove the loops examined every file.
    console.info(
      `[examined] board copy: ${billboards} billboards, ${signs} signs (and ${surfaces} surface texts, which are no board) in ${files.length} regions`,
    );
    expect(billboards).toBeGreaterThanOrEqual(22);
    expect(signs).toBeGreaterThanOrEqual(32);
    // The surface texts are the Portland roof sign's and its three food carts' (they are looked at, not skipped).
    expect(surfaces).toBeGreaterThanOrEqual(4);
  });
});

describe('board geometry', () => {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 400, kappa: 0 }]));
  const catalog: BoardCatalog = {
    items: {
      a: {
        ref: 'base:region/x#a',
        text: 'PARADISE FOR SALE. Some pieces still above water.',
        kind: 'billboard',
      },
      b: { ref: 'base:region/x#b', text: 'BRIDGE TOLL $9. View not included.', kind: 'sign' },
    },
  };
  const slots: BoardSlot[] = [
    { kind: 'billboard', id: 'bb', s0: 250, s1: 270, d0: 8, d1: 17, item: 'a' },
    { kind: 'billboard', id: 'sg', s0: 250, s1: 260, d0: -9, d1: -6.5, item: 'b' },
  ];
  const boards = new Boards(createFlatLook());
  boards.build(road, () => slots, catalog);

  it('stands the posts behind the printed face, never through it', () => {
    for (const v of boards.all()) {
      v.group.updateMatrixWorld(true);
      const frame = v.group.children.find((c) => c !== v.panel);
      expect(frame).toBeDefined();
      if (!frame) continue;
      // The frame's geometry (group-local) never reaches the face plane (local z = 0).
      const post = frame as unknown as { geometry: { boundingBox: Box3 | null; computeBoundingBox(): void } };
      post.geometry.computeBoundingBox();
      expect(post.geometry.boundingBox?.max.z).toBeLessThanOrEqual(0);
    }
  });

  it('turns the face toward the rider coming up the road, not along it', () => {
    for (const v of boards.all()) {
      const normal = new Vector3(0, 0, 1).transformDirection(v.group.matrixWorld);
      // The fixture road runs toward -z, so a rider before the board is at +z of it.
      expect(normal.z).toBeGreaterThan(0.9);
      // Toed in toward the road's middle: on the +x side the normal leans to -x, and vice versa.
      const side = Math.sign(v.group.position.x - road.toWorld(0, 250, 0, 0).x);
      expect(Math.sign(normal.x)).toBe(-side);
    }
  });

  it('draws billboards big enough to read at speed', () => {
    const bb = boards.all().find((v) => v.kind === 'billboard');
    expect(bb).toBeDefined();
    const size = new Box3().setFromObject((bb as NonNullable<typeof bb>).panel).getSize(new Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThanOrEqual(8.5);
    expect(size.y).toBeGreaterThanOrEqual(4);
  });
});

describe('the incident site (run W-U: "an INCIDENT SITE #3 cone where you were busted")', () => {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 400, kappa: 0 }]));
  const catalog: BoardCatalog = {
    items: {
      site: {
        ref: 'base:career/keys-circuit#receipt-incident-site',
        text: 'INCIDENT SITE #3.',
        kind: 'cone',
      },
    },
  };
  const slots: BoardSlot[] = [
    { kind: 'billboard', id: 'incident-site-1', s0: 200, s1: 200, d0: 9, d1: 9, item: 'site' },
  ];
  const boards = new Boards(createFlatLook());
  boards.build(road, () => slots, catalog);
  const site = boards.all()[0];
  const frameOf = (v: NonNullable<typeof site>) => v.group.children.find((c) => c !== v.panel) as Mesh;

  it('draws traffic cones round a small orange placard: two meshes, like any board', () => {
    expect(boards.all()).toHaveLength(1);
    if (!site) return;
    expect(site.kind).toBe('cone');
    expect(site.ref).toBe('base:career/keys-circuit#receipt-incident-site');
    expect(site.group.children).toHaveLength(2);
    const panel = new Box3().setFromObject(site.panel).getSize(new Vector3());
    expect(Math.max(panel.x, panel.z)).toBeCloseTo(2.8, 1);
    expect(panel.y).toBeCloseTo(1.4, 5);
    // The placard stands low, at cone height, not up on posts like a sign.
    expect(site.panel.position.y).toBeCloseTo(0.5, 5);
    const frame = frameOf(site);
    frame.geometry.computeBoundingBox();
    // The big cone stands about 1.9 m tall, so it reads at speed.
    expect(frame.geometry.boundingBox?.max.y ?? 0).toBeGreaterThan(1.8);
    // Orange cone vertices are among the frame's colours (#ff6a13, in linear colour).
    const col = frame.geometry.getAttribute('color');
    let orange = 0;
    for (let i = 0; i < col.count; i++)
      if (col.getX(i) > 0.9 && col.getY(i) < 0.3 && col.getZ(i) < 0.1) orange++;
    expect(orange).toBeGreaterThan(24);
  });

  it('keeps every cone beside the placard, never in front of its words', () => {
    expect(conePartsAt(2.4, -1.95, 0.1)).toHaveLength(6);
    if (!site) return;
    const pos = frameOf(site).geometry.getAttribute('position');
    let front = 0;
    for (let i = 0; i < pos.count; i++) {
      // Anything in front of the face plane (local z > 0) is outside the placard's width.
      if (pos.getZ(i) <= 0.01) continue;
      front++;
      expect(Math.abs(pos.getX(i))).toBeGreaterThan(1.4);
    }
    expect(front).toBeGreaterThan(0);
  });
});
