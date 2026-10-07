// The structures' parity audit for San Francisco's districts (the maintainer, 2026-10-06, [decided]: "consistent
// physics and gameplay is important here so players know what to expect and how to interact with the world"):
// every structure of the plan against what render draws for it, and every drawn roof against the plan, so a
// rider meets what he sees and sees what he meets. It is the twin of scripts/hitboxes.test.ts (which holds the
// fixed model boxes to their files): it lives under scripts/ because it reads both sides, the road's plan and
// render's drawn soups, which no module may import together (docs/architecture.md, module map).
//
// The check: each structure's roof corners (and a front's bottom corners) are vertices of the drawn geometry,
// within a stated tolerance; each drawn roof quad stands in a structure whose top is its height, within the same
// tolerance. Negative controls: a structure moved, raised or resized, and one missing, are found.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  planStructures,
  structuresAt,
  topAt,
  type RoadNetwork,
  type Structure,
  type StructurePlan,
} from '../src/road';
import type { BakedNetwork, BakedRoad } from '../src/road';
import { blocksPlanner } from '../src/road/structures/chinatown-northbeach';
import { missionPlanner, ROOF_TOL_M } from '../src/road/structures/mission';
import { BLOCK_COLOURS, planBlocks } from '../src/render/chinatown-northbeach';
import { MISSION_COLOURS, planMission } from '../src/render/mission';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): RoadNetwork {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network, roads });
}

interface Soup {
  pos: number[];
  col: number[];
}
interface V {
  x: number;
  y: number;
  z: number;
}

/** The tolerance a drawn corner may be from its box's, per district, m. Blocks draws its boxes exactly. */
const BLOCKS_TOL_M = 0.02;
/**
 * A drawn roof corner is under a box grown by this much, m. A side street's frame is not quite square (its two
 * axes are measured apart), so its lots' corners are a centimetre off a rectangle.
 */
const BLOCKS_GROW_M = 0.05;
/**
 * The Mission's walls follow the road, so a run of boxes is a chord with the road's own curve within
 * FOOT_TOL_M of it (road/structures/mission.ts): every drawn roof corner is under a box (grown 5 cm) whose top
 * is within ROOF_TOL_M plus 5 cm of the roof there, and a box corner is within 1 m of a drawn roof vertex (the
 * most a box sticks out of the fan of a turn).
 */
const MISSION_XZ_TOL_M = 1;
/** A drawn corner of a roof is under a box grown by this much, m. */
const MISSION_GROW_M = 0.05;
const MISSION_Y_TOL_M = ROOF_TOL_M + 0.05;

const hexOf = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A grid of every vertex of some soups, for "is there a drawn vertex near this point". */
class Verts {
  private readonly cells = new Map<string, V[]>();
  private static readonly CELL = 1;
  constructor(soups: Iterable<Soup>) {
    for (const s of soups)
      for (let i = 0; i + 2 < s.pos.length; i += 3) {
        const v = { x: s.pos[i] ?? 0, y: s.pos[i + 1] ?? 0, z: s.pos[i + 2] ?? 0 };
        const k = `${Math.floor(v.x / Verts.CELL)},${Math.floor(v.z / Verts.CELL)}`;
        const list = this.cells.get(k);
        if (list) list.push(v);
        else this.cells.set(k, [v]);
      }
  }
  /** Whether a drawn vertex lies within `xz` m (on the ground) and `y` m (up) of the point. */
  near(x: number, y: number, z: number, xz: number, ty: number): boolean {
    const i0 = Math.floor((x - xz) / Verts.CELL);
    const i1 = Math.floor((x + xz) / Verts.CELL);
    const j0 = Math.floor((z - xz) / Verts.CELL);
    const j1 = Math.floor((z + xz) / Verts.CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (const v of this.cells.get(`${i},${j}`) ?? [])
          if (Math.abs(v.x - x) <= xz && Math.abs(v.z - z) <= xz && Math.abs(v.y - y) <= ty) return true;
    return false;
  }
}

/** A footprint's four corners, world metres. */
function corners(s: Structure): { x: number; z: number }[] {
  const f = s.foot;
  const out: { x: number; z: number }[] = [];
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const)
    out.push({
      x: f.x + f.ux * f.hu * a - f.uz * f.hv * b,
      z: f.z + f.uz * f.hu * a + f.ux * f.hv * b,
    });
  return out;
}
const topOf = (s: Structure): number => {
  if (s.roof.kind !== 'flat') throw new Error('flat roofs only here');
  return s.baseY + s.roof.topM;
};

/**
 * Structures whose roof corners are not drawn: for each, how many of its four top corners have no drawn vertex
 * (`need` of them must). A rail is drawn as its front face only: two corners.
 */
function missingCorners(
  items: readonly Structure[],
  verts: Verts,
  xz: number,
  ty: number,
  needFor: (s: Structure) => number,
): { s: Structure; found: number }[] {
  const out: { s: Structure; found: number }[] = [];
  for (const s of items) {
    const top = topOf(s);
    const found = corners(s).filter((c) => verts.near(c.x, top, c.z, xz, ty)).length;
    if (found < needFor(s)) out.push({ s, found });
  }
  return out;
}

/** A drawn roof quad: its four corners (and the mean of them), from two consecutive triangles of a soup. */
interface Quad {
  x: number;
  z: number;
  y: number;
  corners: V[];
}

/** The drawn roof quads of some soups: up-facing, in the roof colour. */
function roofQuads(soups: Iterable<Soup>, roof: string): Quad[] {
  const [rr, gg, bb] = hexOf(roof);
  const out: Quad[] = [];
  for (const s of soups) {
    const tris: { v: V[]; ok: boolean }[] = [];
    for (let t = 0; t < s.pos.length / 9; t++) {
      const p = s.pos.slice(t * 9, t * 9 + 9);
      const same =
        Math.abs((s.col[t * 9] ?? 0) - rr) < 1e-6 &&
        Math.abs((s.col[t * 9 + 1] ?? 0) - gg) < 1e-6 &&
        Math.abs((s.col[t * 9 + 2] ?? 0) - bb) < 1e-6;
      const ux = p[3]! - p[0]!;
      const uy = p[4]! - p[1]!;
      const uz = p[5]! - p[2]!;
      const vx = p[6]! - p[0]!;
      const vy = p[7]! - p[1]!;
      const vz = p[8]! - p[2]!;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      tris.push({
        v: [0, 3, 6].map((k) => ({ x: p[k]!, y: p[k + 1]!, z: p[k + 2]! })),
        ok: same && len > 1e-9 && Math.abs(ny / len) > 0.9,
      });
    }
    // A quad is two consecutive triangles.
    for (let i = 0; i + 1 < tris.length; i += 2) {
      const a = tris[i]!;
      const b = tris[i + 1]!;
      if (!a.ok || !b.ok) continue;
      const corners = [...a.v, ...b.v];
      const n = corners.length;
      out.push({
        x: corners.reduce((m, c) => m + c.x, 0) / n,
        y: corners.reduce((m, c) => m + c.y, 0) / n,
        z: corners.reduce((m, c) => m + c.z, 0) / n,
        corners,
      });
    }
  }
  return out;
}

/** Whether a structure stands under a point, its footprint grown by `grow` m, with its top within `ty` of `y`. */
function covers(plan: StructurePlan, v: V, grow: number, ty: number): boolean {
  const probes = [[0, 0]];
  for (const dx of [-grow, 0, grow]) for (const dz of [-grow, 0, grow]) probes.push([dx, dz]);
  for (const [dx, dz] of probes) {
    for (const s of structuresAt(plan, v.x + (dx as number), v.z + (dz as number))) {
      const top = topAt(s, v.x + (dx as number), v.z + (dz as number));
      if (top !== null && Math.abs(top - v.y) <= ty) return true;
    }
  }
  return false;
}

/** The drawn roof quads with a corner no structure stands under at its height: a drawn roof the plan lacks. */
function orphanRoofs(quads: readonly Quad[], plan: StructurePlan, grow: number, ty: number): Quad[] {
  return quads.filter((q) => !q.corners.every((c) => covers(plan, c, grow, ty)));
}

/** A plan whose structures are these (a control's doctored copy), planned under a seed of its own. */
let controls = 0;
function planOf(road: RoadNetwork, items: readonly Structure[], tag: string): StructurePlan {
  const layer = { tags: [tag], load: () => Promise.reject(new Error('a control plans its own structures')) };
  const planner = {
    plan: (_r: RoadNetwork, _seed: number, out: { add(s: Structure): number }) =>
      items.forEach((s) => out.add(s)),
  };
  return planStructures(road, 4242 + controls++, { control: planner }, { control: layer });
}

const SEED = 7;

describe("Chinatown and North Beach: every structure is a box that is drawn, every drawn roof a structure's top", () => {
  const road = track('sf-chinatown-northbeach');
  const plan = planStructures(road, SEED, { 'chinatown-northbeach': blocksPlanner });
  const drawn = planBlocks({ road, seed: SEED });
  const near = [...drawn.near.values()];
  const all = [...near, ...drawn.far.values()];
  const verts = new Verts(all);
  const needs = (s: Structure) => (s.rule === 'patio-rail' ? 2 : 4);

  it('every structure has its roof corners among the drawn vertices, within 2 cm', () => {
    const missing = missingCorners(plan.items, verts, BLOCKS_TOL_M, BLOCKS_TOL_M, needs);
    print(
      `[examined] ${plan.items.length} structures against ${all.length} drawn soups: ${missing.length} with a roof corner not drawn`,
    );
    expect(plan.items.length).toBeGreaterThan(2000);
    expect(missing.map((m) => `${m.s.rule} ${m.s.id} (${m.found})`)).toEqual([]);
  });

  it("every drawn roof quad (the fronts', back rows', side streets' and park's) stands under a structure at its height, within 5 cm", () => {
    const quads = roofQuads(near, BLOCK_COLOURS.roof);
    const orphans = orphanRoofs(quads, plan, BLOCKS_GROW_M, BLOCKS_TOL_M);
    print(`[examined] ${quads.length} drawn roof quads: ${orphans.length} with no structure under them`);
    expect(quads.length).toBeGreaterThan(1300);
    expect(orphans).toEqual([]);
  });

  it('control: a structure moved 0.5 m, raised 1 m or made 20 % longer is found, and so is a missing one', () => {
    const items = plan.items.slice(0, 600);
    const pick = (rule: string) => items.find((s) => s.rule === rule) as Structure;
    const front = pick('lanterns-front');
    const swap = (s: Structure, patch: Partial<Structure>): Structure[] =>
      items.map((x) => (x.id === s.id ? { ...x, ...patch } : x));
    const check = (list: Structure[]) =>
      missingCorners(list, verts, BLOCKS_TOL_M, BLOCKS_TOL_M, needs).map((m) => m.s.id);
    expect(check(items)).toEqual([]);
    expect(check(swap(front, { foot: { ...front.foot, x: front.foot.x + 0.5 } }))).toEqual([front.id]);
    if (front.roof.kind !== 'flat') throw new Error('flat');
    expect(check(swap(front, { roof: { kind: 'flat', topM: front.roof.topM + 1 } }))).toEqual([front.id]);
    expect(check(swap(front, { foot: { ...front.foot, hu: front.foot.hu * 1.2 } }))).toEqual([front.id]);
    // A missing structure leaves its roof with nothing under it.
    const roof = roofQuads(near, BLOCK_COLOURS.roof).find((q) => structuresAt(plan, q.x, q.z).length === 1);
    if (!roof) throw new Error('no roof');
    const gone = structuresAt(plan, roof.x, roof.z)[0] as Structure;
    const without = planOf(
      road,
      plan.items.filter((s) => s.id !== gone.id),
      'lanterns',
    );
    expect(orphanRoofs([roof], without, BLOCKS_GROW_M, BLOCKS_TOL_M).length).toBe(1);
    expect(orphanRoofs([roof], plan, BLOCKS_GROW_M, BLOCKS_TOL_M).length).toBe(0);
  });
});

describe("The Mission: every structure is a box that is drawn, every drawn roof a structure's top", () => {
  const road = track('sf-mission');
  const plan = planStructures(road, SEED, { mission: missionPlanner });
  const drawn = planMission({ road, seed: SEED });
  const soups = [...drawn.soups.values()];
  const verts = new Verts(soups);
  const notPlank = (s: Structure) => s.rule !== 'scaffold-plank';

  it('every wall box has its roof corners within 1 m of a drawn roof vertex, and its top within 0.3 m of the roof there', () => {
    const walls = plan.items.filter(notPlank);
    const missing = missingCorners(walls, verts, MISSION_XZ_TOL_M, MISSION_Y_TOL_M, () => 4);
    let worst = 0;
    for (const s of walls) {
      const top = topOf(s);
      for (const c of corners(s)) {
        let best = Infinity;
        for (let r = 0.05; r <= MISSION_XZ_TOL_M + 1e-9; r += 0.05)
          if (verts.near(c.x, top, c.z, r, MISSION_Y_TOL_M)) {
            best = r;
            break;
          }
        if (best < Infinity) worst = Math.max(worst, best);
      }
    }
    print(
      `[examined] ${walls.length} wall boxes: the farthest a corner is from a drawn roof vertex, about ${worst.toFixed(2)} m; ${missing.length} missing`,
    );
    expect(missing.map((m) => `${m.s.rule} ${m.s.id} (${m.found})`)).toEqual([]);
  });

  it("every scaffold plank is drawn: its eight corners are the plank box's, within 2 cm", () => {
    const planks = plan.items.filter((s) => !notPlank(s));
    expect(planks.length).toBeGreaterThan(100);
    const missing = missingCorners(planks, verts, BLOCKS_TOL_M, BLOCKS_TOL_M, () => 4);
    expect(missing.map((m) => m.s.id)).toEqual([]);
    for (const p of planks) {
      const base = p.baseY;
      const found = corners(p).filter((c) => verts.near(c.x, base, c.z, BLOCKS_TOL_M, BLOCKS_TOL_M)).length;
      expect(found, `plank ${p.id} underside`).toBe(4);
    }
  });

  it("every drawn roof quad stands under a wall box whose top is its height, within the roof's tolerance", () => {
    const quads = roofQuads(soups, MISSION_COLOURS.roof);
    const orphans = orphanRoofs(quads, plan, MISSION_GROW_M, MISSION_Y_TOL_M);
    print(
      `[examined] ${quads.length} drawn roof quads of 2 m: ${orphans.length} with no wall box under them`,
    );
    expect(quads.length).toBeGreaterThan(2000);
    expect(orphans).toEqual([]);
  });

  it('control: a wall box moved 3 m, or raised 1 m, is found; a missing one leaves its roof without a structure', () => {
    const walls = plan.items.filter(notPlank);
    const one = walls[10] as Structure;
    const swap = (patch: Partial<Structure>) => walls.map((x) => (x.id === one.id ? { ...x, ...patch } : x));
    const check = (list: Structure[]) =>
      missingCorners(list, verts, MISSION_XZ_TOL_M, MISSION_Y_TOL_M, () => 4).map((m) => m.s.id);
    expect(check(walls)).toEqual([]);
    expect(check(swap({ foot: { ...one.foot, x: one.foot.x + 3 } }))).toEqual([one.id]);
    if (one.roof.kind !== 'flat') throw new Error('flat');
    expect(check(swap({ roof: { kind: 'flat', topM: one.roof.topM + 1 } }))).toEqual([one.id]);
    const roof = roofQuads(soups, MISSION_COLOURS.roof).find(
      (q) => structuresAt(plan, q.x, q.z).length === 1,
    );
    if (!roof) throw new Error('no roof');
    const gone = structuresAt(plan, roof.x, roof.z)[0] as Structure;
    const without = planOf(
      road,
      plan.items.filter((s) => s.id !== gone.id),
      'murals',
    );
    expect(orphanRoofs([roof], without, MISSION_GROW_M, MISSION_Y_TOL_M).length).toBe(1);
  });
});

describe('the planners depend on nothing that loads or is drawn', () => {
  const files = ['chinatown-northbeach', 'mission'].map((name) => `src/road/structures/${name}.ts`);
  const importsOf = (source: string) =>
    [...source.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1] as string);
  const forbidden = /\b(landReach|roadsideDensity|stacked|dressing)\b/;

  it('imports only road modules (no render, sim, three or loaded model) and names no drawn input', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const imports = importsOf(source);
      print(`[examined] ${file}: imports ${imports.join(', ')}`);
      expect(imports.length).toBeGreaterThan(1);
      for (const from of imports)
        expect(from, `${file} imports ${from}`).toMatch(/^\.\.?\/(network|structures|themes)$/);
      // (Its comments may name them: the code may not.)
      expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(forbidden);
    }
  });

  it('control: the check reads imports (a render import is found) and the words it forbids', () => {
    expect(
      importsOf("import { x } from '../../render/models';\nimport type { y } from '../network';"),
    ).toEqual(['../../render/models', '../network']);
    expect('const stacked = true;').toMatch(forbidden);
  });
});
