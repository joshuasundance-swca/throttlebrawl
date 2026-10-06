// San Francisco's identity landmarks on their real baked roads (playtest 4, P4-19: "The real roads do not
// have the characteristics of the roads in question"; CX5's `sf-landmarks#sf_dragon_gate` and
// `sf-landmarks#sf_twin_spire`). Each check asserts a rule the placement must keep, on the committed GLBs
// and the baked Chinatown and North Beach network:
//   - the Dragon Gate spans Lantern Row just past the start grid, its posts stand outside the lanes and
//     are solid (a post that is drawn is a post nobody rides through), and its plaque is pack text that
//     faces a rider coming up the street;
//   - the twin-spired church stands wholly past the park's verge on the elbow's outer side, inside its own
//     footprint, on the land the road draws, and its spires stand over the roofline from the approach.
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { planBlocks } from './chinatown-northbeach';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements, LANDMARK_MID_M } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';
import type { RoadDressing } from './road-mesh';
import { SCENERY_LAND_M } from './road-mesh';
import { paintSurface, styleOfSurface, type SurfaceContext } from './text-surfaces';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<{ id: string; start: { road: string; s: number }; mainPath: string[] }>(
  '../../packs/region-sf/regions/*/routes/*.json',
  { eager: true, import: 'default' },
);
const regionFile = import.meta.glob<{
  signs?: { id: string; text: string; status?: string; tags?: string[]; note?: string }[];
}>('../../packs/region-sf/regions/san-francisco/region.json', { eager: true, import: 'default' });
const signs = Object.values(regionFile)[0]?.signs ?? [];

function track(id: string): { road: RoadNetwork; roads: BakedRoad[]; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), roads, dressing };
}

async function kitsFor(road: RoadNetwork): Promise<Map<LandmarkKitId, LandmarkKit>> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const rows = assetIndex(createPackLibrary().registry());
  const kits = new Map<LandmarkKitId, LandmarkKit>();
  for (const id of landmarkKitsFor(road)) {
    const row = rows.find((r) => r.id === landmarkKitAsset(id));
    expect(row, `${id}: an asset manifest row`).toBeDefined();
    if (!row) continue;
    const buf = fs.readFileSync(`packs/${row.packId}/assets/${row.id}.glb`);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    kits.set(id, bakeLandmarkKit(id, readGlb(data)));
  }
  return kits;
}

const net = track('sf-chinatown-northbeach');

describe("Chinatown's Dragon Gate spans Lantern Row just past the start", () => {
  const gate = landmarkPlacements(net.road).find((p) => p.node === 'sf_dragon_gate');
  const route = Object.values(routeFiles).find((r) => r.id === 'sf-chinatown-northbeach-run');

  it("stands over the main path's first road, a few seconds past the start grid, centred on the lanes", () => {
    expect(gate, 'the gate is placed').toBeDefined();
    if (!gate || !route) throw new Error('no gate or route');
    expect(gate.params.overRoad).toBe(true);
    expect(net.road.edges[gate.edge]?.id).toBe(route.start.road);
    expect(route.mainPath[0]).toBe(route.start.road);
    // A rider who starts at s 40 (the grid's front row) rides under it within 100 m.
    expect(gate.feature.s0).toBeGreaterThan(route.start.s + 2);
    expect(gate.feature.s1).toBeLessThan(route.start.s + 100);
    expect((gate.feature.d0 + gate.feature.d1) / 2).toBeCloseTo(0, 6);
  });

  it('keeps the lanes clear to a truck, stands its posts outside them, and makes the drawn posts solid', async () => {
    if (!gate) throw new Error('no gate');
    const kits = await kitsFor(net.road);
    const node = kits.get('sf-landmarks')?.nodes.get('sf_dragon_gate');
    expect(node, 'the kit has the gate').toBeDefined();
    if (!node) return;
    const road = net.road.edges[gate.edge];
    const baked = net.roads.find((r) => r.id === road?.id);
    if (!road || !baked) throw new Error('no road');
    let half = 0;
    for (const sec of baked.laneSections)
      for (const lane of sec.lanes) half = Math.max(half, Math.abs(lane.dCenterM) + lane.widthM / 2);
    const hardEdge = Math.abs(net.road.vergeAt(gate.edge, gate.feature.s0, 'right').dOuter);
    const TRUCK_M = 4.5; // a delivery truck, with margin
    const pos = node.geometry.getAttribute('position');
    const s = (gate.feature.s0 + gate.feature.s1) / 2;
    const frame = net.road.frameAt(gate.edge, s);
    // The model is turned yawDeg from the road: build its model-to-road map (x lateral, z along).
    const yaw = gate.yaw - Math.atan2(frame.tx, frame.tz);
    const posts: Record<'l' | 'r', { d0: number; d1: number; s0: number; s1: number } | undefined> = {
      l: undefined,
      r: undefined,
    };
    let inLanes = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * gate.scale;
      const y = pos.getY(i) * gate.scale;
      const z = pos.getZ(i) * gate.scale;
      // Rotating about Y by `yaw` (a turn of pi flips both x and z).
      const d = x * Math.cos(yaw) + z * Math.sin(yaw);
      const along = -x * Math.sin(yaw) + z * Math.cos(yaw);
      if (y < TRUCK_M && Math.abs(d) < half) inLanes++;
      // A post: a vertex low on the model past the lanes' edge and short of the shopfronts' hard edge.
      if (y < 6 && Math.abs(d) >= half && Math.abs(d) < hardEdge) {
        const side = d < 0 ? 'l' : 'r';
        const p = posts[side] ?? { d0: d, d1: d, s0: s + along, s1: s + along };
        p.d0 = Math.min(p.d0, d);
        p.d1 = Math.max(p.d1, d);
        p.s0 = Math.min(p.s0, s + along);
        p.s1 = Math.max(p.s1, s + along);
        posts[side] = p;
      }
    }
    expect(inLanes, `vertices below ${TRUCK_M} m inside the ${(2 * half).toFixed(1)} m lanes`).toBe(0);
    const solids = (baked.features ?? []).filter((f) => f.kind === 'hazard' && f.params?.['solid'] === true);
    for (const side of ['l', 'r'] as const) {
      const p = posts[side];
      expect(p, `the ${side} post stands between the lanes and the shopfronts`).toBeDefined();
      if (!p) continue;
      const covering = solids.filter(
        (f) => f.d0 <= p.d0 + 0.05 && f.d1 >= p.d1 - 0.05 && f.s0 <= p.s0 + 0.05 && f.s1 >= p.s1 - 0.05,
      );
      expect(
        covering.length,
        `a solid hazard covers the ${side} post (d ${p.d0.toFixed(2)} to ${p.d1.toFixed(2)}, s ${p.s0.toFixed(2)} to ${p.s1.toFixed(2)})`,
      ).toBeGreaterThan(0);
      // And it stands off the lanes (the road lint refuses one on a lane).
      for (const f of covering) expect(Math.min(Math.abs(f.d0), Math.abs(f.d1))).toBeGreaterThanOrEqual(half);
    }
    print(
      `[examined] Dragon Gate over a ${(2 * half).toFixed(1)} m road (shopfronts at ${hardEdge.toFixed(1)} m): ${pos.count} vertices, 0 below ${TRUCK_M} m in the lanes; posts at d ${posts.l?.d0.toFixed(2)}..${posts.l?.d1.toFixed(2)} and ${posts.r?.d0.toFixed(2)}..${posts.r?.d1.toFixed(2)}, each under a solid hazard`,
    );
  });

  it("paints its plaque with the pack's sign, facing a rider coming up the street, readable", async () => {
    const kits = await kitsFor(net.road);
    const layer = new LandmarkLayer(kits, look, { road: net.road });
    expect(layer.counts().skipped).toBe(0);
    const board = layer.surfaces().find((s) => s.name === 'sf_dragon_gate_plaque');
    expect(board, 'the layer hands the plaque to the text-surface layer').toBeDefined();
    if (!board || !gate) return;
    const sign = signs.find((x) => x.id === board.id);
    expect(board.id).toBe('sf-dragon-gate-plaque');
    expect(sign, `a pack sign for ${board.name}`).toBeDefined();
    expect(sign?.status).toBe('live');
    expect(sign?.tags).toEqual(expect.arrayContaining(['new', 'surface', 'site']));
    expect(sign?.note?.startsWith('NEW')).toBe(true);
    expect(sign?.text.length ?? 0).toBeGreaterThan(0);
    const frame = net.road.frameAt(gate.edge, (gate.feature.s0 + gate.feature.s1) / 2);
    const facing = board.normal.x * frame.tx + board.normal.z * frame.tz;
    expect(facing, 'the plaque faces the oncoming rider').toBeLessThan(-0.9);
    const calls: { text: string; size: number }[] = [];
    const ctx: SurfaceContext = {
      font: '',
      fillStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect() {},
      fillText(text) {
        calls.push({ text, size: Number(/(\d+)px/.exec(ctx.font)?.[1]) });
      },
      measureText(text) {
        return { width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 };
      },
    };
    const cell = { x: 0, y: 0, w: 1024, h: Math.round(1024 * (board.heightM / board.widthM)) };
    const style = styleOfSurface(board.name);
    const fit = paintSurface(ctx, cell, style, sign?.text ?? '');
    print(
      `[examined] Dragon Gate plaque ${board.widthM} x ${board.heightM} m, "${sign?.text}": letters ${fit.size} px of a ${cell.h} px cell, facing ${facing.toFixed(2)}`,
    );
    expect(calls[0]?.text).toBe(sign?.text);
    expect(fit.size).toBeGreaterThanOrEqual(cell.h / 3);
    // Its own look (gold on green), not the chalk every unnamed board gets.
    expect(style.bg).not.toBe(styleOfSurface('anything_else').bg);
  });

  it('draws in the landmark layer in one call, near the gate', async () => {
    if (!gate) throw new Error('no gate');
    const kits = await kitsFor(net.road);
    const layer = new LandmarkLayer(kits, look, { road: net.road });
    layer.update(gate.x, gate.z);
    expect(layer.counts().drawCalls).toBe(1);
    expect(layer.counts().nearPieces).toBeGreaterThan(0);
  });
});

describe('the twin-spired church stands across the park from the elbow', () => {
  const church = landmarkPlacements(net.road).find((p) => p.node === 'sf_twin_spire');

  /** Every vertex of a node, in the world, under the placement. */
  async function worldVertices(nodeName: string): Promise<{ x: number; y: number; z: number }[]> {
    if (!church) throw new Error('no church');
    const kits = await kitsFor(net.road);
    const node = kits.get('sf-landmarks')?.nodes.get(nodeName);
    if (!node) throw new Error(`no node ${nodeName}`);
    const pos = node.geometry.getAttribute('position');
    const out: { x: number; y: number; z: number }[] = [];
    const sin = Math.sin(church.yaw);
    const cos = Math.cos(church.yaw);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * church.scale;
      const z = pos.getZ(i) * church.scale;
      out.push({
        x: church.x + x * cos + z * sin,
        y: church.y + pos.getY(i) * church.scale,
        z: church.z - x * sin + z * cos,
      });
    }
    return out;
  }

  it('is placed on the elbow, with a lighter model past farM', async () => {
    expect(church, 'the church is placed').toBeDefined();
    if (!church) return;
    expect(net.road.edges[church.edge]?.id).toBe('sf-nb-the-elbow');
    expect(church.params.farM).toBeGreaterThan(0);
    const kits = await kitsFor(net.road);
    const layer = new LandmarkLayer(kits, look, { road: net.road });
    expect(layer.counts().skipped).toBe(0);
    // One piece for the church (the gate is another): its first level is the full model out to farM,
    // its second the `_lod1` out to the landmark layer's mid range.
    const tiers = layer.levels().find((t) => t[0]?.[0] === church.params.farM);
    expect(tiers, 'a piece whose near level ends at farM').toBeDefined();
    if (!tiers) return;
    expect(tiers[1]?.[0]).toBe(LANDMARK_MID_M);
    expect(tiers[1]?.[1] ?? 1e9).toBeLessThan(0.3 * (tiers[0]?.[1] ?? 0));
  });

  it("stands wholly inside its own footprint, past the park's verge, clear of every road, on drawn land", async () => {
    if (!church) throw new Error('no church');
    const verts = await worldVertices('sf_twin_spire_lod0');
    expect(verts.length).toBeGreaterThan(0);
    const f = church.feature;
    const s = (f.s0 + f.s1) / 2;
    const d = (f.d0 + f.d1) / 2;
    const c = net.road.toWorld(church.edge, s, d, 0);
    const right = net.road.toWorld(church.edge, s, d + 1, 0);
    const frame = net.road.frameAt(church.edge, s);
    let outside = 0;
    let worstGap = Infinity;
    let overLand = 0;
    let base = 0;
    for (const v of verts) {
      // Its footprint (the feature's box, in the road frame at its middle), within 0.5 m.
      const dx = v.x - c.x;
      const dz = v.z - c.z;
      const along = dx * frame.tx + dz * frame.tz;
      const across = dx * (right.x - c.x) + dz * (right.z - c.z);
      if (
        Math.abs(along) > (f.s1 - f.s0) / 2 + 0.5 ||
        Math.abs(across) > (f.d1 - f.d0) / 2 + 0.5 ||
        v.y < church.y - 4.5
      )
        outside++;
      // Clear of the nearest road by its outer verge and 3 m of grass.
      const p = net.road.project(v.x, v.z);
      const verge = Math.abs(net.road.vergeAt(p.edge, p.s, p.d < 0 ? 'left' : 'right').dOuter);
      worstGap = Math.min(worstGap, Math.abs(p.d) - verge);
      // The land: the park's strip of ground (SCENERY_LAND_M past the verge), under the foot of the nave.
      if (v.y < church.y + 0.01) {
        base++;
        if (Math.abs(p.d) - verge <= SCENERY_LAND_M) overLand++;
      }
    }
    print(
      `[examined] church: ${verts.length} vertices, ${outside} outside its ${f.s1 - f.s0} x ${f.d1 - f.d0} m footprint, nearest road ${worstGap.toFixed(1)} m past its verge, ${overLand} of ${base} foot vertices on the park's ${SCENERY_LAND_M} m strip`,
    );
    expect(outside, 'vertices outside the footprint').toBe(0);
    expect(worstGap, 'the nearest the church comes to a road, past its verge').toBeGreaterThanOrEqual(3);
    expect(base).toBeGreaterThan(0);
    expect(overLand, 'foot vertices off the land').toBe(base);
  });

  it('shows its spires over the roofline from Espresso Row, 100 to 350 m out', async () => {
    if (!church) throw new Error('no church');
    const verts = await worldVertices('sf_twin_spire_lod0');
    const top = Math.max(...verts.map((v) => v.y));
    // The two spire tips, and the belfries' tops 16 m under them (the model's towers end at 42 m).
    const tips = verts.filter((v) => v.y > top - 0.5);
    const belfries = verts.filter((v) => Math.abs(v.y - church.y - 42) < 0.3).slice(0, 8);
    expect(tips.length).toBeGreaterThan(0);
    expect(belfries.length).toBeGreaterThan(0);
    const plan = planBlocks({ road: net.road, dressing: net.dressing, seed: 7 });
    // The tallest a building of this layer stands: five storeys and a roof (chinatown-northbeach.ts).
    const TALLEST_M = 4.2 + 3.3 * 4 + 0.8 + 0.1;
    const e = net.road.edgeIndex('sf-nb-espresso-row');
    const eLen = net.road.edges[e]?.length ?? 0;
    const prisms = plan.buildings
      .filter((b) => b.edge === e || b.edge === church.edge)
      .map((b) => {
        const depth = b.district === 'park' ? 14 : 14.5 + 16;
        const corners = [
          net.road.toWorld(b.edge, b.s0, b.side * b.front, 0),
          net.road.toWorld(b.edge, b.s1, b.side * b.front, 0),
          net.road.toWorld(b.edge, b.s1, b.side * (b.front + depth), 0),
          net.road.toWorld(b.edge, b.s0, b.side * (b.front + depth), 0),
        ];
        return { corners, y: Math.min(...corners.map((p) => p.y)) };
      });
    const inside = (px: number, pz: number, poly: { x: number; z: number }[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (!a || !b) continue;
        if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) c = !c;
      }
      return c;
    };
    const blockedFrom = (
      back: number,
      target: { x: number; y: number; z: number },
      extra = prisms,
    ): boolean => {
      const p = net.road.toWorld(e, eLen - back, 0, 0);
      const cam = { x: p.x, y: p.y + 3, z: p.z };
      const len = Math.hypot(target.x - cam.x, target.z - cam.z);
      for (let k = 4; k < len - 20; k += 4) {
        const u = k / len;
        const x = cam.x + (target.x - cam.x) * u;
        const z = cam.z + (target.z - cam.z) * u;
        const y = cam.y + (target.y - cam.y) * u;
        if (extra.some((pr) => y < pr.y + TALLEST_M && inside(x, z, pr.corners))) return true;
      }
      return false;
    };
    let blocked = 0;
    let checked = 0;
    for (let back = 100; back <= 350; back += 25) {
      if (eLen - back < 0) continue;
      for (const target of [...tips.slice(0, 2), ...belfries.slice(0, 2)]) {
        if (blockedFrom(back, target)) blocked++;
        checked++;
      }
    }
    // The control: the same search is stopped by a block 25 m tall standing on the road 40 m ahead (the
    // approach runs straight at the church, so the real blocks stand beside the line, not across it).
    const ahead = net.road.toWorld(e, eLen - 40, 0, 0);
    const square = [
      { ...ahead, x: ahead.x - 6, z: ahead.z - 6 },
      { ...ahead, x: ahead.x + 6, z: ahead.z - 6 },
      { ...ahead, x: ahead.x + 6, z: ahead.z + 6 },
      { ...ahead, x: ahead.x - 6, z: ahead.z + 6 },
    ];
    for (const t of [tips[0], belfries[0]]) {
      if (!t) throw new Error('no target');
      expect(blockedFrom(100, t, [{ corners: square, y: ahead.y + 25 - TALLEST_M }]), 'the control').toBe(
        true,
      );
    }
    print(
      `[examined] ${checked} sight lines from Espresso Row (100 to 350 m before the elbow) to the spire tips and belfry tops, against ${prisms.length} building blocks at their tallest (${TALLEST_M.toFixed(1)} m): ${blocked} blocked; a 25 m block across the road blocks both test targets`,
    );
    expect(checked).toBeGreaterThan(0);
    expect(blocked, 'sight lines a building blocks').toBe(0);
  });
});
