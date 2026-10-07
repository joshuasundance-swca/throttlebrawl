/// <reference types="vite/client" />
// The ride-column check's twin for the road set pieces (the polish J live check, punch item 1: the Key West
// parade, San Francisco's roadwork and Bridge City's crash scene stood props in the lanes that the rider
// rode through with no contact). The maintainer, 2026-10-06: "a road race in a physical world with honest
// edges": everything drawn that a rider can reach is physical at its drawn shape, nothing is a ghost and
// nothing an invisible wall.
//
// src/render/road-clear*.test.ts sweep the still scene; set pieces only exist in a race. So this rides real
// races with every set piece of the region forced in (each modifier's chance 1, no cap per race), on the
// roads where the live check met them, takes every prop as it stands when its piece goes live, draws it
// alone with render's own EventProps, and collects each place a drawn triangle cuts the ride column over
// the lanes (road-clear.test-util.ts's column, 0.5 to 2 m over the asphalt). Each must be inside a sim shape
// of that prop (`propBoxes`, the one rule's contact boxes), or of the vehicle it rides on (traffic's box
// and height, traffic's one rule): a drawn part with no sim shape behind it fails, by road and s.
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { EventProps, signPanel } from '../../src/render/event-props';
import { createFlatLook } from '../../src/render/look';
import {
  hitsIn,
  RIDE_LOW_M,
  roadColumns,
  type RoadColumns,
  type RoadHit,
} from '../../src/render/road-clear.test-util';
import type { PropSnapshot, SimConfig } from '../../src/sim/api';
import { copsState, lawProps } from '../../src/sim/cops';
import { createSimWithWorld } from '../../src/sim/create';
import {
  ON_VEHICLE,
  PROP_CONTACT,
  propBoxes,
  propSnapshots,
  setPieceState,
} from '../../src/sim/modifiers/setpieces';
import { trafficHeightM } from '../../src/core';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

/** How far a drawn part may stand outside its sim shape, m (the hitbox audit's tolerance). */
const TOLERANCE_M = 0.15;
/**
 * A column point's box reaches this far round it, m: road-clear.test-util.ts's HALF_M (0.3) to a corner, the
 * box square to the world and the prop turned any way.
 */
const CELL_HALF_M = 0.3 * Math.SQRT2;

interface Race {
  name: string;
  event: string;
  length: string;
  route?: string;
  seed: number;
}

/** The races the live check rode (Key West's Smathers, San Francisco's hills, Bridge City), one region each. */
const RACES: readonly Race[] = [
  {
    name: 'Key West',
    event: 'base:m1-skeleton-sprint',
    length: 'standard',
    route: 'base:osm-key-west-run',
    seed: 1,
  },
  { name: 'San Francisco hills', event: 'region-sf:sf-hill-sprint', length: 'standard', seed: 1 },
  {
    name: 'Bridge City',
    event: 'region-pnw:pnw-fogline-run',
    length: 'standard',
    route: 'region-pnw:osm-bridge-city-run',
    seed: 1,
  },
];

/** A prop as it stood when its piece went live, and the box of the vehicle it rides on, if any. */
interface Seen {
  prop: PropSnapshot;
  vehicle: { x: number; z: number; heading: number; lengthM: number; widthM: number; heightM: number } | null;
}

function forced(r: Race): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, r.event, r.length, r.route), {
    seed: r.seed,
    eventId: r.event,
    length: r.length,
    ...(r.route ? { route: r.route } : {}),
  });
  const { modifiersPerRace: _cap, ...event } = base.event;
  return { ...base, event, modifiers: base.modifiers.map((m) => ({ ...m, chance: 1 })) };
}

/** Rides the race with the bot, keeping every prop the first time it stands still in a live piece. */
function ride(cfg: SimConfig): { seen: Seen[]; pieces: string[] } {
  const { sim, world } = createSimWithWorld(cfg);
  const pid = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const seen = new Map<number, Seen>();
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 60 * 8) {
    const actions = emptyActions();
    bot.drive(snap, pid, cfg.route, actions);
    sim.step([toSimInput(actions)]);
    if (sim.tick % 10 !== 0) continue;
    snap = sim.snapshot();
    const st = setPieceState(world);
    const drawn = new Map(propSnapshots(world, cfg).map((p) => [p.id, p]));
    for (const q of st.props) {
      const p = drawn.get(q.id);
      if (!p || seen.has(q.id) || q.moving) continue;
      let vehicle: Seen['vehicle'] = null;
      if (q.attach >= 0) {
        const v = snap.entities.find((e) => e.id === q.attach);
        const t = cfg.trafficTypes.find((x) => x.contentId === v?.contentId);
        if (!v || !t) continue;
        vehicle = {
          x: v.x,
          z: v.z,
          heading: v.heading,
          lengthM: t.lengthM,
          widthM: t.widthM,
          heightM: trafficHeightM(t),
        };
      }
      seen.set(q.id, { prop: p, vehicle });
    }
    // The law's own props (sim/cops: the END OF JURISDICTION sign, a radar trooper's radar) are drawn the same
    // way and met by the same rule (sim/modifiers/law-props.ts), so they are held to the same check.
    for (const p of lawProps(world, cfg))
      if (!seen.has(p.id) && !p.moving) seen.set(p.id, { prop: p, vehicle: null });
    if (st.pieces.length > 0 && st.pieces.every((p) => p.phase === 2)) break;
  }
  const pieces = setPieceState(world).pieces.map((p) => `${p.piece}${p.phase === 0 ? ' (never live)' : ''}`);
  return { seen: [...seen.values()], pieces };
}

/** A point in a thing's own frame: along its heading (a model faces -z) and across it (+x). */
function local(x: number, z: number, at: { x: number; z: number; heading: number }) {
  const dx = x - at.x;
  const dz = z - at.z;
  const c = Math.cos(at.heading);
  const s = Math.sin(at.heading);
  return { along: -(dx * s + dz * c), across: dx * c - dz * s };
}

/**
 * What sim shape a drawn hit is inside, or null: its vehicle's box (a prop riding one), or one of the prop's
 * own boxes (`propBoxes`, in the prop's frame, over its foot: a prop on a vehicle stands ON_VEHICLE's `up`).
 */
function shapeOf(seen: Seen, hit: RoadHit): string | null {
  const reach = CELL_HALF_M + TOLERANCE_M;
  const v = seen.vehicle;
  if (v) {
    const l = local(hit.x, hit.z, v);
    if (
      Math.abs(l.along) <= v.lengthM / 2 + reach &&
      Math.abs(l.across) <= v.widthM / 2 + reach &&
      hit.over <= v.heightM + TOLERANCE_M
    )
      return 'its vehicle';
  }
  const p = seen.prop;
  const foot = v ? (ON_VEHICLE[p.kind]?.up ?? 0) : 0;
  const l = local(hit.x, hit.z, p);
  for (const b of propBoxes(p.kind, p.variant, p.spanM ?? 0)) {
    if (Math.abs(l.along - b.along) > b.hu + reach || Math.abs(l.across - b.across) > b.hd + reach) continue;
    // The column reaches 2 m up; the hit's triangle starts `over` up. The box must overlap that.
    if (foot + b.top + TOLERANCE_M < Math.max(0.5, hit.over) || foot + b.bottom - TOLERANCE_M > 2) continue;
    return `its own (${b.solid ? 'solid' : PROP_CONTACT[p.kind]})`;
  }
  return null;
}

/** A sign's panel, drawn here as it is in the game (without a canvas EventProps leaves it out). */
function panelOf(p: PropSnapshot): Mesh {
  const { size, up } = signPanel(p.variant);
  const h = size / 2;
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute([-h, up, 0, h, up, 0, h, up + size, 0, -h, up + size, 0], 3),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new Mesh(g, new MeshBasicMaterial());
  m.name = 'sign-panel';
  m.position.set(p.x, p.y, p.z);
  m.rotation.set(0, p.heading, 0);
  return m;
}

/** What the game draws of one prop: render's EventProps with the prop alone (and a sign's panel). */
function drawnOf(look: ReturnType<typeof createFlatLook>, p: PropSnapshot): Group {
  const ep = new EventProps(look);
  ep.sync(
    {
      tick: 0,
      timeScale: 1,
      entities: [],
      race: { over: false, routeLength: 1, finishOrder: [] },
      props: [p],
    },
    0,
  );
  const root = new Group();
  root.add(ep.root);
  if (p.kind === 'sign') root.add(panelOf(p));
  return root;
}

/**
 * The cuts of the ride column by what is drawn for a prop (`drawn`, or the prop as render draws it), and the
 * deepest into the lanes that is inside no sim shape of it (null: every cut is inside one).
 */
function ghostOf(
  cols: RoadColumns,
  look: ReturnType<typeof createFlatLook>,
  s: Seen,
  drawn?: Object3D,
): { cuts: number; ghost: RoadHit | null } {
  const hits = new Map<string, RoadHit>();
  // Every part of a prop is tested as a wall from a rider's knees up (no part of it is ground: #641's floorOf).
  hitsIn(
    cols,
    drawn ?? drawnOf(look, s.prop),
    () => RIDE_LOW_M,
    { x: s.prop.x, z: s.prop.z, reach: 30 },
    hits,
  );
  let ghost: RoadHit | null = null;
  for (const h of hits.values()) if (shapeOf(s, h) === null && (!ghost || h.inset > ghost.inset)) ghost = h;
  return { cuts: hits.size, ghost };
}

/** Each race's ride, once (the negative control reuses Bridge City's). */
const rides = new Map<string, { cfg: SimConfig; seen: Seen[]; pieces: string[]; cols: RoadColumns }>();
function rideOf(race: Race) {
  let r = rides.get(race.name);
  if (!r) {
    const cfg = forced(race);
    r = { cfg, ...ride(cfg), cols: roadColumns(cfg.road) };
    rides.set(race.name, r);
  }
  return r;
}

describe('the ride column through every live set piece: what is drawn has a sim shape', () => {
  for (const race of RACES) {
    it(`${race.name}, seed ${race.seed}`, () => {
      const { seen, pieces, cols } = rideOf(race);
      const look = createFlatLook();
      const failures: string[] = [];
      const kinds = new Map<string, number>();
      let cut = 0;
      for (const s of seen) {
        const key = `${s.prop.kind}${s.prop.variant ? `:${s.prop.variant}` : ''}`;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
        const { cuts, ghost } = ghostOf(cols, look, s);
        cut += cuts;
        // A sign stands beside the road: what of it a rider reaches (a serial sign's panel, a post) is in no lane.
        if (s.prop.kind === 'sign' && cuts > 0)
          failures.push(`${key} (${s.prop.piece}) cuts the ride column ${cuts} times`);
        if (ghost)
          failures.push(
            `${key} (${s.prop.piece}, ${PROP_CONTACT[s.prop.kind]}${s.vehicle ? ', on a vehicle' : ''}) on ${ghost.edge} s ${ghost.s.toFixed(0)} d ${ghost.d.toFixed(1)}, ${ghost.over.toFixed(2)} m up: drawn with no sim shape`,
          );
      }
      print(
        `[examined] ${race.name} seed ${race.seed}: pieces ${pieces.join(', ')}; ${seen.length} props (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}); ${cut} column cuts`,
      );
      for (const f of failures) print(`  GHOST: ${f}`);
      // The check can see: the race's props cut the column (the cones, flares and people in the lanes).
      expect(cut, 'drawn props in the ride column').toBeGreaterThan(0);
      // The law's own sign stands in each of these races, so it is held to the same check (a ghost of it fails).
      expect(kinds.get('sign:jurisdiction'), 'the END OF JURISDICTION sign was in the check').toBe(1);
      expect(failures).toEqual([]);
    }, 600_000);
  }

  it('the negative control: a drawn part with no sim shape behind it is found, and one inside its shape is not', () => {
    const { seen, cols } = rideOf(RACES[2] as Race);
    const look = createFlatLook();
    // The hay load drawn with no truck under it, where the truck drove: the bales in the lane, no sim shape.
    const hay = seen.find((s) => s.prop.kind === 'hayLoad' && s.vehicle);
    expect(hay, 'a hay truck was live').toBeDefined();
    if (!hay) return;
    const loose = ghostOf(cols, look, { ...hay, vehicle: null });
    expect(loose.ghost, 'the hay with no truck').not.toBeNull();
    expect(ghostOf(cols, look, hay).ghost, 'the hay on its truck').toBeNull();
    // A float's skirt hung 1.5 m past the float's sides (it stands on the verge, its side 0.3 m past the lanes:
    // the old skirt's 0.35 to 0.45 m reached the Keys' column only where the lanes run to the verge), against
    // the same skirt at the float's own width.
    const float = seen.find((s) => s.prop.kind === 'floatDecor' && s.vehicle);
    expect(float, 'a parade float was live').toBeDefined();
    const skirt = (wide: number): Object3D => {
      const v = float?.vehicle;
      const m = new Mesh(
        new BoxGeometry((v?.widthM ?? 0) + 2 * wide, 0.9, v?.lengthM ?? 0),
        new MeshBasicMaterial(),
      );
      m.position.set(v?.x ?? 0, (float?.prop.y ?? 0) - 1.2 + 0.45, v?.z ?? 0);
      m.rotation.set(0, v?.heading ?? 0, 0);
      return m;
    };
    if (!float) return;
    const wide = ghostOf(cols, look, float, skirt(1.5));
    expect(wide.ghost, 'a skirt 1.5 m past the float').not.toBeNull();
    expect(ghostOf(cols, look, float, skirt(0)).ghost, 'a skirt at the float').toBeNull();
    print(
      `[examined] control: the hay load with no truck, ${loose.cuts} cuts, a ghost on ${loose.ghost?.edge} s ${loose.ghost?.s.toFixed(0)}; a skirt 1.5 m past a float (${float.prop.piece}), ${wide.cuts} cuts, a ghost on ${wide.ghost?.edge} s ${wide.ghost?.s.toFixed(0)}; at the float's width, none`,
    );
  }, 600_000);

  it("the negative control for the law's own sign: its post drawn in a lane has no sim shape and is found; the sign where it stands is not", () => {
    const { cfg, seen, cols } = rideOf(RACES[2] as Race);
    const look = createFlatLook();
    const sign = seen.find((s) => s.prop.kind === 'sign' && s.prop.variant === 'jurisdiction');
    expect(sign, 'the sheriff sign stood').toBeDefined();
    if (!sign) return;
    expect(ghostOf(cols, look, sign).ghost, 'the sign where it stands').toBeNull();
    // The same post, 3.6 m of it, 0.14 m square, drawn at d 1.5 on the road the sign stands by (a lane).
    const { world } = createSimWithWorld(cfg);
    const st = copsState(world);
    const at = cfg.road.toWorld(st.lineEdge, st.lineS, 1.5, 0);
    const post = new Mesh(new BoxGeometry(0.14, 3.6, 0.14), new MeshBasicMaterial());
    post.position.set(at.x, at.y + 1.8, at.z);
    const lane = ghostOf(cols, look, sign, post);
    expect(lane.cuts, 'the post cuts the ride column').toBeGreaterThan(0);
    expect(lane.ghost, 'the post in a lane has no sim shape').not.toBeNull();
    print(
      `[examined] control: the law sign's post drawn in a lane, ${lane.cuts} cuts, a ghost on ${lane.ghost?.edge} s ${lane.ghost?.s.toFixed(0)}; the sign where it stands, none`,
    );
  }, 600_000);
});
