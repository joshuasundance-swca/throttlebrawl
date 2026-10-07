// The carrier's hitbox parity (the maintainer, 2026-10-06, [decided]: "a road race in a physical world
// with honest edges: what is drawn is what is met, nothing is a ghost, nothing is an invisible wall"):
// no drawn part of a car carrier stands where the sim has nothing, and no rider passes through what is
// drawn. The live check of 2026-10-07 (polish P, mustFix 3) found the car on the carrier's top deck drawn
// and passed through: Causeway Sprint seed 1, 28 ticks inside it below its 3.96 m roof at 19 m/s. The car
// is gone from the model and from the sim (the coordinator's [default], vetoable: docs/content-packs.md,
// the `rampTruck` feature, and docs/architecture.md, "A car carrier's top deck is empty"); this is the
// check that it stays gone from both, against the real model.
//
// It lives under scripts/ because it reads both sides, the sim's own heights and the render's model,
// which no module may import together (docs/architecture.md, module map; scripts/hitboxes.test.ts is
// the same audit for footprints). The parked carrier's model is the committed GLB the road scene
// stands on a `rampTruck` feature; the moving carrier is the procedural figure `carCarrier`.
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { HEIGHT_TOLERANCE_M } from '../src/core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedFeature } from '../src/road';
import type { SimConfig } from '../src/sim/api';
import { MOVING_DECKS_KEY } from '../src/sim/types';
import { movingDeckOf, MOVING } from '../src/sim/modifiers/moving';
import { deckHeight, movingDecks, truckBodyTop } from '../src/sim/riders/features';
import { input, riderHarness, testConfig } from '../src/sim/riders/testing';
import { createWorld } from '../src/sim/world';
import { mergeBoxes } from '../src/render/geometry';
import { bakeRepoModel } from '../src/render/model-files.test-util';
import { TRAFFIC_FIGURE_HEIGHT_M, TRAFFIC_FIGURE_PARTS } from '../src/render/traffic-figures';

/** The parked carrier: the feature's defaults (13.7 degrees, 11.5 m, 2.8 m lip), the model's 2.5 m width, 21.1 m long. */
const TRUCK: BakedFeature = {
  kind: 'rampTruck',
  id: 'carrier-parity',
  s0: 600,
  s1: 621.1,
  d0: 2.15,
  d1: 4.65,
  params: { rampLengthM: 11.5, lipHeightM: 2.8 },
};
const MID = (TRUCK.d0 + TRUCK.d1) / 2;
const LENGTH = TRUCK.s1 - TRUCK.s0;
/** The ramp's run, the lip platform's end, and where the cab starts: along the truck from its foot (the model's own). */
const RUN = 11.5;
const DECK_FROM = 11.95;
const CAB_FROM = 16.8;

function configWith(features: BakedFeature[]): SimConfig {
  const base = testConfig();
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 3000, kappa: 0 }]);
  const road0 = bundle.roads[0];
  if (!road0) throw new Error('no road');
  const road = createRoadNetwork({ ...bundle, roads: [{ ...road0, features }] });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return { ...base, road, route };
}

/** The top a ray from above meets on `meshes` at (x, z), m above the road; null when it meets none. */
function topOf(meshes: readonly Mesh[], x: number, z: number): number | null {
  const hit = new Raycaster(new Vector3(x, 20, z), new Vector3(0, -1, 0), 0, 40).intersectObjects(
    [...meshes],
    false,
  )[0];
  return hit ? hit.point.y : null;
}

function meshOf(g: BufferGeometry): Mesh {
  const mesh = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** What stood on the carrier's top deck before: the model's convertible, 4.5 m long and 1.8 m wide, its top at 3.92 m. */
function oldTopCar(): Mesh {
  const g = new BoxGeometry(1.8, 3.92 - 2.8, 4.5);
  g.translate(0, 2.8 + (3.92 - 2.8) / 2, 11.95 + 4.5 / 2);
  return meshOf(g);
}

describe('the parked carrier: nothing drawn stands where the sim has nothing', async () => {
  const model = await bakeRepoModel('truck');
  const g = model.variants[0];
  if (!g) throw new Error('no truck model');
  const drawn = [meshOf(g.clone())];
  const config = configWith([TRUCK]);
  const simTop = (into: number, x: number) => deckHeight(config, 0, TRUCK.s0 + into, MID + x);

  /** Every sampled point of the truck where the drawn top stands above the sim's, by more than the tolerance. */
  function ghosts(meshes: readonly Mesh[]) {
    const out: { into: number; x: number; drawn: number; sim: number }[] = [];
    for (let into = 0.1; into < LENGTH - 0.05; into += 0.1)
      for (const x of [-1.1, -0.5, 0, 0.5, 1.1]) {
        const top = topOf(meshes, x, into);
        if (top !== null && top > simTop(into, x) + HEIGHT_TOLERANCE_M)
          out.push({ into, x, drawn: top, sim: simTop(into, x) });
      }
    return out;
  }

  it('the model is the committed one: the ramp to the lip, a flat deck, the cab: and its zones are the sim’s', () => {
    expect(RUN).toBe(11.5);
    expect(DECK_FROM).toBeCloseTo(RUN + 0.45, 9);
    // The sim's zones, read from its own heights: the platform and the empty deck at the lip's height, the cab above.
    expect(simTop(RUN - 0.01, 0)).toBeCloseTo(2.8, 1);
    for (const into of [RUN + 0.1, DECK_FROM + 0.05, 14, CAB_FROM - 0.05]) expect(simTop(into, 0)).toBe(2.8);
    for (const into of [17.5, 19, 20.5]) expect(simTop(into, 0)).toBeCloseTo(topOf(drawn, 0, into) ?? 0, 1);
    expect(simTop(17.5, 0)).toBeCloseTo(3.15, 9);
    expect(simTop(20, 0)).toBeLessThan(2.05);
    expect(simTop(16.9, 1.05)).toBeCloseTo(truckBodyTop(TRUCK), 9);
  });

  it('no part of the drawn truck stands above what the sim holds there (to the height tolerance)', () => {
    const found = ghosts(drawn);
    console.log(
      `[examined] parked carrier: ${(LENGTH / 0.1) | 0} lengths x 5 widths, drawn top against the sim's; ghosts ${found.length}`,
    );
    expect(found).toEqual([]);
  });

  it('roof, hood, stacks and mirrors match in both directions; no tall invisible cab box', () => {
    const points = [
      [16.9, 0],
      [16.9, 1.05],
      [17.5, 0],
      [17.5, 1.25],
      [18.78, 1.33],
      [19.6, 0],
      [19.6, 1.1],
      [20, 0],
      [20, 1.2],
      [21, 0],
    ] as const;
    for (const [into, x] of points) {
      expect(
        Math.abs(simTop(into, x) - (topOf(drawn, x, into) ?? 0)),
        `surface at ${into}, x ${x}`,
      ).toBeLessThanOrEqual(HEIGHT_TOLERANCE_M);
    }
  });

  it('the top deck is empty: drawn at the lip height from the platform to the cab, no car above it', () => {
    let highest = 0;
    for (let into = DECK_FROM + 0.1; into < CAB_FROM - 0.1; into += 0.1)
      for (const x of [-0.9, -0.4, 0, 0.4, 0.9]) {
        const top = topOf(drawn, x, into);
        expect(top, `deck at +${into.toFixed(1)} m, x ${x}`).not.toBeNull();
        highest = Math.max(highest, top ?? 0);
        // The deck itself, to the tolerance: not a gap in it, and nothing standing on it.
        expect(Math.abs((top ?? 0) - 2.8), `deck at +${into.toFixed(1)} m, x ${x}`).toBeLessThan(
          HEIGHT_TOLERANCE_M,
        );
      }
    console.log(
      `[examined] the highest drawn point over the top deck: ${highest.toFixed(2)} m (the lip: 2.8)`,
    );
  });

  it('the check can find a ghost: put the old top car back and it fails (control)', () => {
    const found = ghosts([...drawn, oldTopCar()]);
    const inCar = found.filter((f) => f.into >= 11.95 && f.into <= 16.45 && f.x >= -0.9 && f.x <= 0.9);
    console.log(
      `[examined] control, the old car back: ${found.length} ghost points, ${inCar.length} of them over the car`,
    );
    expect(inCar.length).toBeGreaterThan(20);
    expect(Math.max(...inCar.map((f) => f.drawn - f.sim))).toBeGreaterThan(1);
  });

  /** Ticks a rider spends with its middle below the drawn top of the truck over it, riding the ramp up at `speed`. */
  function insideTicks(meshes: readonly Mesh[], speed: number) {
    const h = riderHarness(config, { s: TRUCK.s0 - 20, d: MID, speed });
    let ticks = 0;
    let cabTicks = 0;
    let worst = 0;
    for (let t = 0; t < 60 * 8; t++) {
      const events = h.step(input(h.rider.speed < speed ? 1 : 0));
      const into = h.rider.pos.s - TRUCK.s0;
      if (into < 0 || into > LENGTH) {
        if (events.some((e) => e.type === 'crash')) break;
        continue;
      }
      const top = topOf(meshes, h.rider.pos.d - MID, into);
      const depth = top === null ? 0 : top - h.rider.h;
      if (depth > 0.1) {
        ticks++;
        if (into >= CAB_FROM) cabTicks++;
        worst = Math.max(worst, depth);
      }
      // Examine the contact pose too. This rider-only harness has no tumble system, so stop
      // after its first crash instead of continuing to drive an already crashed rider.
      if (events.some((e) => e.type === 'crash')) break;
    }
    return { ticks, cabTicks, worst };
  }

  it('nobody rides through what is drawn over the top deck, at the speeds that cleared (19.4 and 24 m/s: the live check)', () => {
    const lines: string[] = [];
    for (const v of [19.4, 24, 28, 36]) {
      const r = insideTicks(drawn, v);
      lines.push(`${v} m/s: ${r.ticks} ticks inside, ${r.cabTicks} in the cab`);
      expect(r.ticks, `${v} m/s`).toBe(0);
    }
    console.log(`[examined] a rider's middle below the drawn top, flying the carrier: ${lines.join('; ')}`);
  });

  it('the control: with the old top car drawn, 19.4 m/s rides through it for 10 ticks or more (28 on the live link, its own lip speeds)', () => {
    const r = insideTicks([...drawn, oldTopCar()], 19.4);
    console.log(
      `[examined] control, the old car drawn: ${r.ticks} ticks inside, worst ${r.worst.toFixed(2)} m`,
    );
    expect(r.ticks).toBeGreaterThanOrEqual(10);
  });

  it('the cab is met by height, including speeds that used to pass through it', () => {
    const lines: string[] = [];
    for (const v of [10.8, 12, 14, 16, 19.4]) {
      const r = insideTicks(drawn, v);
      lines.push(`${v} m/s: ${r.cabTicks} ticks inside the drawn cab`);
      expect(r.cabTicks, `${v} m/s`).toBe(0);
    }
    console.log(`[examined] the cab, strict drawn-geometry parity: ${lines.join('; ')}`);
    expect(insideTicks(drawn, 19.4).cabTicks).toBe(0);
  });
});

describe('the moving carrier: its figure draws nothing over the deck, and no car', () => {
  const LENGTH_M = 7.5;
  const WIDTH_M = 2.4;
  const REAR = LENGTH_M / 2;
  const bare = configWith([]);
  const world = createWorld(bare);
  const dm = movingDeckOf({
    vehicle: 99,
    edge: 0,
    foot: 1000,
    dir: 1,
    d: 3.4,
    speedMps: 20,
    lengthM: LENGTH_M,
    widthM: WIDTH_M,
  });
  world.systems[MOVING_DECKS_KEY] = { live: [dm] };
  const { now } = movingDecks(world, 1 / 60);
  const simTop = (into: number, x = 0) => deckHeight(bare, 0, 1000 + into, 3.4 + x, { moving: now });
  const BODY_FROM = MOVING.rampRunM + (0.45 * MOVING.rampRunM) / 11.5;

  function figure(fig: 'carCarrier' | 'carCarrierRamp') {
    const m = mergeBoxes(TRAFFIC_FIGURE_PARTS[fig]).clone();
    m.scale(WIDTH_M, TRAFFIC_FIGURE_HEIGHT_M[fig], LENGTH_M);
    return meshOf(m);
  }
  /** Where the figure is drawn, along it from its rear, in the sim's frame (+z is the rear). */
  const drawnTop = (mesh: Mesh, into: number, x = 0) => topOf([mesh], x, REAR - into);

  it('the sim: a ramp, a lip platform, then the cab from the platform’s end (no top deck: it carries nothing)', () => {
    expect(simTop(MOVING.rampRunM - 0.01)).toBeCloseTo(dm.lipHeightM, 1);
    expect(simTop(BODY_FROM - 0.05)).toBeCloseTo(dm.lipHeightM, 9);
    expect(simTop(BODY_FROM + 0.05)).toBeCloseTo(dm.lipHeightM, 9);
    expect(simTop(LENGTH_M - 0.1)).toBeCloseTo(dm.lipHeightM, 9);
  });

  it('no part is drawn above the deck’s level before the sim’s body starts (no car, nothing over the lip platform)', () => {
    for (const fig of ['carCarrier', 'carCarrierRamp'] as const) {
      const mesh = figure(fig);
      let highest = 0;
      for (let into = MOVING.rampRunM + 0.1; into < BODY_FROM - 0.05; into += 0.05)
        for (const x of [-0.8, 0, 0.8]) {
          const top = drawnTop(mesh, into, x);
          highest = Math.max(highest, top ?? 0);
          expect(top ?? 0, `${fig} at +${into.toFixed(2)} m`).toBeLessThan(
            dm.lipHeightM + HEIGHT_TOLERANCE_M,
          );
        }
      console.log(
        `[examined] ${fig}: highest drawn point over the lip platform ${highest.toFixed(2)} m (the lip ${dm.lipHeightM.toFixed(2)} m)`,
      );
    }
  });

  it('the moving cab, rack and light have their drawn heights at their own footprints', () => {
    const mesh = figure('carCarrier');
    let drawnHighest = 0;
    for (let into = BODY_FROM; into < LENGTH_M - 0.05; into += 0.05)
      for (const x of [-0.8, 0, 0.8]) {
        const top = drawnTop(mesh, into, x) ?? 0;
        drawnHighest = Math.max(drawnHighest, top);
        expect(
          Math.abs(top - simTop(into, x)),
          `moving cab at ${into.toFixed(2)}, x ${x}`,
        ).toBeLessThanOrEqual(HEIGHT_TOLERANCE_M);
      }
    const sim = simTop(LENGTH_M - 0.5);
    const box = new Box3().setFromObject(mesh);
    console.log(
      `[examined] the moving carrier's cab: drawn up to ${drawnHighest.toFixed(2)} m, the sim's body top ${sim.toFixed(2)} m (figure ${box.max.y.toFixed(2)} m tall)`,
    );
    expect(drawnHighest - truckBodyTop(now[0] as BakedFeature)).toBeLessThanOrEqual(HEIGHT_TOLERANCE_M);
  });
});
