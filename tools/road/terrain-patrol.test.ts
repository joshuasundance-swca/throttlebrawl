import { expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { terrainAt } from '../../src/road';
import { planTerrainTrees, RURAL_TRUNK } from '../../src/road/structures/terrain-trees';
import { createWorld, riderHitbox } from '../../src/sim/world';
import { patrolSpots } from '../../src/sim/cops';

it('checks actual opted-in menu race patrols against complete seeded tree bodies', () => {
  const registry = registryFromGlob(
    import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
  );
  const streams = createStreamCache();
  let routes = 0;
  let placements = 0;
  let treesExamined = 0;
  for (const choice of regionChoices(registry)) {
    const event = lookup(registry.events, choice.eventId);
    if (!(Number(event.cops?.patrolMax ?? 0) > 0)) continue;
    const courses = [
      ...event.lengths.map((length) => ({ length: length.id, route: undefined })),
      ...realRoutes(registry, choice.eventId).map((route) => ({ length: undefined, route })),
    ];
    for (const { length, route } of courses) {
      const stream = streams.forEvent(registry, choice.eventId, length, route);
      for (const seed of [1, 2, 3]) {
        const cfg = buildSimConfig(registry, stream, {
          seed,
          eventId: choice.eventId,
          ...(route ? { route } : {}),
          ...(length ? { length } : {}),
        });
        if (!cfg.route.mainEdges.some((e) => cfg.road.edges[e]!.tags.some((t) => t.tag === 'patrol-verge')))
          continue;
        routes++;
        const plan = planTerrainTrees(cfg.road, seed);
        treesExamined += plan.items.length;
        const spots = patrolSpots(createWorld(cfg), cfg, 2);
        expect(spots.length).toBeGreaterThan(0);
        for (const { pos: p } of spots) {
          placements++;
          const at = cfg.road.toWorld(p.edge, p.s, p.d, 0);
          const ground = terrainAt(cfg.road.terrain, at.x, at.z)!;
          let radius = 0;
          cfg.riders.forEach((r, i) => {
            if (r.controller.kind === 'cop') {
              const box = riderHitbox(cfg, i);
              radius = Math.max(radius, Math.hypot(box.lengthM, box.widthM) / 2);
            }
          });
          for (const tree of plan.items) {
            if (tree.baseY >= ground.y + 1.6 || tree.topY <= ground.y) continue;
            expect(
              Math.hypot(at.x - tree.x, at.z - tree.z),
              `${route} seed ${seed} tree ${tree.id}`,
            ).toBeGreaterThan(radius + tree.scale * RURAL_TRUNK.baseRadiusM);
          }
        }
      }
    }
  }
  expect(routes).toBeGreaterThan(0);
  expect(placements).toBeGreaterThan(0);
  expect(treesExamined).toBeGreaterThan(0);
  process.stdout.write(
    `[patrol-verge tree proof] ${routes} seeded opted-in courses, ${placements} patrol bodies, ${treesExamined} tree bodies\n`,
  );
});
