// The committed Blender models gate here, because CI has no Blender (tools/blender/README.md):
// every GLB in the catalog exists, is small, passes every score check, and loads in three's own
// GLTFLoader with the node names the game will look up. The score guards are also shown to fire
// on bad input, so a green run means the checks looked at something.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import type { Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { ASSET_ROOT, glbPath, PROPS } from './catalog.mjs';
import { parseGlb, scoreGlb } from './score.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel));
type Prop = (typeof PROPS)[number];

/** Rewrites a GLB's JSON chunk (keeps the binary chunk), for the negative tests. */
function patchGlb(buf: Buffer, edit: (gltf: { nodes: { name?: string }[] }) => void): Buffer {
  const { gltf } = parseGlb(buf) as { gltf: { nodes: { name?: string }[] } };
  edit(gltf);
  const oldLen = buf.readUInt32LE(12);
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const rest = buf.subarray(20 + oldLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, json, rest]);
}

function loadInThree(buf: Buffer): Promise<Object3D> {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', (g) => resolve(g.scene), reject);
  });
}

describe('the Blender model catalog', () => {
  it('names a script and a unique kebab-case asset id per prop', () => {
    const ids = PROPS.map((p) => p.asset);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROPS) {
      expect(p.asset).toMatch(/^models\/(props|scenery|bikes)\/[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(existsSync(path.join(repoRoot, 'tools/blender', p.script)), p.script).toBe(true);
    }
  });

  it('has no GLB in the pack that the catalog does not list', () => {
    const dir = path.join(repoRoot, ASSET_ROOT, 'models');
    const found = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.glb'))
      .map((e) => path.relative(repoRoot, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .sort();
    expect(found).toEqual(PROPS.map((p) => glbPath(p)).sort());
  });
});

describe.each(PROPS.map((p) => [p.name, p] as [string, Prop]))('model %s', (_name, prop) => {
  const file = glbPath(prop);

  it('is committed and under the 1 MB size check', () => {
    expect(existsSync(path.join(repoRoot, file)), file).toBe(true);
    expect(statSync(path.join(repoRoot, file)).size).toBeLessThan(1024 * 1024);
  });

  it('passes every score check (budgets, names, flat materials, geometry rules)', () => {
    const res = scoreGlb(read(file), prop);
    const failed = res.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(res.checks.length).toBeGreaterThanOrEqual(15);
  });

  it("loads in three's GLTFLoader with its named nodes", async () => {
    const scene = await loadInThree(read(file));
    const names = new Set<string>();
    let meshes = 0;
    scene.traverse((o) => {
      names.add(o.name);
      if ((o as Mesh).isMesh) meshes++;
    });
    const roots =
      prop.kind === 'variants'
        ? prop.variants!.roots
        : prop.kind === 'boat'
          ? [prop.boat!.root, prop.boat!.hull, 'probe_bow', 'probe_stern', 'probe_port', 'probe_starboard']
          : prop.kind === 'single'
            ? [prop.single!.root, ...prop.single!.nodes]
            : ['tow_truck', 'cab', 'trailer', 'ramp_surface'];
    for (const n of roots) expect(names.has(n), n).toBe(true);
    expect(meshes).toBeGreaterThan(0);
    for (const t of prop.textSurfaces ?? []) {
      const panel = scene.getObjectByName(t) as Mesh | undefined;
      expect(panel?.geometry.getAttribute('uv'), `${t} has UVs`).toBeDefined();
      expect(panel?.userData['text_surface'], `${t} extras`).toBe(true);
    }
    if (prop.variants?.sway) {
      // three lower-cases custom glTF attributes: the vertex shader reads `_sway`. A mesh with
      // two materials loads as a group of one three.js mesh per primitive, so check each.
      for (const v of prop.variants.roots)
        for (const part of prop.variants.parts) {
          const node = scene.getObjectByName(`${v}_${part}`);
          const parts: Mesh[] = [];
          node?.traverse((o) => {
            if ((o as Mesh).isMesh) parts.push(o as Mesh);
          });
          expect(parts.length, `${v}_${part} meshes`).toBeGreaterThan(0);
          for (const m of parts) expect(m.geometry.getAttribute('_sway'), `${v}_${part} _sway`).toBeDefined();
        }
    }
  });

  if (prop.asset.startsWith('models/bikes/')) {
    it('has grounded axle pivots, rider targets and a connected steering assembly', async () => {
      const scene = await loadInThree(read(file));
      scene.updateMatrixWorld(true);
      const bike = scene.getObjectByName('bike')!;
      const fork = scene.getObjectByName('fork')!;
      const front = scene.getObjectByName('wheel_front')!;
      const rear = scene.getObjectByName('wheel_rear')!;
      const position = (o: Object3D) => o.getWorldPosition(new Vector3());
      const fp = position(front);
      const rp = position(rear);
      expect(position(bike).length()).toBeLessThan(0.0001);
      expect(fp.z).toBeGreaterThan(0);
      expect(rp.z).toBeLessThan(0);
      expect(fp.z + rp.z).toBeCloseTo(0, 5);
      expect(fp.z - rp.z).toBeCloseTo(bike.userData['wheelbase_m'] as number, 5);
      expect(position(scene.getObjectByName('seat_anchor')!).y).toBeCloseTo(
        bike.userData['seat_height_m'] as number,
        5,
      );
      expect(['rat', 'sport', 'super', 'chopper', 'dirt', 'scooter']).toContain(bike.userData['class']);
      expect(front.parent).toBe(fork);
      for (const side of ['l', 'r']) {
        expect(scene.getObjectByName(`bar_${side}`)!.parent).toBe(fork);
        expect(position(scene.getObjectByName(`peg_${side}`)!).y).toBeGreaterThan(0.2);
      }
      expect(position(scene.getObjectByName('bar_l')!).x).toBeGreaterThan(0);
      expect(position(scene.getObjectByName('bar_r')!).x).toBeLessThan(0);
      const wheels = ['wheel_front', 'wheel_rear_l', 'wheel_rear_r'];
      if (!scene.getObjectByName('wheel_rear_l')) wheels.push('wheel_rear');
      for (const name of wheels) {
        const wheel = scene.getObjectByName(name);
        if (!wheel) continue;
        const box = new Box3().setFromObject(wheel);
        const p = position(wheel);
        expect(box.min.y).toBeCloseTo(0, 4);
        expect((box.min.y + box.max.y) / 2).toBeCloseTo(p.y, 4);
        expect((box.min.z + box.max.z) / 2).toBeCloseTo(p.z, 4);
        expect(wheel.scale.toArray()).toEqual([1, 1, 1]);
        expect(wheel.quaternion.x).toBeCloseTo(0, 5);
        expect(wheel.quaternion.y).toBeCloseTo(0, 5);
        expect(wheel.quaternion.z).toBeCloseTo(0, 5);
      }
      expect(scoreGlb(read(file), prop).counts.triangles).toBeGreaterThanOrEqual(600);
    });
  }
});

describe('the score guards fire', () => {
  const truck = PROPS.find((p) => p.name === 'tow_truck')!;
  const boat = PROPS.find((p) => p.name === 'boat')!;
  const signs = PROPS.find((p) => p.name === 'road_signs')!;

  it('on a budget the model does not meet', () => {
    const res = scoreGlb(read(glbPath(truck)), { ...truck, budget: { tris: 100, draws: 2, materials: 1 } });
    expect(res.summary.failed).toEqual(
      expect.arrayContaining(['tris_budget', 'draws_budget', 'materials_budget']),
    );
  });

  it('on a missing ramp, and on a boat wider than its hull', () => {
    const noRamp = patchGlb(read(glbPath(truck)), (g) => {
      for (const n of g.nodes) if (n.name === 'ramp_surface') n.name = 'ramp_deck';
    });
    expect(scoreGlb(noRamp, truck).summary.failed).toEqual(
      expect.arrayContaining(['required_nodes', 'ramp_measured']),
    );
    const res = scoreGlb(read(glbPath(boat)), { ...boat, boat: { ...boat.boat!, maxOverhangM: 0 } });
    expect(res.summary.failed).toContain('nothing_sticks_out_past_hull');
  });

  it('on a text surface that lost its extras, and on non-snake-case names', () => {
    const bad = patchGlb(read(glbPath(signs)), (g) => {
      for (const n of g.nodes as { name?: string; extras?: unknown }[]) {
        if (n.name === 'sign_a_face') n.extras = {};
        if (n.name === 'sign_b') n.name = 'Sign-B';
      }
    });
    const failed = scoreGlb(bad, signs).summary.failed;
    expect(failed).toEqual(expect.arrayContaining(['sign_a_face_text_surface', 'names_snake_case']));
  });
});
