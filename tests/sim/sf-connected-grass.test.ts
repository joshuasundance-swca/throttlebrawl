/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { hitboxOf } from '../../src/core';
import {
  courseAt,
  landEdgeOf,
  planStreetFurniture,
  roadBandHeight,
  roadsideGroundHeight,
  sectionGroundOf,
} from '../../src/road';
import { quantizeInput, type SimInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { groundUnder } from '../../src/sim/ground';
import { riderState } from '../../src/sim/riders';
import { input, riderHarness } from '../../src/sim/riders/testing';
import { firstSeed, ISOLATED, seedRange } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const { config } = createHeadlessRace(
  {
    seed: 1,
    eventId: 'region-sf:sf-t3-twin-peaks',
    route: 'region-sf:osm-sf-twin-peaks-run',
    playerBike: 'base:rustbucket-400',
    eventPatch: { riders: [] },
    tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1, 'riders.furniture': 1 },
  },
  { registry },
);
const climb = config.road.edges.find((e) => e.id === 'osm-sf-twin-peaks-climb')!;
const noStructures = { items: [], cellM: 32, cells: new Map() };

function connectedPoint(): { s: number; side: -1 | 1 } {
  const ground = sectionGroundOf(config.road);
  const edge = landEdgeOf(config.road);
  for (let s = 200; s < climb.length - 200; s += 20)
    for (const side of [1, -1] as const) {
      const verge = config.road.vergeAt(climb.index, s, side > 0 ? 'right' : 'left');
      const d = verge.dOuter + side * 2;
      const stripOuter = side * ((side > 0 ? climb.dMax : -climb.dMin) + 0.6 + edge(climb.index, side, s));
      const beyond = stripOuter + side * 2;
      if (verge.edge !== 'soft' || verge.surface !== 'grass') continue;
      if (Math.abs(config.road.kappaAt(climb.index, s)) > 0.004) continue;
      if (ground(climb.index, s, d) === null) continue;
      if (roadsideGroundHeight(config.road, climb.index, s, d) === null) continue;
      if (
        edge(climb.index, side, s) < 8 ||
        roadsideGroundHeight(config.road, climb.index, s, beyond) !== null
      )
        continue;
      if (
        courseAt(
          config.road,
          noStructures,
          { edge: climb.index, s, d: beyond },
          config.road.surfaceHeight(climb.index, s, beyond) + 0.1,
        ).kind !== 'out'
      )
        continue;
      return { s, side };
    }
  throw new Error('Twin Peaks has no measured continuous soft grass and true strip edge');
}
const crossing = connectedPoint();

function ride(commands?: readonly SimInput[]) {
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers.find((m) => m.kind === 'rider')!;
  const { side, s } = crossing;
  const lane = config.road.lanesAt(climb.index, s).find((l) => l.kind === 'drive' && l.direction === 1)!;
  const box = hitboxOf(config.riders[me.riderIndex]?.hitbox);
  const asphalt = lane.dCenterM + (side * lane.widthM) / 2;
  me.pos = { edge: climb.index, s, d: asphalt - side * (box.widthM / 2 + 0.2), dir: 1 };
  me.speed = 9;
  me.yaw = side * 0.25;
  riderState(world).yAbs[me.id] = config.road.surfaceHeight(climb.index, s, me.pos.d);
  const inputs: SimInput[] = [],
    hashes: number[] = [],
    crashes: string[] = [];
  const surfaces: (string | null)[] = [];
  let beyondVerge = false,
    recovered = false,
    settled = 0;
  for (let tick = 0; tick < (commands?.length ?? 500); tick++) {
    const at = me.pos;
    const verge = config.road.vergeAt(at.edge, at.s, side > 0 ? 'right' : 'left').dOuter;
    beyondVerge ||= side * (at.d - verge) > box.widthM / 2 + 0.1;
    const input =
      commands?.[tick] ??
      quantizeInput({
        throttle: recovered ? 0.15 : 0.3,
        brake: 0,
        steer: recovered
          ? Math.max(-1, Math.min(1, (lane.dCenterM - at.d) * 0.5))
          : beyondVerge
            ? -side
            : side,
        flags: 0,
      });
    inputs.push(input);
    sim.step([input]);
    hashes.push(sim.hash());
    crashes.push(
      ...sim
        .events()
        .filter((e) => e.actor === me.id && e.type === 'crash')
        .map((e) => JSON.stringify(e.data)),
    );
    const surface = groundUnder(config.road, me.pos.edge, me.pos.s, me.pos.d, me.h);
    if (surfaces.at(-1) !== surface) surfaces.push(surface);
    if (beyondVerge && surface === 'asphalt' && side * (me.pos.d - asphalt) < -box.widthM / 2)
      recovered = true;
    if (recovered && ++settled >= 60) break;
    if (me.mode === 'Tumble') break;
  }
  return { beyondVerge, recovered, settled, crashes, surfaces, mode: me.mode, inputs, hashes };
}

describe('ordinary SF hill grass recovery', () => {
  it('rides asphalt, connected headlands grass, then asphalt without a boundary crash; replay matches', () => {
    const first = ride();
    expect(first.beyondVerge).toBe(true);
    expect(first.surfaces).toContain('grass');
    expect(first.recovered).toBe(true);
    expect(first.settled).toBe(60);
    expect(first.mode).toBe('Road');
    expect(first.crashes).toEqual([]);
    const replay = ride(first.inputs);
    expect(replay.hashes).toEqual(first.hashes);
    expect(replay.surfaces).toEqual(first.surfaces);
  });

  it('supports only the real connected strip, not its visible outer slope', () => {
    const { s, side } = crossing;
    const verge = config.road.vergeAt(climb.index, s, side > 0 ? 'right' : 'left');
    const d = verge.dOuter + side * 2;
    const ground = sectionGroundOf(config.road);
    const stripEdge =
      side * ((side > 0 ? climb.dMax : -climb.dMin) + 0.6 + landEdgeOf(config.road)(climb.index, side, s));
    const outside = stripEdge + side * 2;
    expect(verge.edge).toBe('soft');
    expect(verge.surface).toBe('grass');
    expect(ground(climb.index, s, d)).not.toBeNull();
    expect(roadsideGroundHeight(config.road, climb.index, s, d)).toBe(ground(climb.index, s, d));
    expect(roadBandHeight(config.road, climb.index, s, d)).not.toBeNull();
    expect(
      courseAt(
        config.road,
        noStructures,
        { edge: climb.index, s, d },
        config.road.surfaceHeight(climb.index, s, d) + 0.1,
      ).kind,
    ).toBe('road');
    expect(roadsideGroundHeight(config.road, climb.index, s, outside)).toBeNull();
    expect(
      courseAt(
        config.road,
        noStructures,
        { edge: climb.index, s, d: outside },
        config.road.surfaceHeight(climb.index, s, outside) + 0.1,
      ),
    ).toEqual({ kind: 'out' });
  });

  it('meets a drawn summit outcrop as a solid object on the newly rideable grass', () => {
    const found = firstSeed(
      'Twin Peaks solid outcrop on connected grass',
      seedRange(1, 8),
      (seed) =>
        planStreetFurniture(config.road, seed).items.find(
          (p) =>
            p.kind === 'outcrop' &&
            p.edge === climb.index &&
            p.s > 20 &&
            roadsideGroundHeight(config.road, p.edge, p.s - 8, p.d) !== null,
        ) ?? null,
      (rock) => rock !== null,
    );
    const rock = found.result;
    expect(rock, 'the summit draws a solid outcrop on connected grass').not.toBeNull();
    const rideAtRock = (furniture: number) => {
      const configured = {
        ...config,
        seed: found.seed!,
        tuning: { ...config.tuning, 'riders.furniture': furniture },
      };
      const h = riderHarness(configured, { edge: rock!.edge, s: rock!.s - 8, d: rock!.d, speed: 18 });
      const events = [];
      for (let tick = 0; tick < 90; tick++) {
        events.push(...h.step(input(0.4)));
        if (events.some((e) => e.type === 'crash') || h.rider.pos.s > rock!.s + 5) break;
      }
      return { h, events };
    };
    const contact = rideAtRock(1);
    expect(contact.events.find((e) => e.type === 'crash')?.data).toMatchObject({
      cause: 'barrier',
      object: 'outcrop',
      furniture: String(rock!.id),
    });
    const control = rideAtRock(0);
    expect(control.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
    expect(control.h.rider.pos.s).toBeGreaterThan(rock!.s + 5);
  });
});
