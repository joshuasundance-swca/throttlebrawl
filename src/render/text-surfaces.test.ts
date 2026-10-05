// Text surfaces (playtest 3, T12.6): the words on a model's blank board are pack text, painted by the
// game, so the in-game veto can cut them. CX4's roof sign and food carts are the real cases: the checks
// read the committed GLBs for their surfaces, paint with a recording canvas (the unit project has no
// DOM), and look at what the layer would draw: one call, the words inside the cell, a cut sign blank.
import { PerspectiveCamera, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BoardCatalog } from './boards';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeLandmarkKit, bakeModel, textSurfaceItemId, type TextSurface } from './models';
import { readAsset } from './model-files.test-util';
import {
  layoutRows,
  paintSurface,
  placeSurface,
  styleOfSurface,
  SURFACE_DRAW_M,
  SURFACE_LIFT_M,
  TextSurfaceLayer,
  type Cell,
  type SurfaceContext,
} from './text-surfaces';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

/** A 2D context that records what it was asked to draw, measuring a bold capital as 0.72 of its size, a little wide. */
function recorder() {
  const calls: { text: string; x: number; y: number; size: number; fill: string; glow: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  const fillOf = () => (typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '');
  const ctx: SurfaceContext = {
    font: '',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, fill: fillOf() });
    },
    fillText(text, x, y) {
      calls.push({
        text,
        x,
        y,
        size: Number(/(\d+)px/.exec(ctx.font)?.[1]),
        fill: fillOf(),
        glow: ctx.shadowBlur,
      });
    },
    measureText(text) {
      return { width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 };
    },
  };
  return { ctx, calls, rects };
}

const regionFiles = import.meta.glob<{
  signs?: { id: string; text: string; status?: string; tags?: string[] }[];
}>('../../packs/region-pnw/regions/pacific-northwest/region.json', { eager: true, import: 'default' });
const pnwSigns = Object.values(regionFiles)[0]?.signs ?? [];

const roofKit = bakeLandmarkKit(
  'pdx-landmarks',
  readGlb(await readAsset('models/landmarks/pdx-landmarks', 'glb')),
);
const downtown = bakeModel('pdxDowntown', readGlb(await readAsset('models/scenery/pdx-downtown', 'glb')));
const roofNode = roofKit.nodes.get('pdx_roof_sign');
const roofSurface = roofNode?.surfaces[0] as TextSurface;

describe("CX4's text surfaces, as the game bakes them", () => {
  it('finds the roof sign board and the three cart name boards, each with the size the README gives', () => {
    expect(roofNode, 'the pdx_roof_sign node').toBeDefined();
    expect(roofNode?.surfaces.map((s) => [s.name, s.widthM, s.heightM])).toEqual([
      ['pdx_roof_sign_words', 16, 3.2],
    ]);
    const carts = [6, 7, 8].map((v) => downtown.surfaces?.[v] ?? []);
    expect(carts.map((c) => c.map((s) => [s.name, s.widthM, s.heightM]))).toEqual([
      [['pdx_food_cart_a_name', 3.6, 0.45]],
      [['pdx_food_cart_b_name', 3.6, 0.45]],
      [['pdx_food_cart_c_name', 3.6, 0.45]],
    ]);
    // No other variant has one: the street fronts, the tower and the rack are word-free.
    for (const v of [0, 1, 2, 3, 4, 5, 9]) expect(downtown.surfaces?.[v], `variant ${v}`).toEqual([]);
  });

  it('keeps the blank board in the baked model, so a cut sign leaves a blank board, not a hole', () => {
    // Every surface's triangles are also in its model's own geometry (same positions).
    const geo = roofNode?.geometry.getAttribute('position');
    expect(geo).toBeDefined();
    const has = (x: number, y: number, z: number) => {
      for (let i = 0; geo && i < geo.count; i++)
        if (
          Math.abs(geo.getX(i) - x) < 1e-5 &&
          Math.abs(geo.getY(i) - y) < 1e-5 &&
          Math.abs(geo.getZ(i) - z) < 1e-5
        )
          return true;
      return false;
    };
    for (let i = 0; i < roofSurface.positions.length; i += 3)
      expect(
        has(
          roofSurface.positions[i] ?? 0,
          roofSurface.positions[i + 1] ?? 0,
          roofSurface.positions[i + 2] ?? 0,
        ),
        `corner ${i / 3}`,
      ).toBe(true);
  });

  it('names the sign by the node: `pdx_roof_sign_words` is the sign `pdx-roof-sign-words`', () => {
    expect(textSurfaceItemId('pdx_roof_sign_words')).toBe('pdx-roof-sign-words');
    expect(textSurfaceItemId('pdx_food_cart_a_name')).toBe('pdx-food-cart-a-name');
  });
});

describe("the Pacific Northwest's pack fills every surface CX4's models have", () => {
  const surfaces = [...(roofNode?.surfaces ?? []), ...(downtown.surfaces ?? []).flat()];

  it('has a live sign for each, named by its node, marked new, and pooled nowhere', () => {
    expect(surfaces.map((s) => s.name)).toEqual([
      'pdx_roof_sign_words',
      'pdx_food_cart_a_name',
      'pdx_food_cart_b_name',
      'pdx_food_cart_c_name',
    ]);
    for (const s of surfaces) {
      const sign = pnwSigns.find((x) => x.id === textSurfaceItemId(s.name));
      expect(sign, `a sign for ${s.name}`).toBeDefined();
      expect(sign?.status, s.name).toBe('live');
      expect(sign?.tags, `${s.name} is marked new, a surface, and pooled nowhere`).toEqual(
        expect.arrayContaining(['new', 'surface', 'site']),
      );
    }
  });

  it("says STILL RAINING on the roof sign, the maintainer's round-3 pick, in capitals", () => {
    const sign = pnwSigns.find((x) => x.id === 'pdx-roof-sign-words');
    expect(sign?.text).toBe('STILL RAINING');
  });

  it('keeps each cart name inside its board at a readable size', () => {
    for (const name of ['pdx_food_cart_a_name', 'pdx_food_cart_b_name', 'pdx_food_cart_c_name']) {
      const sign = pnwSigns.find((x) => x.id === textSurfaceItemId(name));
      const { ctx } = recorder();
      // A cart's board is 3.6 by 0.45 m: 8 to 1, so a 1024 px cell is 128 px tall.
      const fit = paintSurface(ctx, { x: 0, y: 0, w: 1024, h: 128 }, styleOfSurface(name), sign?.text ?? '');
      // Letters at least a quarter of the board's height, so they read from a few metres.
      expect(fit.size, `${name}: "${sign?.text}"`).toBeGreaterThanOrEqual(32);
    }
  });
});

describe('placeSurface', () => {
  it('stands the quad in front of the blank panel along its own normal, whichever way the model faces', () => {
    const turned = new Matrix4().compose(
      new Vector3(100, 20, -50),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      new Vector3(0.8, 0.8, 0.8),
    );
    const flat = placeSurface(roofSurface, new Matrix4());
    // Seen from +Z the panel faces +Z; the lift is 6 cm along that.
    expect(flat.normal.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
    expect(flat.positions[2]).toBeCloseTo((roofSurface.positions[2] ?? 0) + SURFACE_LIFT_M, 5);
    const moved = placeSurface(roofSurface, turned);
    // Turned a quarter about Y, +Z points along +X; the panel's centre moved with the model.
    expect(moved.normal.x).toBeCloseTo(1, 5);
    expect(moved.id).toBe('pdx-roof-sign-words');
    const dx = moved.centre.x - 100;
    expect(dx).toBeGreaterThan(SURFACE_LIFT_M * 0.99);
  });
});

describe('painting the words', () => {
  const cell: Cell = { x: 0, y: 8, w: 1024, h: 205 };

  it("sets STILL RAINING on one line in neon pink, inside the cell, on the roof sign's dark board", () => {
    const { ctx, calls, rects } = recorder();
    const fit = paintSurface(ctx, cell, styleOfSurface('pdx_roof_sign_words'), 'STILL RAINING');
    expect(rects).toEqual([{ x: 0, y: 8, w: 1024, h: 205, fill: '#121827' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe('STILL RAINING');
    expect(calls[0]?.fill).toBe('#ff7ab8');
    expect(calls[0]?.glow).toBeGreaterThan(0);
    // The letters never run past the cell's padded width or height.
    expect(fit.width).toBeLessThanOrEqual(cell.w - 2 * Math.round(cell.h * 0.12));
    expect(fit.size).toBeLessThanOrEqual(cell.h - 2 * Math.round(cell.h * 0.12));
    expect(calls[0]?.x).toBe(512);
  });

  it('shrinks a long name to fit its cell rather than run off the board', () => {
    const { ctx } = recorder();
    const board: Cell = { x: 0, y: 0, w: 1024, h: 128 };
    const short = paintSurface(ctx, board, styleOfSurface('pdx_food_cart_a_name'), 'PHO');
    const long = paintSurface(
      ctx,
      board,
      styleOfSurface('pdx_food_cart_a_name'),
      'THE VERY DAMP NOODLE AND DUMPLING COUNTER, NEXT TO THE OTHER ONE',
    );
    expect(long.size).toBeLessThan(short.size);
    expect(long.width).toBeLessThanOrEqual(board.w - 2 * Math.round(board.h * 0.12) + 1);
  });

  it('uses chalk, with no glow, for every surface that is not the roof sign', () => {
    const { ctx, calls } = recorder();
    paintSurface(ctx, cell, styleOfSurface('pdx_food_cart_b_name'), 'LUNCH');
    expect(calls[0]?.glow).toBe(0);
    expect(calls[0]?.fill).toBe('#f2e9d2');
  });

  it("lays each distinct text its own row, as tall as its board's proportions, clear of the next", () => {
    const style = styleOfSurface('x');
    const { rows, width, height } = layoutRows([
      { id: 'a', text: 'A', style, aspect: 5 },
      { id: 'b', text: 'B', style, aspect: 8 },
    ]);
    expect(width).toBe(1024);
    expect(rows.map((r) => r.cell.h)).toEqual([205, 128]);
    const [a, b] = rows;
    expect((b?.cell.y ?? 0) - ((a?.cell.y ?? 0) + (a?.cell.h ?? 0))).toBeGreaterThanOrEqual(8);
    expect((b?.cell.y ?? 0) + (b?.cell.h ?? 0)).toBeLessThanOrEqual(height);
  });
});

describe('the layer', () => {
  const sign = (id: string, text: string) => ({
    ref: `region-pnw:region/pacific-northwest#${id}`,
    text,
    kind: 'sign' as const,
  });
  const catalog = (ids: Record<string, string>): BoardCatalog => ({
    items: Object.fromEntries(Object.entries(ids).map(([id, text]) => [id, sign(id, text)])),
  });
  /** The roof sign standing at the origin facing +Z, and three carts with the same name board. */
  const placed = () => [
    placeSurface(roofSurface, new Matrix4().makeTranslation(0, 10, 0)),
    ...[6, 7, 6].map((v, i) =>
      placeSurface(
        downtown.surfaces?.[v]?.[0] as TextSurface,
        new Matrix4().makeTranslation(40 + i * 10, 1.5, 4),
      ),
    ),
  ];
  const canvasOf = () => {
    const rec = recorder();
    return {
      rec,
      createCanvas: () => ({ ctx: rec.ctx, texture: { dispose() {} } as never }),
    };
  };

  it('draws only the signs the catalog has, all in one call, and paints each distinct text once', () => {
    const { rec, createCanvas } = canvasOf();
    const layer = new TextSurfaceLayer(look, placed(), {
      catalog: catalog({ 'pdx-roof-sign-words': 'STILL RAINING', 'pdx-food-cart-a-name': 'DAMP BOWL' }),
      createCanvas,
    });
    // The roof sign and the two carts named `a` have words; the `b` cart has no sign: it stays blank.
    expect(layer.counts().surfaces).toBe(3);
    expect(rec.calls.map((c) => c.text)).toEqual(['STILL RAINING', 'DAMP BOWL']);
    layer.update(0, 40);
    expect(layer.counts()).toMatchObject({ shown: 3, drawCalls: 1 });
    // A control: far from every surface nothing is in the index, and the layer draws nothing.
    layer.update(SURFACE_DRAW_M * 3, 0);
    expect(layer.counts()).toMatchObject({ shown: 0, drawCalls: 0 });
  });

  it('puts each quad on its own row of the canvas, whatever the model asked for', () => {
    const { createCanvas } = canvasOf();
    const layer = new TextSurfaceLayer(look, placed(), {
      catalog: catalog({ 'pdx-roof-sign-words': 'STILL RAINING', 'pdx-food-cart-a-name': 'DAMP BOWL' }),
      createCanvas,
    });
    const uv =
      layer.group.children[0] &&
      (
        layer.group.children[0] as unknown as {
          geometry: { getAttribute(n: string): { array: Float32Array } };
        }
      ).geometry.getAttribute('uv').array;
    expect(uv).toBeDefined();
    const rows = layer.painted;
    const roof = rows.get('pdx-roof-sign-words')?.cell as Cell;
    const cart = rows.get('pdx-food-cart-a-name')?.cell as Cell;
    expect(roof.y + roof.h).toBeLessThan(cart.y);
    // The first six vertices are the roof sign's: their v lies inside its cell's share of the canvas.
    const total = cart.y + cart.h + 8;
    for (let i = 0; i < 6; i++) {
      const v = (uv as Float32Array)[i * 2 + 1] ?? -1;
      expect(v).toBeGreaterThanOrEqual(roof.y / total - 1e-6);
      expect(v).toBeLessThanOrEqual((roof.y + roof.h) / total + 1e-6);
    }
  });

  it('leaves a cut sign blank at once, and its words stay out when the catalog drops it', () => {
    const { createCanvas } = canvasOf();
    const words = catalog({ 'pdx-roof-sign-words': 'STILL RAINING' });
    const ref = words.items['pdx-roof-sign-words']?.ref as string;
    const layer = new TextSurfaceLayer(look, placed(), { catalog: words, createCanvas });
    layer.update(0, 40);
    expect(layer.counts().shown).toBe(1);
    layer.hide([ref]);
    layer.update(0, 40);
    expect(layer.counts()).toMatchObject({ shown: 0, cut: 1, drawCalls: 0 });
    // Cut on this device before the road was built: the same.
    const early = new TextSurfaceLayer(look, placed(), { catalog: words, hidden: [ref], createCanvas });
    early.update(0, 40);
    expect(early.counts().shown).toBe(0);
    // The catalog without the sign (the pack cut it): no row, no mesh.
    const none = new TextSurfaceLayer(look, placed(), { catalog: catalog({}), createCanvas });
    expect(none.counts().surfaces).toBe(0);
    expect(none.group.children).toHaveLength(0);
    expect(
      new TextSurfaceLayer(look, placed(), { catalog: undefined, createCanvas }).group.children,
    ).toHaveLength(0);
  });

  it('lists the sign in view for the veto, once, with its words, and finds it under a long-press', () => {
    const { createCanvas } = canvasOf();
    const words = catalog({ 'pdx-roof-sign-words': 'STILL RAINING' });
    const layer = new TextSurfaceLayer(look, placed(), { catalog: words, createCanvas });
    layer.update(0, 60);
    const at = (placed()[0] as { centre: Vector3 }).centre;
    const cam = new PerspectiveCamera(70, 2, 0.3, 760);
    cam.position.set(at.x, at.y, at.z + 60);
    cam.lookAt(at);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    expect(layer.visibleContent(cam)).toEqual([
      { ref: words.items['pdx-roof-sign-words']?.ref, kind: 'sign', label: 'STILL RAINING' },
    ]);
    // Under the screen's middle (the sign is right there), and not under its top corner.
    expect(layer.pick(0, 0, cam)).toBe(words.items['pdx-roof-sign-words']?.ref);
    expect(layer.pick(0.95, 0.95, cam)).toBeNull();
    // From behind the board (its face is +Z) it is neither listed nor picked.
    const back = new PerspectiveCamera(70, 2, 0.3, 760);
    back.position.set(at.x, at.y, at.z - 60);
    back.lookAt(at);
    back.updateMatrixWorld(true);
    back.updateProjectionMatrix();
    expect(layer.pick(0, 0, back)).toBeNull();
    // Turned away from it, the sign is not in view.
    const away = new PerspectiveCamera(70, 2, 0.3, 760);
    away.position.set(at.x, at.y, at.z + 60);
    away.lookAt(at.x, at.y, at.z + 200);
    away.updateMatrixWorld(true);
    away.updateProjectionMatrix();
    expect(layer.visibleContent(away)).toEqual([]);
    stdout.write(
      '[examined] text surfaces: the roof sign listed in view, picked under a press, blank when cut\n',
    );
  });
});
