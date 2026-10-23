/// <reference types="vite/client" />
// Road-feedback contract: continuous supported grass is recovery space, including for racing
// bikes. Full-route bot completion already lives in eagle-point-course; this probes the missing
// asphalt -> grass -> asphalt transition, not a promise to take every bend at top speed.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../../src/content';
import { hitboxOf } from '../../src/core';
import { roadBandHeight, terrainAt } from '../../src/road';
import { quantizeInput, type SimConfig, type SimInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { groundUnder } from '../../src/sim/ground';
import { riderState } from '../../src/sim/riders';
import { eagleRecoveryConfigs } from './eagle-recovery-config';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const BIKES = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'] as const;

function configFor(bike: (typeof BIKES)[number]) {
  return eagleRecoveryConfigs(registry, bike).original;
}

// This fixture tests a brisk asphalt/grass seam crossing, not cornering at half a bike's
// ceiling through an arbitrary midpoint hairpin. Choose the gentlest interior approach from
// the actual road, with supported grass on both sides. Full-course bends have their own bot test.
function recoveryStation(source: SimConfig, edge: number) {
  const length = source.road.edges[edge]!.length;
  const candidates = Array.from({ length: Math.max(1, Math.floor((length - 40) / 5)) }, (_, i) => 20 + i * 5)
    .filter((s) =>
      [-1, 1].every((side) => {
        const outer = source.road.vergeAt(edge, s, side < 0 ? 'left' : 'right').dOuter;
        const p = source.road.toWorld(edge, s, outer + side, 0);
        return terrainAt(source.road.terrain, p.x, p.z)?.surface === 'grass';
      }),
    )
    .map((s) => ({
      s,
      bend: Math.max(
        ...[-15, -10, -5, 0, 5, 10, 15].map((ds) => Math.abs(source.road.kappaAt(edge, s + ds))),
      ),
    }))
    .sort((a, b) => a.bend - b.bend || a.s - b.s);
  if (!candidates.length) throw new Error('Missing supported interior recovery approach');
  return candidates[0]!.s;
}

function ride(source: SimConfig, edge: number, side: -1 | 1, commands?: readonly SimInput[]) {
  const { sim, world } = createSimWithWorld(source);
  const me = world.movers.find((m) => m.kind === 'rider')!;
  const s = recoveryStation(source, edge);
  const lane = source.road.lanesAt(edge, s).find((l) => l.kind === 'drive' && l.direction === 1)!;
  const box = hitboxOf(source.riders[me.riderIndex]?.hitbox);
  const asphalt = lane.dCenterM + (side * lane.widthM) / 2;
  me.pos = { edge, s, d: asphalt - side * (box.widthM / 2 + 0.15), dir: 1 };
  // Half the shipped ceiling is an ordinary brisk approach; the faster bikes also approach faster.
  // This is an entry speed, not a minimum to hold over grass or a top-speed hairpin contract.
  me.speed = source.riders[0]!.bike.topSpeedMps * 0.5;
  riderState(world).yAbs[me.id] = source.road.surfaceHeight(edge, s, me.pos.d);
  const entrySpeed = me.speed;
  const inputs: SimInput[] = [];
  const hashes: number[] = [];
  const events: string[] = [];
  const unsupported: string[] = [];
  const surfaces: (string | null)[] = [];
  let grass = false;
  let recovered = false;
  let grassSpeed = 0;
  let terrainSpeed = 0;
  let beyondVerge = false;
  let settledTicks = 0;
  for (let tick = 0; tick < (commands?.length ?? 360); tick++) {
    const at = me.pos;
    const drive = source.road.lanesAt(at.edge, at.s).find((l) => l.kind === 'drive' && l.direction === 1)!;
    const limit = drive.dCenterM + (side * drive.widthM) / 2;
    const outer = source.road.vergeAt(at.edge, at.s, side < 0 ? 'left' : 'right').dOuter;
    // Leave asphalt under actual controls, cross the decorative shade seam with the whole body,
    // then steer back. No placement changes after the initial on-asphalt setup.
    beyondVerge ||= side * (at.d - outer) > box.widthM / 2 + 0.2;
    const command =
      commands?.[tick] ??
      quantizeInput({
        throttle: grass ? 0 : 0.25,
        // A racing-speed entry is not a requirement to hold that speed over uneven park grass.
        brake: grass && me.speed > entrySpeed * 0.65 ? 0.65 : 0,
        steer: recovered
          ? Math.max(-1, Math.min(1, (drive.dCenterM - at.d) * 0.5))
          : beyondVerge
            ? -side
            : side,
        flags: 0,
      });
    inputs.push(command);
    sim.step([command]);
    hashes.push(sim.hash());
    events.push(
      ...sim
        .events()
        .filter((e) => e.actor === me.id)
        .map((e) => `${e.type}:${JSON.stringify(e.data)}`),
    );
    const current = sim.snapshot().entities.find((e) => e.id === me.id)!;
    const surface = groundUnder(source.road, me.pos.edge, me.pos.s, me.pos.d, me.h);
    if (surfaces.at(-1) !== surface) surfaces.push(surface);
    grass ||= surface === 'grass';
    if (surface === 'grass' && grassSpeed === 0) grassSpeed = me.speed;
    if (
      terrainSpeed === 0 &&
      roadBandHeight(source.road, me.pos.edge, me.pos.s, me.pos.d) === null &&
      terrainAt(source.road.terrain, current.x, current.z)?.surface === 'grass'
    )
      terrainSpeed = me.speed;
    // Probe the moving, yawed body's four real world corners, not a stationary centre point.
    const forward = { x: Math.sin(current.heading), z: Math.cos(current.heading) };
    for (const along of [-box.lengthM / 2, box.lengthM / 2])
      for (const across of [-box.widthM / 2, box.widthM / 2]) {
        const x = current.x + forward.x * along + forward.z * across;
        const z = current.z + forward.z * along - forward.x * across;
        const corner = source.road.project(x, z, me.pos.edge);
        const land = terrainAt(source.road.terrain, x, z);
        if (
          roadBandHeight(source.road, corner.edge, corner.s, corner.d) === null &&
          (!land || land.surface === 'water')
        )
          unsupported.push(`tick ${tick}, ${x}, ${z}`);
      }
    if (beyondVerge && grass && surface === 'asphalt' && side * (me.pos.d - limit) < -box.widthM / 2) {
      recovered = true;
    }
    // Keep riding after the return: a reset deferred to the next tick is not recovery.
    if (recovered && ++settledTicks >= 60) break;
    if (me.mode === 'Tumble') break;
  }
  return {
    entrySpeed,
    grassSpeed,
    terrainSpeed,
    beyondVerge,
    grass,
    recovered,
    settledTicks,
    surfaces,
    events,
    unsupported,
    mode: me.mode,
    inputs,
    hashes,
  };
}

describe('Eagle Point racing-bike recovery across continuous supported grass', () => {
  for (const bike of BIKES)
    for (const side of [-1, 1] as const)
      it(`${bike} rides from asphalt across the ${side < 0 ? 'left' : 'right'} grass seam and back`, () => {
        const { original, courses } = eagleRecoveryConfigs(registry, bike);
        const cases = courses.flatMap((config) =>
          config.road.edges
            .filter(
              (e) =>
                config.route.allows(e.index) &&
                !config.road.lanesAt(e.index, e.length / 2).some((l) => l.direction === -1),
            )
            .map((edge) => ({ config, edge })),
        );
        expect(cases.length).toBeGreaterThan(0);
        const oneWayEdges = original.road.edges
          .filter((e) => !original.road.lanesAt(e.index, e.length / 2).some((l) => l.direction === -1))
          .map((e) => e.id);
        expect(
          new Set(cases.map(({ edge }) => edge.id)),
          'every one-way road has a legal recovery case',
        ).toEqual(new Set(oneWayEdges));
        for (const { config, edge } of cases) {
          const result = ride(config, edge.index, side);
          process.stdout.write(
            `[racing recovery] ${bike}/${edge.id}/${side}: ${JSON.stringify({ entryMps: result.entrySpeed, grassMps: result.grassSpeed, terrainMps: result.terrainSpeed, recovered: result.recovered, settledTicks: result.settledTicks, surfaces: result.surfaces, events: result.events.filter((e) => e.startsWith('crash:') || e.startsWith('jump:')), unsupported: result.unsupported, ticks: result.inputs.length })}\n`,
          );
          expect(result.beyondVerge).toBe(true);
          expect(result.grass).toBe(true);
          expect(result.terrainSpeed).toBeGreaterThan(result.entrySpeed * 0.6);
          expect(result.recovered).toBe(true);
          expect(result.settledTicks).toBe(60);
          expect(result.surfaces[0]).toBe('asphalt');
          expect(result.surfaces.at(-1)).toBe('asphalt');
          expect(result.mode).toBe('Road');
          expect(result.unsupported).toEqual([]);
          // Real terrain can launch and wobble a rider. The grass seam must not cause a crash/reset.
          expect(result.events.filter((e) => e.startsWith('crash:'))).toEqual([]);
          const replay = ride(config, edge.index, side, result.inputs);
          expect(replay.hashes).toEqual(result.hashes);
          expect(replay.surfaces).toEqual(result.surfaces);
        }
      });

  it('still resets the racing bikes beyond real source coverage', () => {
    for (const bike of BIKES) {
      const config = configFor(bike);
      const { sim, world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider')!;
      const edge = config.road.edges.find(
        (e) => !config.road.lanesAt(e.index, e.length / 2).some((l) => l.direction === -1),
      )!;
      const s = edge.length / 2;
      const center = config.road.toWorld(edge.index, s, 0, 0);
      // Beyond the entire source footprint, not an arbitrary fixed distance that new land can fill.
      const d =
        Math.max(
          ...config.road.terrain!.patches.flatMap((patch) =>
            patch.vertices.map(([x, , z]) => Math.hypot(x - center.x, z - center.z)),
          ),
        ) + 20;
      me.pos = { edge: edge.index, s, d, dir: 1 };
      me.speed = config.riders[0]!.bike.topSpeedMps * 0.5;
      const p = config.road.toWorld(edge.index, s, d, 0);
      riderState(world).yAbs[me.id] = p.y;
      expect(terrainAt(config.road.terrain, p.x, p.z)).toBeNull();
      expect(roadBandHeight(config.road, edge.index, s, d)).toBeNull();
      sim.step([quantizeInput({ throttle: 0, brake: 0, steer: 1, flags: 0 })]);
      expect(sim.events().find((e) => e.type === 'crash' && e.actor === me.id)?.data).toMatchObject({
        cause: 'over',
        past: 'ground',
      });
      expect(me.mode).toBe('Tumble');
    }
  });
});
