#!/usr/bin/env node
// Scores one prop GLB against its catalog row: budgets, names, flat materials and the
// prop-specific geometry rules (ported from the 2026-09-30 prop-trial harness). Plain Node, no
// dependencies, so CI runs it on the committed GLBs (models.test.ts) without Blender.
//
//   node tools/blender/score.mjs                 score every committed GLB in the catalog
//   node tools/blender/score.mjs boat palms      score some of them
//   node tools/blender/score.mjs --glb x.glb --prop boat   score a GLB built elsewhere
//   add --json to print the full result, --validate to also run the Khronos validator through
//   `npx @gltf-transform/cli` (needs the npm registry; skipped with a note when it is offline)
//
// Counts come from parsing the GLB directly. Draw calls are DERIVED, not measured:
//   draws_naive        one draw per primitive per mesh node, as three's GLTFLoader loads it
//   draws_instanced    one draw per primitive per UNIQUE mesh (nodes sharing a mesh can instance)
//   draws_merged_floor distinct materials (the floor if the game merges a static prop per material)
// The budgets in catalog.mjs are on draws_instanced.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasLayoutPath, DOUBLE_SIDED_ROLES, glbPath, PROPS, ROLES } from './catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(HERE, '../..');
const ROLE_SET = new Set(ROLES);
const SNAKE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const r3 = (v) => Math.round(v * 1000) / 1000;
const deg = (r) => (r * 180) / Math.PI;

// ---------------------------------------------------------------- GLB parsing
/**
 * Parses a GLB buffer into {gltf, bin}. Throws on a malformed container.
 * @param {Buffer} buf
 * @returns {{gltf: any, bin: Buffer | null}}
 */
export function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error(`GLB version ${buf.readUInt32LE(4)}, expected 2`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  const off = 20 + jsonLen;
  if (off + 8 <= buf.length) bin = buf.subarray(off + 8, off + 8 + buf.readUInt32LE(off));
  return { gltf, bin };
}

const COMP = {
  5120: [1, 'getInt8'],
  5121: [1, 'getUint8'],
  5122: [2, 'getInt16'],
  5123: [2, 'getUint16'],
  5125: [4, 'getUint32'],
  5126: [4, 'getFloat32'],
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessorReader(gltf, bin) {
  return (idx) => {
    const acc = gltf.accessors[idx];
    const n = NCOMP[acc.type];
    const [size, getter] = COMP[acc.componentType];
    const out = new Array(acc.count * n);
    if (acc.bufferView === undefined) return out.fill(0);
    const bv = gltf.bufferViews[acc.bufferView];
    const stride = bv.byteStride || size * n;
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < acc.count; i++)
      for (let c = 0; c < n; c++) out[i * n + c] = dv[getter](base + i * stride + c * size, true);
    return out;
  };
}

// ---------------------------------------------------------------- math (column-major 4x4)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function bbox(pts) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], p[c]);
      hi[c] = Math.max(hi[c], p[c]);
    }
  return { min: lo.map(r3), max: hi.map(r3), size: hi.map((h, c) => r3(h - lo[c])) };
}
const inRange = (v, [lo, hi]) => v >= lo && v <= hi;

// ---------------------------------------------------------------- scoring
/**
 * @typedef {{id: string, pass: boolean, detail: string}} Check
 * @typedef {object} Score
 * @property {string} prop
 * @property {number} bytes
 * @property {{triangles: number, materials_used: number}} counts
 * @property {{draws_naive: number, draws_instanced: number, draws_merged_floor: number}} draws
 * @property {Check[]} checks
 * @property {{passed: number, total: number, failed: string[]}} summary
 * @typedef {{tiles: Record<string, {rect: [number, number, number, number]}>}} AtlasLayout
 *   The part of tools/atlas's `<sheet>-layout.json` the score reads: each tile's inner rect in UV
 *   units, [u0, v0, u1, v1], gutter excluded
 */

const VEHICLE_EXTRAS = [
  'length_m',
  'width_m',
  'height_m',
  'wheelbase_m',
  'hood_top_m',
  'hood_front_m',
  'hood_back_m',
];
const VEHICLE_CLASSES = ['car', 'truck', 'bus', 'trailer'];
const VEHICLE_NODES = [
  'vehicle',
  'vehicle_body',
  'hood',
  'light_head_l',
  'light_head_r',
  'light_tail_l',
  'light_tail_r',
];
/** Within `tol` as a share of `want` (sizes and lengths). */
const within = (got, want, tol) => Math.abs(got - want) <= tol * Math.abs(want);

/**
 * Reads an atlas sheet's layout JSON for a prop, or null when it is missing or unreadable.
 * @param {import('./catalog.mjs').Prop} prop
 * @returns {AtlasLayout | null}
 */
function readAtlasLayout(prop) {
  const rel = atlasLayoutPath(prop);
  if (!rel || !existsSync(path.join(repoRoot, rel))) return null;
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Scores a parsed GLB against a catalog row. Returns the counts, the derived draws and a list
 * of {id, pass, detail} checks; nothing is weighted into one number.
 * @param {Buffer} buf
 * @param {import('./catalog.mjs').Prop} prop
 * @param {{atlasLayout?: AtlasLayout | null}} [opts]  `atlasLayout` stands in for the sheet's
 *   layout JSON (null: there is none); left out, a row with an atlas reads it from its pack
 * @returns {Score}
 */
export function scoreGlb(buf, prop, opts = {}) {
  const { gltf, bin } = parseGlb(buf);
  const read = accessorReader(gltf, bin);
  const nodes = gltf.nodes || [];
  const meshesDef = gltf.meshes || [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
  const world = new Map();
  const inst = [];
  (function walk(list, pm, ancestors) {
    for (const i of list) {
      const n = nodes[i];
      const m = mul(pm, trs(n));
      world.set(i, m);
      const anc = [...ancestors, n.name ?? `node_${i}`];
      if (n.mesh !== undefined)
        inst.push({ node: i, name: n.name ?? `node_${i}`, mesh: n.mesh, world: m, ancestors: anc });
      walk(n.children || [], m, anc);
    }
  })(roots, I4(), []);

  const primTris = (p) => {
    const mode = p.mode ?? 4;
    const count =
      p.indices !== undefined ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count;
    if (mode === 4) return Math.floor(count / 3);
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    return 0;
  };
  const worldVerts = (ins) => {
    const out = [];
    for (const p of meshesDef[ins.mesh].primitives) {
      const pos = read(p.attributes.POSITION);
      for (let k = 0; k < pos.length; k += 3) out.push(xf(ins.world, [pos[k], pos[k + 1], pos[k + 2]]));
    }
    return out;
  };
  const worldTris = (ins) => {
    const tris = [];
    for (const p of meshesDef[ins.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) continue;
      const pos = read(p.attributes.POSITION);
      const P = (k) => xf(ins.world, [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
      const idx = p.indices !== undefined ? read(p.indices) : [...Array(pos.length / 3).keys()];
      for (let t = 0; t + 2 < idx.length; t += 3) tris.push([P(idx[t]), P(idx[t + 1]), P(idx[t + 2])]);
    }
    return tris;
  };

  let tris = 0;
  let drawsNaive = 0;
  const usedMeshes = new Set();
  const usedMats = new Set();
  for (const i of inst) {
    usedMeshes.add(i.mesh);
    for (const p of meshesDef[i.mesh].primitives) {
      tris += primTris(p);
      drawsNaive += 1;
      if (p.material !== undefined) usedMats.add(p.material);
    }
  }
  let drawsInstanced = 0;
  for (const m of usedMeshes) drawsInstanced += meshesDef[m].primitives.length;
  const box = bbox(inst.flatMap(worldVerts));
  const materials = (gltf.materials || []).map((m, i) => ({
    name: m.name ?? null,
    role_ok: ROLE_SET.has(m.name ?? ''),
    has_texture: JSON.stringify(m).includes('"index"'),
    alphaMode: m.alphaMode ?? 'OPAQUE',
    metallic: m.pbrMetallicRoughness?.metallicFactor ?? 1,
    baseColor: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
    emissive:
      (m.emissiveFactor ?? [0, 0, 0]).some((c) => c > 0) || !!m.extensions?.KHR_materials_emissive_strength,
    doubleSided: !!m.doubleSided,
    used: usedMats.has(i),
  }));
  const nodeNames = nodes.map((n) => n.name ?? null);
  const dupNames = [...new Set(nodeNames.filter((n, i) => n && nodeNames.indexOf(n) !== i))];
  const badNames = [
    ...nodeNames,
    ...materials.map((m) => m.name),
    ...meshesDef.map((m) => m.name ?? null),
  ].filter((n) => !n || !SNAKE.test(n));
  const scaled = nodes
    .filter((n) => n.scale && n.scale.some((s) => Math.abs(s - 1) > 1e-4))
    .map((n) => n.name);
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const instOf = (name) => inst.filter((x) => x.name === name);
  const subtreeInst = (rootName) => inst.filter((x) => x.ancestors.includes(rootName));
  const nodeWorldPos = (name) =>
    byName.has(name) ? world.get(byName.get(name)).slice(12, 15).map(r3) : null;
  const extrasOf = (name) => (byName.has(name) ? (nodes[byName.get(name)].extras ?? {}) : {});

  const checks = [];
  const check = (id, pass, detail) => checks.push({ id, pass: !!pass, detail });
  const result = {
    prop: prop.name,
    asset: prop.asset,
    bytes: buf.length,
    generator: gltf.asset?.generator ?? null,
    counts: {
      nodes: nodes.length,
      mesh_nodes: inst.length,
      meshes_unique: usedMeshes.size,
      triangles: tris,
      materials: (gltf.materials || []).length,
      materials_used: usedMats.size,
      textures: (gltf.textures || []).length,
      images: (gltf.images || []).length,
    },
    draws: { draws_naive: drawsNaive, draws_instanced: drawsInstanced, draws_merged_floor: usedMats.size },
    bbox: box,
    materials: materials.map((m) => m.name),
  };

  // ---- every prop
  const B = prop.budget;
  check(
    'no_textures',
    result.counts.textures === 0 && result.counts.images === 0,
    `${result.counts.textures} textures, ${result.counts.images} images`,
  );
  check(
    'materials_opaque',
    materials.every((m) => m.alphaMode === 'OPAQUE'),
    materials.map((m) => `${m.name}:${m.alphaMode}`).join(' '),
  );
  check(
    'materials_flat',
    materials.every((m) => !m.has_texture && !m.emissive && m.metallic === 0),
    materials
      .filter((m) => m.has_texture || m.emissive || m.metallic !== 0)
      .map((m) => m.name)
      .join(',') || 'base colour only, metallic 0, no emission',
  );
  const colorAttrs = meshesDef
    .flatMap((me) => me.primitives)
    .filter((p) => Object.keys(p.attributes).some((k) => k.startsWith('COLOR_'))).length;
  check('no_vertex_colors', colorAttrs === 0, `${colorAttrs} primitives with COLOR_n`);
  check(
    'material_roles',
    materials.every((m) => m.role_ok),
    materials
      .filter((m) => !m.role_ok)
      .map((m) => m.name)
      .join(',') || 'all in the role list',
  );
  const ds = materials.filter((m) => m.doubleSided && !DOUBLE_SIDED_ROLES.includes(m.name));
  check(
    'double_sided_only_leaves',
    ds.length === 0,
    ds.map((m) => m.name).join(',') || 'only leaf roles are doubleSided',
  );
  check('names_snake_case', badNames.length === 0, badNames.join(',') || 'ok');
  check('no_duplicate_node_names', dupNames.length === 0, dupNames.join(',') || 'ok');
  check('no_scaled_nodes', scaled.length === 0, scaled.join(',') || 'every node has scale 1');
  // A bridge kit's bays hang below their deck-level roots (piers to the water), so a kit with bays
  // checks the ground per root instead (`<root>_base_on_ground`, `<bay>_deck_level`).
  const bayRoots = new Set(prop.variants?.bays?.roots ?? []);
  const foundationRoots = (prop.variants?.roots ?? []).filter((v) => extrasOf(v).foundation_m !== undefined);
  if (prop.kind !== 'boat' && bayRoots.size === 0 && foundationRoots.length === 0)
    check('ground_at_y0', Math.abs(box.min[1]) <= 0.05, `min y = ${box.min[1]}`);
  if (B.tris !== undefined) check('tris_budget', tris <= B.tris, `${tris} / ${B.tris}`);
  if (B.draws !== undefined)
    check('draws_budget', drawsInstanced <= B.draws, `${drawsInstanced} / ${B.draws} (naive ${drawsNaive})`);
  check('materials_budget', usedMats.size <= B.materials, `${usedMats.size} / ${B.materials}`);
  // UVs are allowed only on text surfaces (the game paints words on them) and on the row's atlas
  // surfaces (they sample the region's atlas); nothing else needs them
  const uvMeshes = inst
    .filter((x) => meshesDef[x.mesh].primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined))
    .map((x) => x.name);
  const allowedUv = new Set([...(prop.textSurfaces ?? []), ...(prop.atlas?.surfaces ?? [])]);
  const strayUv = uvMeshes.filter((n) => !allowedUv.has(n));
  check(
    'uvs_only_on_text_or_atlas_surfaces',
    strayUv.length === 0,
    strayUv.length ? `UVs on ${strayUv.join(',')}` : `${uvMeshes.length} mesh nodes with UVs, all allowed`,
  );

  // ---- the ramp truck (gameplay-critical ramp geometry)
  if (prop.kind === 'tow_truck') {
    const rootName = prop.rampTrailer ? 'ramp_trailer' : 'tow_truck';
    const req = prop.rampTrailer
      ? [rootName, 'trailer', 'ramp_surface']
      : [rootName, 'cab', 'trailer', 'ramp_surface'];
    const missing = req.filter((n) => !byName.has(n));
    const cars = nodeNames.filter((n) => n && /^car_\d+$/.test(n));
    const wheelInst = inst.filter((x) => /^wheel_/.test(x.name));
    const wheelMeshes = new Set(wheelInst.map((x) => x.mesh));
    const wheelGround = wheelInst.map((x) => r3(bbox(worldVerts(x)).min[1]));
    check(
      'required_nodes',
      missing.length === 0,
      missing.length ? `missing ${missing.join(',')}` : req.join(','),
    );
    check(
      'root_at_origin',
      nodeWorldPos(rootName)?.every((v) => Math.abs(v) < 1e-3),
      `${rootName} at ${nodeWorldPos(rootName)}`,
    );
    // The upper deck is empty (no car stands where a rider lands: what is drawn is what is met), so the
    // truck carries at most the lower deck's cars, under it.
    if (!prop.rampTrailer)
      check('cars_1_to_3', cars.length >= 1 && cars.length <= 3, `${cars.length} car_N nodes`);
    check(
      'wheels_separate_nodes',
      wheelInst.length >= (prop.rampTrailer ? 4 : 6),
      `${wheelInst.length} wheel_* mesh nodes`,
    );
    check(
      'wheels_on_ground',
      wheelGround.length > 0 && wheelGround.every((y) => Math.abs(y) <= 0.05),
      `wheel min y: ${wheelGround.join(',')}`,
    );
    check(
      'wheel_mesh_shared',
      wheelInst.length > 0 && wheelMeshes.size <= 2,
      `${wheelMeshes.size} distinct wheel meshes`,
    );
    const s = box.size;
    check(
      'dims_plausible',
      inRange(s[2], prop.rampTrailer ? [11.3, 11.7] : [16, 23.5]) &&
        inRange(s[0], [2.3, 2.9]) &&
        inRange(s[1], prop.rampTrailer ? [2.7, 2.9] : [3.2, 4.35]),
      `length(z) ${s[2]}, width(x) ${s[0]}, height(y) ${s[1]}`,
    );
    check('forward_is_plus_z', box.max[2] > 10 && box.min[2] > -1.5, `z range ${box.min[2]}..${box.max[2]}`);
    const rampInst = instOf('ramp_surface');
    const ramp = { measured: false };
    if (rampInst.length === 1) {
      const up = [];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const t of worldTris(rampInst[0])) {
        const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
        const a = len(n) / 2;
        if (a < 1e-9) continue;
        const u = n.map((c) => c / (2 * a));
        if (u[1] > 0.5) {
          up.push({ t, u });
          nx += u[0] * a;
          ny += u[1] * a;
          nz += u[2] * a;
        }
      }
      if (up.length) {
        const L = Math.hypot(nx, ny, nz);
        const mean = [nx / L, ny / L, nz / L];
        const bb = bbox(up.flatMap((x) => x.t));
        const planarity = Math.max(
          ...up.map((x) =>
            deg(Math.acos(Math.min(1, x.u[0] * mean[0] + x.u[1] * mean[1] + x.u[2] * mean[2]))),
          ),
        );
        const angle = deg(Math.acos(mean[1]));
        const run = bb.size[2];
        const rise = bb.max[1] - bb.min[1];
        const zLo = bb.min[2];
        const surfY = (z) => bb.min[1] + ((z - zLo) / Math.max(run, 1e-6)) * rise;
        let intruders = 0;
        const intrNames = new Set();
        for (const o of inst) {
          if (o.name === 'ramp_surface') continue;
          for (const v of worldVerts(o)) {
            if (v[0] < bb.min[0] || v[0] > bb.max[0] || v[2] < zLo || v[2] > bb.max[2]) continue;
            const h = v[1] - surfY(v[2]);
            if (h > 0.05 && h < 2.0) {
              intruders++;
              intrNames.add(o.name);
            }
          }
        }
        // the trial's slot between two loading planks: any opening in the deck shows up as
        // upward-facing area well short of the deck's full width times its run
        const area = up.reduce((acc, x) => acc + len(cross(sub(x.t[1], x.t[0]), sub(x.t[2], x.t[0]))) / 2, 0);
        const fullArea = bb.size[0] * Math.hypot(run, rise);
        const ex = extrasOf('ramp_surface');
        Object.assign(ramp, {
          measured: true,
          angle_deg: r3(angle),
          lip_height_m: bb.max[1],
          run_m: run,
          width_m: bb.size[0],
          deck_cover: r3(area / fullArea),
          clearance_intruders: [...intrNames],
          declared: {
            angle: ex.ramp_angle_deg ?? null,
            run: ex.ramp_run_m ?? null,
            lip: ex.ramp_lip_height_m ?? null,
          },
        });
        check('ramp_angle_12_16', inRange(angle, [12, 16]), `${r3(angle)} deg (target 13.7)`);
        check('ramp_rises_to_front', mean[2] < 0, mean[2] < 0 ? '+Z (front)' : '-Z (rear)');
        check('ramp_foot_on_ground', bb.min[1] <= 0.1, `foot y ${bb.min[1]}`);
        check(
          'ramp_foot_at_origin',
          Math.abs(bb.min[2]) <= 0.5 && Math.abs((bb.min[0] + bb.max[0]) / 2) <= 0.2,
          `foot z ${bb.min[2]}`,
        );
        check('ramp_lip_2p5_3p1', inRange(bb.max[1], [2.5, 3.1]), `lip ${bb.max[1]} m (target 2.8)`);
        check('ramp_run_10p5_12p5', inRange(run, [10.5, 12.5]), `run ${run} m (target 11.5)`);
        check('ramp_width_min_2p4', bb.size[0] >= 2.4, `width ${bb.size[0]} m`);
        check('ramp_planar', planarity <= 1.0, `max deviation ${r3(planarity)} deg`);
        check(
          'ramp_no_slot',
          area / fullArea >= 0.99,
          `upward deck area is ${r3((100 * area) / fullArea)} % of width x slope length`,
        );
        check(
          'ramp_clear_airspace',
          intruders === 0,
          `${intruders} vertices from ${[...intrNames].join(',') || 'none'}`,
        );
        const d = ramp.declared;
        check(
          'ramp_declared_matches',
          d.angle !== null &&
            Math.abs(d.angle - angle) <= 0.5 &&
            d.run !== null &&
            Math.abs(d.run - run) <= 0.1 &&
            d.lip !== null &&
            Math.abs(d.lip - bb.max[1]) <= 0.1,
          `declared ${JSON.stringify(d)} vs measured angle ${r3(angle)} run ${run} lip ${bb.max[1]}`,
        );
        check(
          'nothing_far_above_lip',
          box.max[1] <= bb.max[1] + 1.6 + 1e-6,
          `top ${box.max[1]} vs lip ${bb.max[1]} + 1.6`,
        );
      } else check('ramp_measured', false, 'ramp_surface has no upward-facing triangles');
    } else check('ramp_measured', false, `${rampInst.length} ramp_surface mesh nodes (need exactly 1)`);
    result.ramp = ramp;
  }

  // ---- boats: the waterline pivot, the four probes and the hull size
  if (prop.kind === 'boat') {
    const b = prop.boat;
    const probes = ['probe_bow', 'probe_stern', 'probe_port', 'probe_starboard'];
    const missing = [b.root, b.hull, ...probes].filter((n) => !byName.has(n));
    check(
      'required_nodes',
      missing.length === 0,
      missing.length ? `missing ${missing.join(',')}` : `${b.root}, ${b.hull}, 4 probes`,
    );
    const rootIdx = byName.get(b.root);
    const identity =
      rootIdx !== undefined && world.get(rootIdx).every((v, k) => Math.abs(v - I4()[k]) < 1e-4);
    check('waterline_pivot_root_at_origin', identity, `${b.root} root world matrix identity: ${identity}`);
    const hull = instOf(b.hull);
    if (hull.length === 1) {
      const hb = bbox(worldVerts(hull[0]));
      check('hull_draft', inRange(-hb.min[1], b.draft), `draft ${r3(-hb.min[1])} m, range ${b.draft}`);
      check(
        'hull_freeboard',
        inRange(hb.max[1], b.freeboard),
        `hull top ${hb.max[1]} m, range ${b.freeboard}`,
      );
      check('hull_length', inRange(hb.size[2], b.length), `length(z) ${hb.size[2]}, range ${b.length}`);
      check('hull_beam', inRange(hb.size[0], b.beam), `beam(x) ${hb.size[0]}, range ${b.beam}`);
      const over = r3(Math.max(box.max[0] - hb.max[0], hb.min[0] - box.min[0]));
      check(
        'nothing_sticks_out_past_hull',
        over <= b.maxOverhangM,
        `overall width ${box.size[0]} m on a ${hb.size[0]} m hull (overhang ${over} m, max ${b.maxOverhangM})`,
      );
      result.hull = hb;
    } else check('hull_single_mesh', false, `${hull.length} ${b.hull} mesh nodes`);
    const pp = Object.fromEntries(probes.map((p) => [p, nodeWorldPos(p)]));
    check(
      'probes_at_waterline',
      probes.every((p) => pp[p] && Math.abs(pp[p][1]) <= 0.05),
      JSON.stringify(pp),
    );
    check(
      'bow_toward_plus_z',
      pp.probe_bow && pp.probe_stern && pp.probe_bow[2] > pp.probe_stern[2],
      `bow z ${pp.probe_bow?.[2]} stern z ${pp.probe_stern?.[2]}`,
    );
    check(
      'port_is_plus_x',
      pp.probe_port && pp.probe_starboard && pp.probe_port[0] > pp.probe_starboard[0],
      `port x ${pp.probe_port?.[0]}`,
    );
    check('height_max', box.max[1] <= b.maxHeight, `top ${box.max[1]} m, max ${b.maxHeight}`);
  }

  // ---- several variants in one GLB (palms, mangroves, signs)
  if (prop.kind === 'variants') {
    const V = prop.variants;
    const matSets = [];
    /** @type {Map<string, {tris: number, bb: ReturnType<typeof bbox> | null, rootPos: number[] | null}>} */
    const perRoot = new Map();
    V.roots.forEach((v, k) => {
      const sub = subtreeInst(v);
      let vt = 0;
      const vm = new Set();
      const mats = new Set();
      for (const x of sub) {
        vm.add(x.mesh);
        for (const p of meshesDef[x.mesh].primitives) {
          vt += primTris(p);
          if (p.material !== undefined) mats.add(p.material);
        }
      }
      let vd = 0;
      for (const m of vm) vd += meshesDef[m].primitives.length;
      matSets.push([...mats].sort().join(','));
      const rootPos = nodeWorldPos(v);
      const bb = sub.length ? bbox(sub.flatMap(worldVerts)) : null;
      const parts = V.parts.map((p) => `${v}_${p}`);
      const missing = parts.filter((p) => instOf(p).length !== 1);
      check(
        `${v}_parts`,
        byName.has(v) && missing.length === 0,
        missing.length ? `missing ${missing.join(',')}` : parts.join(','),
      );
      // A kit (many props in one GLB) gives each root its own triangle budget and height range.
      const vtMax = V.tris?.[k] ?? V.perVariant.tris;
      const vh = V.heights?.[k] ?? V.height;
      check(`${v}_tris_budget`, vt > 0 && vt <= vtMax, `${vt} / ${vtMax}`);
      check(`${v}_draws_budget`, vd <= V.perVariant.draws, `${vd} / ${V.perVariant.draws}`);
      check(`${v}_height`, bb && inRange(bb.max[1], vh), `height ${bb?.max[1]}, range ${vh}`);
      perRoot.set(v, { tris: vt, bb, rootPos });
      const bayK = V.bays?.roots.indexOf(v) ?? -1;
      if (bayK < 0)
        check(
          `${v}_base_on_ground`,
          bb &&
            rootPos &&
            Math.abs(rootPos[1]) <= 1e-3 &&
            Number.isFinite(extrasOf(v).foundation_m ?? 0) &&
            (extrasOf(v).foundation_m ?? 0) >= 0 &&
            Math.abs(bb.min[1] + (extrasOf(v).foundation_m ?? 0)) <= 0.05,
          `root ${rootPos}, min y ${bb?.min[1]}, foundation_m ${extrasOf(v).foundation_m ?? 0}`,
        );
      else {
        // A bay: its root is the deck top at the bay's start, and it runs `bay_m` along +Z. The
        // game repeats it along a deck it builds itself, so the length must be exact (1%).
        const ex = extrasOf(v);
        const want = V.bays.lengthM[bayK];
        const runZ = bb && rootPos ? [r3(bb.min[2] - rootPos[2]), r3(bb.max[2] - rootPos[2])] : null;
        check(
          `${v}_bay_length`,
          typeof ex.bay_m === 'number' &&
            want !== undefined &&
            within(ex.bay_m, want, 0.01) &&
            runZ !== null &&
            Math.abs(runZ[0]) <= 0.01 * ex.bay_m &&
            within(runZ[1], ex.bay_m, 0.01),
          `bay_m ${ex.bay_m ?? 'missing'} (catalog ${want}), runs z ${runZ?.join('..')} from its root`,
        );
        const pier = typeof ex.pier_m === 'number' ? ex.pier_m : null;
        const depth = bb ? -bb.min[1] : null;
        check(
          `${v}_deck_level`,
          rootPos !== null &&
            Math.abs(rootPos[1]) <= 1e-3 &&
            depth !== null &&
            (pier === null ? depth >= -0.05 : Math.abs(depth - pier) <= Math.max(0.05, 0.01 * pier)),
          `root y ${rootPos?.[1]}, reaches down ${depth} m (pier_m ${pier ?? 'none'})`,
        );
      }
      check(
        `${v}_at_x`,
        rootPos && Math.abs(rootPos[0] - V.xs[k]) < 1e-3 && Math.abs(rootPos[2]) < 1e-3,
        `root ${rootPos}, expected x ${V.xs[k]}`,
      );
      if (V.sway) {
        const sway = {};
        for (const x of sub) {
          const vals = meshesDef[x.mesh].primitives
            .filter((p) => p.attributes._SWAY !== undefined)
            .flatMap((p) => read(p.attributes._SWAY));
          sway[x.name] = vals.length ? { min: r3(Math.min(...vals)), max: r3(Math.max(...vals)) } : null;
        }
        const all = Object.values(sway);
        check(
          `${v}_sway_attribute`,
          all.length === sub.length &&
            all.every((s) => s && s.min >= -1e-3 && s.max <= 1.001) &&
            Math.max(...all.map((s) => s?.max ?? 0)) >= 0.9 &&
            Math.min(...all.map((s) => s?.min ?? 1)) <= 0.01,
          JSON.stringify(sway),
        );
      }
    });
    if (V.sharedMaterials)
      check('variants_share_materials', new Set(matSets).size === 1, matSets.join(' | '));
    for (const b of V.bays?.roots ?? [])
      if (!V.roots.includes(b)) check(`${b}_bay_length`, false, `bay ${b} is not one of the variant roots`);
    // Levels of detail: the far stand-in keeps a share of the near one's triangles inside its box
    // (each relative to its own root, within 5% of lod0's extent on that axis).
    for (const { lod0, lod1, maxRatio = 0.3 } of V.lods ?? []) {
      const a = perRoot.get(lod0);
      const b = perRoot.get(lod1);
      if (!a?.bb || !b?.bb || !a.rootPos || !b.rootPos) {
        check(`${lod1}_lod`, false, `${lod0} or ${lod1} is not a variant root with geometry`);
        continue;
      }
      const rel = (x) => [0, 1, 2].map((c) => [x.bb.min[c] - x.rootPos[c], x.bb.max[c] - x.rootPos[c]]);
      const ra = rel(a);
      const rb = rel(b);
      const off = [0, 1, 2].map(
        (c) =>
          Math.max(Math.abs(rb[c][0] - ra[c][0]), Math.abs(rb[c][1] - ra[c][1])) /
          Math.max(a.bb.size[c], 1e-6),
      );
      const share = b.tris / Math.max(a.tris, 1);
      check(
        `${lod1}_lod`,
        share <= maxRatio + 1e-9 && off.every((o) => o <= 0.05 + 1e-9),
        `${b.tris} of ${a.tris} triangles (${r3(share * 100)} %, max ${maxRatio * 100} %); box off by ` +
          `${off.map((o) => `${r3(o * 100)} %`).join(', ')} of ${lod0}'s x, y, z`,
      );
    }
  }

  // ---- one prop, one root
  if (prop.kind === 'single') {
    const S = prop.single;
    const missing = [S.root, ...S.nodes].filter((n) => !byName.has(n));
    check(
      'required_nodes',
      missing.length === 0,
      missing.length ? `missing ${missing.join(',')}` : [S.root, ...S.nodes].join(','),
    );
    check(
      'root_at_origin',
      nodeWorldPos(S.root)?.every((v) => Math.abs(v) < 1e-3),
      `${S.root} at ${nodeWorldPos(S.root)}`,
    );
    const s = box.size;
    check(
      'size_plausible',
      inRange(s[0], S.size[0]) && inRange(s[1], S.size[1]) && inRange(s[2], S.size[2]),
      `x ${s[0]} ${JSON.stringify(S.size[0])}, y ${s[1]} ${JSON.stringify(S.size[1])}, z ${s[2]} ${JSON.stringify(S.size[2])}`,
    );
  }

  // ---- text surfaces: the game draws words on these, so they need a clean 0..1 UV rectangle
  for (const name of prop.textSurfaces ?? []) {
    const xs = instOf(name);
    if (xs.length !== 1) {
      check(`${name}_text_surface`, false, `${xs.length} mesh nodes named ${name}`);
      continue;
    }
    const x = xs[0];
    const prims = meshesDef[x.mesh].primitives;
    const ex = extrasOf(name);
    // the front face: the triangles that carry UVs and face +Z
    const uvPrim = prims.find((p) => p.attributes.TEXCOORD_0 !== undefined);
    let detail = 'no TEXCOORD_0';
    let ok = false;
    if (uvPrim && prims.length === 1) {
      const pos = read(uvPrim.attributes.POSITION);
      const uv = read(uvPrim.attributes.TEXCOORD_0);
      // A GLB with normals says which corners face +Z; one without (the optimiser drops them) says
      // it by winding alone, which is also all the game's back-face culling reads.
      const hasNormals = uvPrim.attributes.NORMAL !== undefined;
      const nrm = hasNormals ? read(uvPrim.attributes.NORMAL) : [];
      const facing = new Set();
      const side = ex.facing_axis === 'x';
      const axis = side ? 0 : 2;
      const horizontal = side ? 2 : 0;
      if (!hasNormals) {
        const idx = uvPrim.indices !== undefined ? read(uvPrim.indices) : [...Array(pos.length / 3).keys()];
        const P = (k) => xf(x.world, [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const n = cross(sub(P(idx[t + 1]), P(idx[t])), sub(P(idx[t + 2]), P(idx[t])));
          const l = len(n);
          if (l > 1e-12 && n[axis] / l > 0.99)
            for (const k of [idx[t], idx[t + 1], idx[t + 2]]) facing.add(k);
        }
      }
      const front = [];
      for (let k = 0; k < pos.length / 3; k++) {
        if (hasNormals ? nrm[k * 3 + axis] > 0.99 : facing.has(k))
          front.push({
            p: xf(x.world, [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]),
            uv: [uv[k * 2], uv[k * 2 + 1]],
          });
      }
      const fb = bbox(front.map((f) => f.p));
      const near = (a, b) => Math.abs(a - b) < 1e-3;
      // glTF puts UV (0, 0) at the image's top-left; seen from the front (+Z) that is min x, max y
      const tl = front.filter(
        (f) =>
          near(f.p[horizontal], side ? fb.max[horizontal] : fb.min[horizontal]) && near(f.p[1], fb.max[1]),
      );
      const br = front.filter(
        (f) =>
          near(f.p[horizontal], side ? fb.min[horizontal] : fb.max[horizontal]) && near(f.p[1], fb.min[1]),
      );
      ok =
        front.length >= 4 &&
        tl.length > 0 &&
        tl.every((f) => near(f.uv[0], 0) && near(f.uv[1], 0)) &&
        br.length > 0 &&
        br.every((f) => near(f.uv[0], 1) && near(f.uv[1], 1)) &&
        ex.text_surface === true &&
        near(ex.width_m, fb.size[horizontal]) &&
        near(ex.height_m, fb.size[1]) &&
        fb.size[axis] < 1e-3;
      detail = `${side ? '+X side' : '+Z front'} face ${fb.size[horizontal]} x ${fb.size[1]} m (extras ${ex.width_m} x ${ex.height_m}), ${front.length} front verts by ${hasNormals ? 'normal' : 'winding'}, top-left uv ${JSON.stringify(tl[0]?.uv)}`;
    } else if (prims.length !== 1) detail = `${prims.length} primitives (a text surface is one material)`;
    check(`${name}_text_surface`, ok, detail);
  }

  // ---- atlas surfaces: every triangle samples one tile's inner rect, so mip levels and
  // neighbouring tiles never bleed into it (tools/atlas lays the sheet out; its layout is the contract)
  if (prop.atlas) {
    const layout = opts.atlasLayout === undefined ? readAtlasLayout(prop) : opts.atlasLayout;
    const rects = layout?.tiles ? Object.values(layout.tiles).map((t) => t.rect) : [];
    const eps = 1e-6;
    const inRect = (r, [u, v]) => u >= r[0] - eps && u <= r[2] + eps && v >= r[1] - eps && v <= r[3] + eps;
    let triangles = 0;
    const bad = [];
    for (const name of prop.atlas.surfaces) {
      const xs = instOf(name);
      if (xs.length !== 1) {
        bad.push(`${name}: ${xs.length} mesh nodes`);
        continue;
      }
      for (const p of meshesDef[xs[0].mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        if (p.attributes.TEXCOORD_0 === undefined) {
          bad.push(`${name}: a primitive without UVs`);
          continue;
        }
        const uv = read(p.attributes.TEXCOORD_0);
        const count = gltf.accessors[p.attributes.POSITION].count;
        const idx = p.indices !== undefined ? read(p.indices) : [...Array(count).keys()];
        for (let t = 0; t + 2 < idx.length; t += 3) {
          triangles++;
          const uvs = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [uv[k * 2], uv[k * 2 + 1]]);
          if (!rects.some((r) => uvs.every((q) => inRect(r, q))))
            bad.push(`${name} triangle ${t / 3} at uv ${uvs.map((q) => q.map(r3).join(',')).join(' ')}`);
        }
      }
    }
    check(
      'atlas_uvs_in_tiles',
      layout !== null && rects.length > 0 && bad.length === 0,
      layout === null || rects.length === 0
        ? `no layout for sheet ${prop.atlas.sheet} (${atlasLayoutPath(prop)}); the sheet must be built first`
        : `${triangles} triangles on ${prop.atlas.surfaces.length} surface(s) against ${rects.length} tiles` +
            (bad.length
              ? `; outside one tile: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? ` (+${bad.length - 4})` : ''}`
              : ''),
    );
  }

  // ---- outward winding: once normals are dropped, a face's front is its winding alone and the
  // game culls the back. For a closed convex part every face must point away from its centre.
  if (prop.convexParts?.length) {
    let faces = 0;
    const inward = [];
    for (const name of prop.convexParts) {
      const xs = instOf(name);
      if (xs.length !== 1) {
        inward.push(`${name}: ${xs.length} mesh nodes`);
        continue;
      }
      const tris = worldTris(xs[0]);
      const pb = bbox(tris.flat());
      const centre = [0, 1, 2].map((c) => (pb.min[c] + pb.max[c]) / 2);
      let wrong = 0;
      for (const t of tris) {
        const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
        if (len(n) < 1e-12) continue;
        faces++;
        const mid = [0, 1, 2].map((c) => (t[0][c] + t[1][c] + t[2][c]) / 3);
        const out = sub(mid, centre);
        if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) wrong++;
      }
      if (wrong) inward.push(`${name}: ${wrong} faces wound inward`);
    }
    check(
      'faces_wound_outward',
      inward.length === 0 && faces > 0,
      `${faces} faces on ${prop.convexParts.length} convex part(s)${inward.length ? `; ${inward.join('; ')}` : ', all outward'}`,
    );
  }

  // ---- vehicles: instanced traffic, one body each, launched off by a wheelie at the hood
  if (prop.kind === 'vehicle') {
    const missing = VEHICLE_NODES.filter((n) => !byName.has(n));
    check(
      'required_nodes',
      missing.length === 0,
      missing.length ? `missing ${missing.join(',')}` : VEHICLE_NODES.join(','),
    );
    check(
      'root_at_origin',
      nodeWorldPos('vehicle')?.every((v) => Math.abs(v) < 1e-3),
      `vehicle at ${nodeWorldPos('vehicle')}`,
    );
    const ex = extrasOf('vehicle');
    const badExtras = VEHICLE_EXTRAS.filter((k) => typeof ex[k] !== 'number' || !Number.isFinite(ex[k]));
    check(
      'vehicle_extras',
      badExtras.length === 0 && VEHICLE_CLASSES.includes(ex.class),
      badExtras.length
        ? `missing or not a number: ${badExtras.join(',')}`
        : `class ${ex.class ?? 'missing'} (one of ${VEHICLE_CLASSES.join(', ')})`,
    );
    const s = box.size;
    check(
      'vehicle_size_matches_extras',
      badExtras.length === 0 &&
        within(s[2], ex.length_m, 0.02) &&
        within(s[0], ex.width_m, 0.02) &&
        within(s[1], ex.height_m, 0.02),
      `box ${s[2]} x ${s[0]} x ${s[1]} m (length, width, height) vs extras ${ex.length_m} x ${ex.width_m} x ${ex.height_m}`,
    );
    const hood = nodeWorldPos('hood');
    check(
      'hood_on_top',
      hood !== null &&
        badExtras.length === 0 &&
        ex.hood_front_m > ex.hood_back_m &&
        ex.hood_front_m <= box.max[2] + 0.01 &&
        Math.abs(hood[0]) <= 0.05 &&
        Math.abs(hood[1] - ex.hood_top_m) <= 0.05 &&
        hood[2] >= ex.hood_back_m - 0.05 &&
        hood[2] <= ex.hood_front_m + 0.05,
      `hood empty at ${hood ?? 'missing'}; hood_top_m ${ex.hood_top_m}, from z ${ex.hood_back_m} to ${ex.hood_front_m}`,
    );
    const paint = materials.find((m) => m.name === 'paint_primary');
    check(
      'paint_primary_white',
      paint?.used && paint.baseColor.slice(0, 3).every((c) => c >= 0.999),
      paint
        ? `paint_primary ${paint.baseColor.slice(0, 3).map(r3).join(',')}${paint.used ? '' : ' (unused)'}`
        : 'no paint_primary',
    );
    const text = new Set(prop.textSurfaces ?? []);
    const extra = inst.filter((x) => x.name !== 'vehicle_body' && !text.has(x.name)).map((x) => x.name);
    check(
      'vehicle_one_body',
      instOf('vehicle_body').length === 1 && extra.length === 0,
      extra.length ? `other mesh nodes: ${extra.join(',')}` : 'vehicle_body (and text surfaces) only',
    );
  }

  // ---- wire attach points (power pole)
  if (prop.attach) {
    const pts = prop.attach.names.map((n) => [n, nodeWorldPos(n)]);
    const missing = pts.filter(([, p]) => !p).map(([n]) => n);
    const low = pts.filter(([, p]) => p && p[1] < prop.attach.minHeight).map(([n]) => n);
    const xsOrdered = pts.every(([, p], i) => i === 0 || (p && pts[i - 1][1] && p[0] > pts[i - 1][1][0]));
    check(
      'wire_attach_points',
      missing.length === 0 && low.length === 0 && xsOrdered,
      missing.length
        ? `missing ${missing.join(',')}`
        : `${pts.map(([n, p]) => `${n} ${p}`).join('; ')}${low.length ? `; below ${prop.attach.minHeight} m: ${low.join(',')}` : ''}`,
    );
  }

  result.checks = checks;
  result.summary = {
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    failed: checks.filter((c) => !c.pass).map((c) => c.id),
  };
  return result;
}

/** Optional: the Khronos validator through glTF-Transform's CLI (needs the npm registry). */
export function khronosValidate(glb) {
  const r = spawnSync('npx', ['--yes', '@gltf-transform/cli@4.5.1', 'validate', glb, '--format', 'csv'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status === null || r.error)
    return { ran: false, note: `validator did not run: ${r.error?.message ?? 'no exit code'}` };
  const rows = (r.stdout ?? '').split(/\r?\n/).filter((l) => l && !l.startsWith('code,') && l.includes(','));
  const sev = rows.map((l) => Number(l.split(',').at(-2)));
  return {
    ran: true,
    exit: r.status,
    errors: sev.filter((s) => s === 0).length,
    warnings: sev.filter((s) => s === 1).length,
  };
}

function line(res) {
  const s = res.summary;
  return (
    `SCORE ${res.prop}: ${s.passed}/${s.total} checks pass; ${res.counts.triangles} tris, ` +
    `${res.draws.draws_instanced} draws (naive ${res.draws.draws_naive}, merged floor ${res.draws.draws_merged_floor}), ` +
    `${res.counts.materials_used} materials, ${res.bytes} bytes` +
    (s.failed.length ? `; FAILED: ${s.failed.join(', ')}` : '')
  );
}

async function main(argv) {
  const json = argv.includes('--json');
  const validate = argv.includes('--validate');
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  let jobs;
  if (at('--glb')) {
    const prop = PROPS.find((p) => p.name === at('--prop'));
    if (!prop) throw new Error(`--prop must be one of ${PROPS.map((p) => p.name).join(', ')}`);
    jobs = [[prop, path.resolve(at('--glb'))]];
  } else {
    const names = argv.filter((a) => !a.startsWith('--'));
    const props = names.length ? names.map((n) => PROPS.find((p) => p.name === n) ?? n) : PROPS;
    const unknown = props.filter((p) => typeof p === 'string');
    if (unknown.length) throw new Error(`unknown prop(s) ${unknown.join(', ')}`);
    jobs = props.map((p) => [p, path.join(repoRoot, glbPath(p))]);
  }
  let failed = 0;
  let examined = 0;
  for (const [prop, glb] of jobs) {
    if (!existsSync(glb)) {
      console.error(`SCORE ${prop.name}: no GLB at ${path.relative(repoRoot, glb)}`);
      failed++;
      continue;
    }
    const res = scoreGlb(readFileSync(glb), prop);
    examined += res.summary.total;
    if (validate) {
      const v = khronosValidate(glb);
      res.validation = v;
      if (v.ran) {
        const pass = v.errors === 0;
        res.checks.push({
          id: 'khronos_validator',
          pass,
          detail: `${v.errors} errors, ${v.warnings} warnings`,
        });
        res.summary.total++;
        if (pass) res.summary.passed++;
        else res.summary.failed.push('khronos_validator');
        examined++;
      }
    }
    console.log(json ? JSON.stringify(res, null, 2) : line(res));
    if (validate) console.log(`  validator: ${JSON.stringify(res.validation)}`);
    if (res.summary.failed.length) failed++;
  }
  console.log(`[examined] ${jobs.length} GLBs, ${examined} checks; ${failed} GLB(s) with failures`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
