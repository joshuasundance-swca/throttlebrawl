// Readable boards (playtest 2, 2026-10-02: "billboard legs block the text", "pass too fast to
// read"): the copy is a 3-4 word headline plus a small kicker, the posts stand behind the printed
// face, and the face is turned toward the rider coming up the road.
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { Boards, splitCopy, type BoardCatalog, type BoardSlot } from './boards';
import { createFlatLook } from './look';

interface RegionCopy {
  billboards?: { id: string; text: string }[];
  signs?: { id: string; text: string }[];
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
    for (const [file, region] of Object.entries(REGIONS)) {
      for (const b of region.billboards ?? []) {
        const { headline, kicker } = splitCopy(b.text);
        expect(words(headline), `${file} ${b.id}: "${headline}"`).toBeGreaterThanOrEqual(3);
        expect(words(headline), `${file} ${b.id}: "${headline}"`).toBeLessThanOrEqual(4);
        expect(kicker, `${file} ${b.id} needs a kicker`).not.toBe('');
        billboards++;
      }
      for (const sgn of region.signs ?? []) {
        const { headline, kicker } = splitCopy(sgn.text);
        expect(words(headline), `${file} ${sgn.id}: "${headline}"`).toBeGreaterThanOrEqual(2);
        expect(words(headline), `${file} ${sgn.id}: "${headline}"`).toBeLessThanOrEqual(5);
        expect(kicker, `${file} ${sgn.id} needs a kicker`).not.toBe('');
        signs++;
      }
    }
    expect(billboards).toBe(22);
    expect(signs).toBe(32);
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
