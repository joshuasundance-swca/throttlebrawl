import { Box3, Color, Euler, Matrix4, Mesh, Quaternion, Ray, Triangle, Vector3, type Material } from 'three';
import { expect, it } from 'vitest';
import source from '../gis/networks/osm-pnw-samish.json';
import { buildSimConfig, streamForRoute } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { readConnector } from '../../src/road';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene } from '../../src/render/road-mesh';
import { track } from '../../src/render/scene-cost.test-util';
import { readModel } from '../../src/render/vehicle-pools.test-util';
import { bakeVehicle, trafficModelRows } from '../../src/render/vehicles';
import { readGlb } from '../../src/render/glb';
import { trafficHeightM } from '../../src/sim/api';

interface MaterialTriangle {
  tri: Triangle;
  bounds: Box3;
}

interface MaterialVariant {
  asset: string;
  triangles: MaterialTriangle[];
  bounds: Box3;
}

const closeColour = (a: Color, b: Color) =>
  Math.abs(a.r - b.r) < 1e-6 && Math.abs(a.g - b.g) < 1e-6 && Math.abs(a.b - b.b) < 1e-6;

function segmentHits(a: Vector3, b: Vector3, tri: Triangle): boolean {
  const delta = b.clone().sub(a);
  const length = delta.length();
  const hit = new Ray(a, delta.normalize()).intersectTriangle(tri.a, tri.b, tri.c, false, new Vector3());
  return hit !== null && hit.distanceTo(a) <= length + 1e-6;
}

function trianglesHit(a: Triangle, b: Triangle): boolean {
  return (
    segmentHits(a.a, a.b, b) ||
    segmentHits(a.b, a.c, b) ||
    segmentHits(a.c, a.a, b) ||
    segmentHits(b.a, b.b, a) ||
    segmentHits(b.b, b.c, a) ||
    segmentHits(b.c, b.a, a)
  );
}

function materialContact(road: Triangle, material: readonly MaterialTriangle[]): boolean {
  const roadBounds = new Box3().setFromPoints([road.a, road.b, road.c]);
  return material.some(({ tri, bounds }) => roadBounds.intersectsBox(bounds) && trianglesHit(road, tri));
}

it('keeps long allowed traffic clear of drawn tight bends and bridge kit on Samish access roads', async () => {
  const registry = registryFromGlob(
    import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
  );
  const config = buildSimConfig(registry, streamForRoute(registry, 'region-pnw:osm-i5-samish-run'), {
    seed: 1,
    eventId: 'region-pnw:pnw-fogline-run',
    route: 'region-pnw:osm-i5-samish-run',
  });
  const { road, dressing } = track('osm-pnw-samish');
  const tags = new Set(road.edges.flatMap((edge) => edge.tags.map((tag) => tag.tag)));
  const types = config.trafficTypes.filter(
    (type) =>
      ['car', 'truck', 'rv', 'oddity'].includes(type.category) &&
      type.cruiseMps > 0 &&
      ((type.weight ?? 0) > 0 ||
        Object.entries(type.areaWeights ?? {}).some(([tag, weight]) => tags.has(tag) && weight > 0)),
  );
  expect(types.length).toBeGreaterThan(0);
  const longest = [...types].sort(
    (a, b) => b.lengthM - a.lengthM || b.widthM - a.widthM || (b.heightM ?? 0) - (a.heightM ?? 0),
  )[0]!;
  const body = new Box3(
    new Vector3(-longest.widthM / 2, 0.5, -longest.lengthM / 2),
    new Vector3(longest.widthM / 2, longest.heightM, longest.lengthM / 2),
  );
  const semi = config.trafficTypes.find((type) => type.contentId === 'region-pnw:semi');
  expect(semi, 'the Samish interstate permits its authored semi').toBeDefined();
  const modelRows = trafficModelRows(
    import.meta.glob('/packs/*/assets/traffic-models.json', { eager: true, import: 'default' }),
  );
  const assets = modelRows.get(semi!.contentId)?.models ?? [];
  expect(assets.length, 'the authored semi has a rendered model').toBeGreaterThan(0);
  const variants: MaterialVariant[] = [];
  for (const asset of assets) {
    const modelScene = readGlb(await readModel(asset));
    const tyreColours: Color[] = [];
    modelScene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const source = object.material as Material | Material[];
      const materials = Array.isArray(source) ? source : [source];
      for (const material of materials)
        if (material.name === 'tyre' && 'color' in material)
          tyreColours.push((material as { color: Color }).color.clone());
    });
    expect(tyreColours.length, `${asset} tyre material`).toBeGreaterThan(0);
    const model = bakeVehicle(asset, modelScene);
    const scale = new Vector3(
      semi!.widthM / model.widthM,
      semi!.widthM / model.widthM,
      semi!.lengthM / model.lengthM,
    );
    const positions = model.geometry.getAttribute('position');
    const colours = model.geometry.getAttribute('color');
    const triangles: MaterialTriangle[] = [];
    for (let i = 0; i < positions.count; i += 3) {
      const colour = new Color(colours.getX(i), colours.getY(i), colours.getZ(i));
      if (tyreColours.some((tyre) => closeColour(colour, tyre))) continue;
      const tri = new Triangle(
        new Vector3().fromBufferAttribute(positions, i).multiply(scale),
        new Vector3().fromBufferAttribute(positions, i + 1).multiply(scale),
        new Vector3().fromBufferAttribute(positions, i + 2).multiply(scale),
      );
      triangles.push({ tri, bounds: new Box3().setFromPoints([tri.a, tri.b, tri.c]) });
    }
    expect(triangles.length, `${asset} non-tyre geometry`).toBeGreaterThan(0);
    const bounds = triangles.reduce((box, material) => box.union(material.bounds), new Box3().makeEmpty());
    variants.push({ asset, triangles, bounds });
  }
  for (const variant of variants) {
    const controlTriangle = variant.triangles[0]!.tri;
    const controlCentre = controlTriangle.getMidpoint(new Vector3());
    const controlNormal = controlTriangle.getNormal(new Vector3());
    const controlProbe = new Triangle(
      controlCentre.clone().addScaledVector(controlNormal, -0.1),
      controlCentre.clone().addScaledVector(controlNormal, 0.1),
      controlCentre
        .clone()
        .addScaledVector(controlNormal, 0.1)
        .add(new Vector3(0.1, 0, 0)),
    );
    expect(materialContact(controlProbe, variant.triangles), `control: probe crosses ${variant.asset}`).toBe(
      true,
    );
    const ground = new Triangle(new Vector3(-20, 0, -20), new Vector3(20, 0, -20), new Vector3(0, 0, 20));
    expect(materialContact(ground, variant.triangles), `${variant.asset} clears flat ground`).toBe(false);
    const gradePose = new Matrix4().makeRotationX(Math.atan(0.1));
    const gradeInverse = gradePose.clone().invert();
    const gradedGround = ground.clone();
    gradedGround.a.applyMatrix4(gradePose).applyMatrix4(gradeInverse);
    gradedGround.b.applyMatrix4(gradePose).applyMatrix4(gradeInverse);
    gradedGround.c.applyMatrix4(gradePose).applyMatrix4(gradeInverse);
    expect(
      materialContact(gradedGround, variant.triangles),
      `${variant.asset} clears a matching constant-grade road`,
    ).toBe(false);
    const raisedGround = ground.clone();
    raisedGround.a.y = raisedGround.b.y = raisedGround.c.y = 0.6;
    expect(
      materialContact(raisedGround, variant.triangles),
      `control: raised road cuts ${variant.asset}`,
    ).toBe(true);
  }
  const access = new Set(
    source.trafficChains.flatMap((chain) =>
      source.lines.find((line) => line.id === chain.line)!.roads.map((r) => r.id),
    ),
  );
  const baked = registry.networks['region-pnw:osm-pnw-samish'];
  if (!baked) throw new Error('no Samish network');
  const collars = new Set(
    baked.junctions
      .flatMap((junction) => junction.connectors)
      .map(readConnector)
      .filter((row) => row?.trafficOnly === true && (access.has(row.from.road) || access.has(row.to.road)))
      .map((row) => row!.road),
  );
  expect(collars.size).toBe(source.trafficChains.length * 2);
  const trafficClearanceM = Math.max(...config.trafficTypes.map(trafficHeightM));
  const { group } = buildRoadScene(road, createFlatLook(), dressing, { trafficClearanceM });
  const triangles = new GroundTris(group, /^road-/).triangles().map((tri) => ({
    ...tri,
    bounds: new Box3().setFromPoints([tri.a, tri.b, tri.c]),
  }));
  const faults: string[] = [];
  const faultsByRoad = new Map<string, number>();
  const faultSurfacePairs = new Map<string, number>();
  let highestLocalSurfaceM = -Infinity;
  let poses = 0;
  let collarPoses = 0;
  let detectsBuriedBody = false;
  const materialFaults: string[] = [];
  for (const edge of road.edges.filter((edge) => access.has(edge.id) || collars.has(edge.id))) {
    const collar = collars.has(edge.id);
    const stations = collar
      ? Array.from({ length: edge.count }, (_, i) => (i === edge.count - 1 ? edge.length : i * edge.spacing))
      : Array.from({ length: Math.max(0, Math.ceil((edge.length - 1) / 4)) }, (_, i) => 1 + i * 4);
    for (const s of stations) {
      if (
        !collar &&
        Math.abs(road.kappaAt(edge.index, s)) < 1 / 50 &&
        !edge.tags.some((tag) => tag.tag === 'bridge' && tag.s0 <= s && s <= tag.s1)
      )
        continue;
      poses++;
      if (collar) collarPoses++;
      const p = road.toWorld(edge.index, s, 0, 0);
      const f = road.frameAt(edge.index, s);
      // These one-way access roads carry traffic toward increasing s with no local yaw. Match the
      // snapshot and EntityViews pose: heading from the road tangent, pitch from its surface rise.
      const heading = Math.atan2(-f.tx, -f.tz);
      const pitch = Math.atan(f.grade);
      const matrix = new Matrix4().compose(
        new Vector3(p.x, p.y, p.z),
        new Quaternion().setFromEuler(new Euler(pitch, heading, 0, 'YXZ')),
        new Vector3(1, 1, 1),
      );
      const bounds = body.clone().applyMatrix4(matrix);
      const drawnBounds = variants.map((variant) => variant.bounds.clone().applyMatrix4(matrix));
      const inverse = matrix.clone().invert();
      const triangle = new Triangle();
      if (poses === 1) {
        const buried = body.clone().translate(new Vector3(0, -1, 0));
        const buriedBounds = buried.clone().applyMatrix4(matrix);
        detectsBuriedBody = triangles.some((tri) => {
          if (!buriedBounds.intersectsBox(tri.bounds)) return false;
          triangle.set(
            tri.a.clone().applyMatrix4(inverse),
            tri.b.clone().applyMatrix4(inverse),
            tri.c.clone().applyMatrix4(inverse),
          );
          return buried.intersectsTriangle(triangle);
        });
      }
      for (const tri of triangles) {
        const boxCandidate = bounds.intersectsBox(tri.bounds);
        const materialCandidate = drawnBounds.some((candidate) => candidate.intersectsBox(tri.bounds));
        if (!boxCandidate && !materialCandidate) continue;
        triangle.set(
          tri.a.clone().applyMatrix4(inverse),
          tri.b.clone().applyMatrix4(inverse),
          tri.c.clone().applyMatrix4(inverse),
        );
        if (materialCandidate)
          for (let variant = 0; variant < variants.length; variant++) {
            if (!drawnBounds[variant]!.intersectsBox(tri.bounds)) continue;
            const model = variants[variant]!;
            if (materialContact(triangle, model.triangles))
              materialFaults.push(`${model.asset} ${edge.id}@${s.toFixed(3)} ${tri.name}`);
          }
        if (boxCandidate && body.intersectsTriangle(triangle)) {
          const centre = tri.a
            .clone()
            .add(tri.b)
            .add(tri.c)
            .multiplyScalar(1 / 3);
          const candidates = new Map<number, ReturnType<typeof road.project>>();
          for (const candidate of road.edges) {
            const on = road.project(centre.x, centre.z, candidate.index);
            candidates.set(on.edge, on);
          }
          const on = [...candidates.values()].sort((a, b) => {
            const aw = road.toWorld(a.edge, a.s, a.d, 0);
            const bw = road.toWorld(b.edge, b.s, b.d, 0);
            const as = Math.hypot(aw.x - centre.x, aw.z - centre.z) + Math.abs(aw.y - centre.y);
            const bs = Math.hypot(bw.x - centre.x, bw.z - centre.z) + Math.abs(bw.y - centre.y);
            return as - bs;
          })[0]!;
          const localYs = [triangle.a.y, triangle.b.y, triangle.c.y];
          const localXs = [triangle.a.x, triangle.b.x, triangle.c.x];
          const localZs = [triangle.a.z, triangle.b.z, triangle.c.z];
          highestLocalSurfaceM = Math.max(highestLocalSurfaceM, ...localYs);
          faults.push(
            `${edge.id} s${s}: ${tri.name} ` +
              `surface=${road.edges[on.edge]!.id}@${on.s.toFixed(1)} ` +
              `localY=${Math.min(...localYs).toFixed(3)}..${Math.max(...localYs).toFixed(3)} ` +
              `localX=${Math.min(...localXs).toFixed(3)}..${Math.max(...localXs).toFixed(3)} ` +
              `localZ=${Math.min(...localZs).toFixed(3)}..${Math.max(...localZs).toFixed(3)}`,
          );
          faultsByRoad.set(edge.id, (faultsByRoad.get(edge.id) ?? 0) + 1);
          const pair = `${edge.id}->${road.edges[on.edge]!.id}`;
          faultSurfacePairs.set(pair, (faultSurfacePairs.get(pair) ?? 0) + 1);
        }
      }
    }
  }
  process.stdout.write(
    `[examined] ${longest.contentId} ${longest.lengthM}x${longest.widthM} m, ` +
      `${poses} actual body poses (${collarPoses} across ${collars.size} access collars); ` +
      `${faults.length} triangle contacts ` +
      `${JSON.stringify(Object.fromEntries(faultsByRoad))} ` +
      `${JSON.stringify(Object.fromEntries(faultSurfacePairs))}; ` +
      `highest triangle vertex ${Number.isFinite(highestLocalSurfaceM) ? `${highestLocalSurfaceM.toFixed(3)} m` : 'none'} ` +
      `over the body origin\n`,
  );
  process.stdout.write(
    `[examined] ${variants.length} committed semi model variant(s), ` +
      `${variants.reduce((total, variant) => total + variant.triangles.length, 0)} non-tyre triangles, ${materialFaults.length} ` +
      `surface intersections ${JSON.stringify(materialFaults.slice(0, 20))}\n`,
  );
  expect(poses).toBeGreaterThan(0);
  expect(detectsBuriedBody, 'control: the same rendered mesh detects a body lowered through the road').toBe(
    true,
  );
  expect(faults.slice(0, 20)).toEqual([]);
  expect(materialFaults.slice(0, 20)).toEqual([]);
}, 120_000);
