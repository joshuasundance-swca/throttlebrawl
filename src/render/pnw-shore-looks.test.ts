// Chuckanut's bay side reads as a cliff to the water, and its rock cuts finish (playtest 4 run C's live check, punch
// item 7: "the bay-side drop looks like stepped green terraces, the stone parapet like a dark low rail, and a rock
// cut ends in a flat vertical edge"). CX6's `pnw-shore` models are Blender work (tools/blender/props/pnw_shore.py);
// this lane has no Blender, so the three are finished in code when the file bakes (render/shore-fixes.ts), and the
// checks read the baked models and the real road's placement:
// - the bluff: the face is steep (no wide ledges), no green on it, and it runs down to the water (a road is 41 to
//   70 m over the bay; the model hung 40 m and its toe was a floating shelf over the sea);
// - the parapet: taller and paler;
// - the cuts: each run ends in a tapered section whose low end faces away from the run, at the run's start and end.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  nearestOnEdges,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModel, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { PNW_KIT, scatterRoadside, type RoadsideItem } from './roadside';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

/** The 20 m bluff section's variant, the parapet's, the two cuts', and the four tapered ends appended to the file's eight. */
const V = { rockCut: [0, 1], parapet: 2, bluff: 3 } as const;

interface Face {
  area: number;
  nx: number;
  ny: number;
  nz: number;
  /** The face's centre, model metres. */
  cx: number;
  cy: number;
  cz: number;
  rgb: readonly [number, number, number];
}
function faces(model: SceneryModel, variant: number): Face[] {
  const g = model.variants[variant]!;
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const out: Face[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const a = [0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)] as const);
    const u = [a[1]![0] - a[0]![0], a[1]![1] - a[0]![1], a[1]![2] - a[0]![2]];
    const w = [a[2]![0] - a[0]![0], a[2]![1] - a[0]![1], a[2]![2] - a[0]![2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l < 1e-9) continue;
    out.push({
      area: l / 2,
      nx: n[0]! / l,
      ny: n[1]! / l,
      nz: n[2]! / l,
      cx: (a[0]![0] + a[1]![0] + a[2]![0]) / 3,
      cy: (a[0]![1] + a[1]![1] + a[2]![1]) / 3,
      cz: (a[0]![2] + a[1]![2] + a[2]![2]) / 3,
      rgb: [col.getX(i), col.getY(i), col.getZ(i)],
    });
  }
  return out;
}
/** Green: the moss the cuts and boulders keep (linear 0.13, 0.19, 0.06): the green channel leads the red and the blue. */
const green = (f: Face) => f.rgb[1] > f.rgb[0] * 1.15 && f.rgb[1] > f.rgb[2] * 1.5;
const share = (fs: Face[], pick: (f: Face) => boolean) => {
  const total = fs.reduce((t, f) => t + f.area, 0);
  return fs.filter(pick).reduce((t, f) => t + f.area, 0) / Math.max(total, 1e-9);
};
const bbox = (model: SceneryModel, v: number) => {
  const g = model.variants[v]!;
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe("Chuckanut's bluff, parapet and cuts as baked (playtest 4 run C, punch item 7)", async () => {
  const model = await bakeRepoModel('pnwShore');

  it("the bluff's face has no green on it: the ledges were moss, 'stepped green terraces' (the cuts keep their moss)", () => {
    const bluff = faces(model, V.bluff).filter((f) => f.ny > 0.2);
    const cut = faces(model, V.rockCut[0]).filter((f) => f.ny > 0.2);
    const a = share(bluff, green);
    const c = share(cut, green);
    print(
      `[examined] faces that look up (normal over 0.2): green share ${(100 * a).toFixed(0)} % of the bluff's area (${bluff.length} faces), ${(100 * c).toFixed(0)} % of the low cut's (${cut.length})`,
    );
    // The control: the same measure finds the cut's moss, so it can see green.
    expect(c).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(0.05);
  });

  it('the bluff is a sheer face: its outer envelope falls at least 3.5 m for each metre it leans out, from the lip down', () => {
    const fs = faces(model, V.bluff);
    // How far out (-z, away from the road) the face reaches at each height, as a share of the drop so far.
    const worst: { drop: number; out: number; ratio: number }[] = [];
    for (const drop of [7, 17, 29, 40, 60]) {
      const out = Math.max(0, ...fs.filter((f) => f.cy < -drop + 4 && f.cy > -drop - 4).map((f) => -f.cz));
      if (out > 0) worst.push({ drop, out, ratio: out / drop });
    }
    print(
      `[examined] the bluff's lean at 7, 17, 29, 40 and 60 m down: ${worst.map((w) => `${w.out.toFixed(1)} m (${w.ratio.toFixed(2)})`).join(', ')}`,
    );
    expect(worst.length).toBeGreaterThan(3);
    for (const w of worst) expect(w.ratio, `at ${w.drop} m down`).toBeLessThan(0.3);
  });

  it('the bluff runs down to the water: a toe 80 m or more under the lip (the road is up to 70 m over the bay), with no shelf at it', () => {
    const box = bbox(model, V.bluff);
    const fs = faces(model, V.bluff);
    const shelf = share(
      fs.filter((f) => f.cy < -20),
      (f) => f.ny > 0.7,
    );
    print(
      `[examined] the bluff hangs ${(-box.min.y).toFixed(0)} m; flat tops below 20 m down are ${(100 * shelf).toFixed(1)} % of the face there`,
    );
    expect(box.min.y).toBeLessThan(-80);
    expect(shelf).toBeLessThan(0.05);
  });

  it('the parapet reads as a wall: at least 1.1 m tall, with a pale coping on a pale stone body (0.9 m, in tan)', () => {
    const box = bbox(model, V.parapet);
    const fs = faces(model, V.parapet);
    const lum = (f: Face) => 0.2126 * f.rgb[0] + 0.7152 * f.rgb[1] + 0.0722 * f.rgb[2];
    const mean = (pick: (f: Face) => boolean) => {
      const sel = fs.filter(pick);
      return sel.reduce((t, f) => t + lum(f) * f.area, 0) / sel.reduce((t, f) => t + f.area, 0);
    };
    // The coping: the faces that look straight up at the wall's top. The body: the faces that look along the road or at it.
    const coping = mean((f) => f.ny > 0.9 && f.cy > box.max.y - 0.05);
    const body = mean((f) => Math.abs(f.ny) < 0.2);
    print(
      `[examined] the parapet: ${box.max.y.toFixed(2)} m tall, depth ${(box.max.z - box.min.z).toFixed(2)} m; mean linear luminance of its coping ${coping.toFixed(2)}, of its sides ${body.toFixed(2)}`,
    );
    expect(box.max.y).toBeGreaterThanOrEqual(1.1);
    expect(box.max.y).toBeLessThanOrEqual(1.4);
    expect(coping).toBeGreaterThan(0.55);
    expect(body).toBeGreaterThan(0.42);
    // Its length and its depth are the file's: a run of them still lines up end to end on the hard edge.
    expect(box.max.x - box.min.x).toBeCloseTo(6, 1);
    expect(box.min.z).toBeCloseTo(-0.6, 1);
  });

  it("every variant keeps the file's triangle count (CX6's 116, 178, 62, 200, 24, 24, 178 and 120), the cut ends their section's: no triangle is added", () => {
    const tris = model.variants.map((g) => g.getAttribute('position').count / 3);
    expect(tris).toEqual([116, 178, 62, 200, 24, 24, 178, 120, 116, 116, 178, 178]);
  });

  it("there are four tapered cut ends: each of the two cuts, its low end at +x and at -x; the file's own eight stay as they were", () => {
    expect(model.variants.length).toBe(12);
    for (const [k, base] of [0, 1].entries()) {
      const full = bbox(model, base).max.y;
      for (const [plus, v] of [8 + 2 * k, 9 + 2 * k].entries()) {
        const fs = faces(model, v);
        // Height of the section at each end, by its faces' tops within 0.8 m of the end.
        const top = (side: 1 | -1) => Math.max(0, ...fs.filter((f) => f.cx * side > 2.2).map((f) => f.cy));
        const [low, high] = plus === 0 ? [top(1), top(-1)] : [top(-1), top(1)];
        expect(high, `variant ${v}'s high end`).toBeGreaterThan(full * 0.8);
        expect(low, `variant ${v}'s low end`).toBeLessThan(Math.max(1, full * 0.2));
        // The same depth as its section, so the run's face stays on one line.
        expect(bbox(model, v).min.z).toBeCloseTo(bbox(model, base).min.z, 3);
        expect(bbox(model, v).max.z).toBeCloseTo(bbox(model, base).max.z, 3);
      }
    }
  });
});

// ---- The real road's runs ----------------------------------------------------------------------------

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

describe("Chuckanut's rock cuts end in a taper (the real road, seeds 2 to 4)", async () => {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-chuckanut')!;
  const roads = network.roads.map((r) => Object.values(roadFiles).find((f) => f.id === r)!);
  const road: RoadNetwork = createRoadNetwork({ network, roads });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const { tropical, tags } = networkTags(road, dressing);
  const models: SceneryModels = {};
  for (const k of modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }))
    models[k] = await bakeRepoModel(k);
  const shore = models.pnwShore!;
  const look = createFlatLook();

  /** The runs of cut sections: consecutive 6 m sections on one side of one road. */
  function runs(items: readonly RoadsideItem[]): RoadsideItem[][] {
    const cuts = items
      .filter((i) => i.rule === 'rock-cut')
      .sort((a, b) => a.edge - b.edge || (a.d < 0 ? -1 : 1) - (b.d < 0 ? -1 : 1) || a.s - b.s);
    const out: RoadsideItem[][] = [];
    for (const c of cuts) {
      const run = out.at(-1);
      const prev = run?.at(-1);
      if (run && prev && prev.edge === c.edge && prev.d < 0 === c.d < 0 && Math.abs(c.s - prev.s - 6) < 0.01)
        run.push(c);
      else out.push([c]);
    }
    return out;
  }

  /**
   * The section's end that faces away from the run (`outward` -1 at the run's start, +1 at its end, along s), as the
   * game draws it: its height there, m, and where along the road that end lies compared with the section's middle, m.
   * The model's vertices are put in the world as the renderer puts them (+Z toward the road, turned about the vertical).
   */
  function outerEnd(
    it: RoadsideItem,
    outward: 1 | -1,
    variant = it.variant,
  ): { height: number; shift: number } {
    const g = shore.variants[variant]!;
    const pos = g.getAttribute('position');
    const cos = Math.cos(it.turn);
    const sin = Math.sin(it.turn);
    // The two end rings (x = -3 and +3): the one whose world s lies further out along the road is the outer end.
    const at = (x: number, z: number) => {
      const w = { x: it.p.x + it.size * (x * cos + z * sin), z: it.p.z + it.size * (z * cos - x * sin) };
      return nearestOnEdges(road, [it.edge], w.x, w.z)!.s;
    };
    const ends = [-3, 3].map((x) => ({ x, s: at(x, 0) }));
    const outer = ends.reduce((a, b) => (a.s * outward > b.s * outward ? a : b));
    let top = 0;
    for (let i = 0; i < pos.count; i++)
      if (pos.getX(i) * Math.sign(outer.x) > 2.9) top = Math.max(top, pos.getY(i));
    return { height: top * it.size, shift: outer.s - at(0, 0) };
  }

  it('every run of two or more sections starts and ends in a taper whose low end faces away from the run', () => {
    let runCount = 0;
    const flat: string[] = [];
    const control: number[] = [];
    for (const seed of [2, 3, 4]) {
      const scene = buildRoadScene(road, look, dressing, { seed, models, roadsideDensity: 1 });
      const items = scatterRoadside({
        road,
        dressing,
        seed,
        density: 1,
        kit: PNW_KIT,
        landReach: (e, side, s) => scene.landReach(e, side, s),
        spots: scene.spots,
        models,
      });
      for (const run of runs(items).filter((r) => r.length >= 2)) {
        runCount++;
        const first = run[0]!;
        const last = run.at(-1)!;
        for (const [it, outward] of [
          [first, -1],
          [last, 1],
        ] as const) {
          const { height: h, shift } = outerEnd(it, outward);
          expect(shift * outward, `the outer end lies outside the run's section`).toBeGreaterThan(2);
          if (h > 1)
            flat.push(
              `seed ${seed} ${road.edges[it.edge]!.id} s ${it.s.toFixed(0)} ${outward < 0 ? 'start' : 'end'}: ${h.toFixed(1)} m`,
            );
          // The control: the same end with the file's own section (variant 0 or 1, as the run was drawn before).
          control.push(outerEnd(it, outward, it.variant >= 10 ? 1 : it.variant >= 8 ? 0 : it.variant).height);
        }
        // The middle of the run is the file's own section, not a taper.
        for (const it of run.slice(1, -1)) expect(it.variant).toBeLessThan(2);
      }
      scene.dispose();
    }
    print(
      `[examined] ${runCount} runs of cut sections on 3 seeds: ${flat.length} ends stand over 1 m high (the file's own sections end ${Math.min(...control).toFixed(1)} to ${Math.max(...control).toFixed(1)} m high)`,
    );
    expect(runCount).toBeGreaterThan(30);
    expect(flat).toEqual([]);
    // The probe can see a flat end: every end of the control is the full cut.
    expect(Math.min(...control)).toBeGreaterThan(3);
  });
});
