// The railing look (playtest 3, T11.2; docs/content-packs.md, "Barriers"): a barrier with
// `look: "railing"` draws as a bridge railing (the Golden Gate's) and stays what its `kind` says to
// the sim. The road leaves the see-through barrier's solid band out; the verge layer draws a kerb,
// posts and rails in panels along it, near the camera, in the region's bridge paint.
import { Color, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type BakedBarrier, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { RAILING_DRAW_M, RAILING_OUT_M, RAILING_SEG_M, VergeLayer } from './verge';

const look = createFlatLook();

const railing: BakedBarrier = { s0: 100, s1: 300, side: 'both', kind: 'wall', heightM: 1.3, look: 'railing' };

function roadWith(barriers: BakedBarrier[], grade = 0, lengthM = 800): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'r', lengthM, kappa: 0, grade }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
  return createRoadNetwork({ network: bundle.network, roads: [{ ...road, barriers }] });
}

const meshOf = (verge: VergeLayer): InstancedMesh => {
  let found: InstancedMesh | null = null;
  verge.group.traverse((o: Object3D) => {
    if (o.name === 'verge-railing') found = o as InstancedMesh;
  });
  if (!found) throw new Error('no railing mesh');
  return found;
};

const layer = (barriers: BakedBarrier[], grade = 0, paint?: string) => {
  const road = roadWith(barriers, grade);
  return { road, verge: new VergeLayer(road, look, { tags: new Set(['bridge']), railingColour: paint }) };
};

describe('a railing look draws panels along its barrier, outside the road', () => {
  it('builds one panel per RAILING_SEG_M on each side it names, and none for a plain barrier', () => {
    const { verge } = layer([railing]);
    expect(verge.counts().railingPanels).toBe(2 * ((300 - 100) / RAILING_SEG_M));
    expect(layer([{ ...railing, look: undefined }]).verge.counts().railingPanels).toBe(0);
    expect(layer([{ ...railing, side: 'left' }]).verge.counts().railingPanels).toBe(
      (300 - 100) / RAILING_SEG_M,
    );
    expect(layer([{ ...railing, kind: 'rail' }]).verge.counts().railingPanels).toBe(
      2 * ((300 - 100) / RAILING_SEG_M),
    );
  });

  it("stands each panel on the road's own rail line, along the deck, and tilts it with the grade", () => {
    const { road, verge } = layer([{ ...railing, side: 'right' }], 0.03);
    const edge = road.edges[0];
    if (!edge) throw new Error('no edge');
    verge.update(road.toWorld(0, 150, 0, 0).x, road.toWorld(0, 150, 0, 0).z, null, 0);
    const mesh = meshOf(verge);
    expect(mesh.count).toBeGreaterThan(0);
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    const at = new Vector3().setFromMatrixPosition(m);
    // The first panel is the one starting at s 100: its middle is half a panel along, at the rail line.
    const want = road.toWorld(0, 100 + RAILING_SEG_M / 2, edge.dMax + RAILING_OUT_M, 0);
    expect(at.distanceTo(new Vector3(want.x, want.y, want.z))).toBeLessThan(0.05);
    // Its local +x (along the panel) runs along the road and climbs at the road's grade.
    const along = new Vector3(1, 0, 0).transformDirection(m);
    const a = road.toWorld(0, 100, edge.dMax + RAILING_OUT_M, 0);
    const b = road.toWorld(0, 100 + RAILING_SEG_M, edge.dMax + RAILING_OUT_M, 0);
    const want3 = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    expect(along.distanceTo(want3)).toBeLessThan(1e-3);
  });

  it('draws only the panels inside RAILING_DRAW_M of the camera, in one instanced mesh', () => {
    const { road, verge } = layer([{ ...railing, s0: 0, s1: 800 }]);
    const cam = road.toWorld(0, 400, 0, 0);
    verge.update(cam.x, cam.z, null, 0);
    const mesh = meshOf(verge);
    expect(mesh.visible).toBe(true);
    const total = verge.counts().railingPanels;
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(total);
    const m = new Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const p = new Vector3().setFromMatrixPosition(m);
      expect(Math.hypot(p.x - cam.x, p.z - cam.z)).toBeLessThanOrEqual(RAILING_DRAW_M + 1e-6);
    }
    // Far from every panel: nothing is drawn at all.
    const far = road.toWorld(0, 400, 0, 0);
    verge.update(far.x + 5000, far.z, null, 0);
    expect(meshOf(verge).visible).toBe(false);
  });

  it("paints the railing in the region's bridge paint, International Orange without one", () => {
    const colours = (v: VergeLayer): Set<string> => {
      const attr = meshOf(v).geometry.getAttribute('color');
      const out = new Set<string>();
      for (let i = 0; i < attr.count; i++)
        out.add(new Color(attr.getX(i), attr.getY(i), attr.getZ(i)).getHexString());
      return out;
    };
    expect(colours(layer([railing], 0, '#112233').verge).has(new Color('#112233').getHexString())).toBe(true);
    expect(colours(layer([railing]).verge).has(new Color('#c0452f').getHexString())).toBe(true);
  });
});

describe("the road leaves a railing look's solid band out, and the sim still sees a wall", () => {
  it('draws no rail band for it, and the same barrier without the look as before', () => {
    const road = roadWith([railing]);
    const dressing = (look: string | undefined) => ({
      r: { barriers: [{ s0: 100, s1: 300, side: 'both', kind: 'wall', heightM: 1.3, look }] },
    });
    const solid = buildRoadScene(road, look, dressing(undefined)).stats.railM;
    const see = buildRoadScene(road, look, dressing('railing')).stats.railM;
    expect(solid).toBe(2 * (300 - 100));
    expect(see).toBe(0);
  });

  it('keeps the barrier a wall to the sim: a tumble body is stopped (no railOver)', () => {
    const road = roadWith([railing]);
    expect(road.barrierAt(0, 200, 'left')).toEqual({ kind: 'wall', heightM: 1.3 });
    expect(road.barrierAt(0, 200, 'right')).toEqual({ kind: 'wall', heightM: 1.3 });
  });
});
