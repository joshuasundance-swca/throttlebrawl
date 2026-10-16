import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import { expect, it } from 'vitest';
import source from '../gis/networks/osm-pnw-samish.json';
import { buildSimConfig, streamForRoute } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene } from '../../src/render/road-mesh';
import { track } from '../../src/render/scene-cost.test-util';

it('keeps long allowed traffic clear of drawn tight bends and bridge kit on Samish access roads', () => {
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
  const access = new Set(
    source.trafficChains.flatMap((chain) =>
      source.lines.find((line) => line.id === chain.line)!.roads.map((r) => r.id),
    ),
  );
  const { group } = buildRoadScene(road, createFlatLook(), dressing);
  const triangles = new GroundTris(group, /^road-/).triangles().map((tri) => ({
    ...tri,
    bounds: new Box3().setFromPoints([tri.a, tri.b, tri.c]),
  }));
  const faults: string[] = [];
  let poses = 0;
  let detectsBuriedBody = false;
  for (const edge of road.edges.filter((edge) => access.has(edge.id))) {
    for (let s = 1; s < edge.length; s += 4) {
      if (
        Math.abs(road.kappaAt(edge.index, s)) < 1 / 50 &&
        !edge.tags.some((tag) => tag.tag === 'bridge' && tag.s0 <= s && s <= tag.s1)
      )
        continue;
      poses++;
      const p = road.toWorld(edge.index, s, 0, 0);
      const f = road.frameAt(edge.index, s);
      const forward = new Vector3(f.tx, f.grade, f.tz).normalize();
      const right = new Vector3(-f.tz, 0, f.tx);
      const up = new Vector3().crossVectors(right, forward).normalize();
      const matrix = new Matrix4().makeBasis(right, up, forward).setPosition(p.x, p.y, p.z);
      const bounds = body.clone().applyMatrix4(matrix);
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
        if (!bounds.intersectsBox(tri.bounds)) continue;
        triangle.set(
          tri.a.clone().applyMatrix4(inverse),
          tri.b.clone().applyMatrix4(inverse),
          tri.c.clone().applyMatrix4(inverse),
        );
        if (body.intersectsTriangle(triangle)) faults.push(`${edge.id} s${s}: ${tri.name}`);
      }
    }
  }
  process.stdout.write(
    `[examined] ${longest.contentId} ${longest.lengthM}x${longest.widthM} m, ${poses} actual tight-bend/bridge poses; ${faults.length} triangle contacts\n`,
  );
  expect(poses).toBeGreaterThan(0);
  expect(detectsBuriedBody, 'control: the same rendered mesh detects a body lowered through the road').toBe(
    true,
  );
  expect(faults.slice(0, 20)).toEqual([]);
}, 120_000);
