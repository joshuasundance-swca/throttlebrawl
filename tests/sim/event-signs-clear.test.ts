/// <reference types="vite/client" />
// The road events' signs stand off every road's lanes (the maintainer, 2026-10-06: "a road race in a physical
// world with honest edges"). A sign is not touchable, so one in a lane is a ghost the rider rides through: the
// live check of 2026-10-06 saw the bot ride through serial signs standing on the lane line (d 4 to 5) of
// Bridge City's Burnside Bridge, West Burnside and Broadway South (seeds 3 and 1). Here the bot rides Bridge
// City with every shipped road event forced in, every sign the sim puts up (the set pieces' warning and serial
// signs, and the cops' END OF JURISDICTION sign) is drawn as render draws it (render/event-props.ts), and the
// ride column over every lane of every road (render/road-clear.test-util.ts, the check every network's still
// scene passes on every PR) must not be cut by any of it.
import { Group, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { EventProps } from '../../src/render/event-props';
import { createFlatLook } from '../../src/render/look';
import {
  floorOf,
  hitsIn,
  placeLine,
  placesOf,
  roadColumns,
  type RoadHit,
} from '../../src/render/road-clear.test-util';
import { print } from '../../src/render/scene-cost.test-util';
import { createSim, type PropSnapshot, type SimConfig, type SimSnapshot } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const BRIDGE_CITY = 'region-pnw:pnw-t1-bridge-city';
const MAX_TICKS = 60 * 60 * 8;

/** An event with every road event it can draw forced in (chance 1, no cap per race). */
function config(seed: number, eventId = BRIDGE_CITY): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, eventId, 'standard'), {
    seed,
    eventId,
    length: 'standard',
  });
  const { modifiersPerRace: _cap, ...event } = base.event;
  return { ...base, event, modifiers: base.modifiers.map((m) => ({ ...m, chance: 1 })) };
}

/** Every sign the sim put up over a race the bot rides (each by its id, where it first stood). */
function signsOf(cfg: SimConfig): PropSnapshot[] {
  const sim = createSim(cfg);
  const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const signs = new Map<number, PropSnapshot>();
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, cfg.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const p of snap.props ?? []) if (p.kind === 'sign' && !signs.has(p.id)) signs.set(p.id, { ...p });
  }
  return [...signs.values()];
}

/** The signs as render draws them: their posts and panels, in the world. */
function drawn(props: readonly PropSnapshot[]): Object3D {
  const e = new EventProps(createFlatLook());
  const snap: SimSnapshot = {
    tick: 1,
    timeScale: 1,
    entities: [],
    race: { over: false, routeLength: 1, finishOrder: [] },
    props: [...props],
  };
  e.sync(snap, 0);
  const g = new Group();
  g.name = 'event-signs';
  g.add(e.root);
  return g;
}

/** Where the drawn signs cut the ride column over every lane of every road of the network. */
function cuts(cfg: SimConfig, props: readonly PropSnapshot[]) {
  const hits = new Map<string, RoadHit>();
  hitsIn(roadColumns(cfg.road), drawn(props), floorOf, null, hits);
  return placesOf(hits.values());
}

describe("the road events' signs stand off every road's lanes", () => {
  beforeEach(() => {
    // A stand-in canvas: the signs print their panels only where there is a DOM.
    const own: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 12 }) };
    const ctx = new Proxy(own, {
      get: (target, key): unknown =>
        typeof key === 'string' && key in target ? target[key] : () => undefined,
      set: () => true,
    });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The races: Bridge City on the live check's seeds (its signs stood in the lanes there), and races whose
   * roads fit the pieces that carry serial signs (a log spill needs a downhill, a moving ramp a straight).
   */
  const RACES: readonly { event: string; seed: number; serial: boolean }[] = [
    { event: BRIDGE_CITY, seed: 1, serial: false },
    { event: BRIDGE_CITY, seed: 3, serial: false },
    { event: 'region-pnw:pnw-t2-logging-spur', seed: 1, serial: true },
    { event: 'base:keys-t3-long-haul', seed: 1, serial: true },
  ];
  for (const { event, seed, serial: wantSerial } of RACES)
    it(`${event}, seed ${seed}: no sign the sim puts up cuts the ride column`, () => {
      const cfg = config(seed, event);
      const signs = signsOf(cfg);
      const serial = signs.filter((p) => p.variant === 'serial').length;
      const places = cuts(cfg, signs);
      print(
        `[examined] ${event} seed ${seed}: ${signs.length} signs (${serial} serial), drawn and swept over every lane of every road`,
      );
      for (const p of places) print(`  IN THE ROAD: ${placeLine(p)}`);
      expect(signs.length).toBeGreaterThan(4);
      if (wantSerial) expect(serial).toBeGreaterThan(0);
      expect(places.map(placeLine)).toEqual([]);
    }, 300_000);

  it('the negative control: a serial sign on the lane line of the Burnside Bridge is found, one past its lanes is not', () => {
    const cfg = config(3);
    const road = cfg.road;
    const e = road.edgeIndex('osm-pnw-pdx-burnside-bridge');
    const s = 613;
    let hi = 0;
    for (const lane of road.lanesAt(e, s)) hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    const f = road.frameAt(e, s);
    const sign = (id: number, d: number): PropSnapshot => {
      const p = road.toWorld(e, s, d, 0);
      return {
        id,
        kind: 'sign',
        variant: 'serial',
        label: 'TEST',
        piece: 'test',
        x: p.x,
        y: p.y,
        z: p.z,
        heading: Math.atan2(-f.tx, -f.tz),
        tilt: 0,
        moving: false,
      };
    };
    // Where the live check met it: on the lane line, d 4.5.
    const onLine = cuts(cfg, [sign(1, 4.5)]);
    expect(onLine.map((p) => p.edge)).toContain('osm-pnw-pdx-burnside-bridge');
    // Its panel's near edge 0.3 m past the outermost lane: clear of the column.
    expect(cuts(cfg, [sign(2, hi + 1.1 + 0.3)]).map(placeLine)).toEqual([]);
  }, 300_000);
});
