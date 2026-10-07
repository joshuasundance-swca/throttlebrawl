// The set pieces' props, drawn against the sim's shapes for them, wherever they stand (the maintainer,
// 2026-10-06: "a road race in a physical world with honest edges": everything drawn that a rider can reach is
// physical at its drawn shape, nothing a ghost and nothing an invisible wall). The hitbox audit
// (hitboxes.test.ts) holds the props riders ran through before (the cone, the flare, the sawhorse, the bale and
// the log); this holds every other kind the sim sends (PROP_KINDS): each drawn triangle of a prop, as render's
// EventProps draws it (its read-at-speed scale, a waving arm through its whole wave), lies inside one of the
// sim's boxes for it (`propBoxes`), or inside the vehicle it rides on (the packs' own pairs: a float and its
// dressing, the work truck and its arrow board, the tow truck and its light bar, the farm truck and its hay),
// or wholly over everyone; and each box is no bigger than what is drawn in it, each face within the
// tolerance. tests/sim/set-piece-ride-column.test.ts is its twin in the lanes of real races.
//
// Under scripts/ because it reads both sides, the sim's shapes and the render's drawings.
import { readdirSync, readFileSync } from 'node:fs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { trafficHeightM, type TrafficCategory } from '../src/core';
import { EventProps, GANTRY_POST_OUT_M, signPanel } from '../src/render/event-props';
import { createFlatLook } from '../src/render/look';
import { PROP_KINDS, type PropKind, type PropSnapshot } from '../src/sim/api';
import { LAW_PROP_LOOKS } from '../src/sim/cops';
import {
  GANTRY_POST,
  ON_VEHICLE,
  PROP_CONTACT,
  propBoxes,
  SET_PIECE,
  type PropBox,
} from '../src/sim/modifiers/setpieces';

/** How far a drawn part may sit outside its box, and a box's face from what is drawn in it, m (the audit's). */
const TOLERANCE_M = 0.15;
/**
 * Parts of a prop standing on the road whose lowest point is this high are over everyone, m: a rider on the
 * road tops out at 2 m, and nothing near a set piece lifts one this high (pieces keep off ramps and pads).
 * The gantry's beam (from 6.07 m) and its panel (from 4.25 m) are over it. [default]
 */
const OVERHEAD_M = 4;
/** A triangle thinner than this in two of its sizes is a wire's (the balloon's tether), m. */
const WIRE_M = 0.06;
const look = createFlatLook();

function prop(kind: PropKind, variant = '', extra: Partial<PropSnapshot> = {}): PropSnapshot {
  return {
    id: 7,
    kind,
    variant,
    label: '',
    piece: 'test',
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    tilt: 0,
    moving: false,
    ...extra,
  };
}

/** A drawn triangle in the prop's own frame: `along` its way (-z), `across` to its right (+x), `y` up. */
interface Tri {
  along: [number, number, number];
  across: [number, number, number];
  y: [number, number, number];
}

/** Every triangle render draws for a prop standing at the origin facing -z, at each wall-clock time given. */
function drawn(p: PropSnapshot, times: readonly number[] = [0]): Tri[] {
  const out: Tri[] = [];
  const v = new Vector3();
  const m = new Matrix4();
  for (const t of times) {
    const ep = new EventProps(look);
    ep.sync(
      {
        tick: 0,
        timeScale: 1,
        entities: [],
        race: { over: false, routeLength: 1, finishOrder: [] },
        props: [p],
      },
      t,
    );
    ep.root.updateMatrixWorld(true);
    ep.root.traverse((o) => {
      if (!(o instanceof Mesh) || !o.visible) return;
      const g = (o as Mesh<BufferGeometry>).geometry;
      const pos = g.getAttribute('position');
      if (!pos) return;
      const idx = g.index;
      const count = idx ? idx.count : pos.count;
      const start = g.drawRange.start;
      const end = Math.min(count, Number.isFinite(g.drawRange.count) ? start + g.drawRange.count : count);
      const n = o instanceof InstancedMesh ? o.count : 1;
      for (let k = 0; k < n; k++) {
        if (o instanceof InstancedMesh) {
          o.getMatrixAt(k, m);
          m.premultiply(o.matrixWorld);
        } else m.copy(o.matrixWorld);
        for (let i = start; i + 2 < end; i += 3) {
          const tri: Tri = { along: [0, 0, 0], across: [0, 0, 0], y: [0, 0, 0] };
          for (let j = 0; j < 3; j++) {
            v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(m);
            tri.along[j] = -v.z;
            tri.across[j] = v.x;
            tri.y[j] = v.y;
          }
          out.push(tri);
        }
      }
    });
    // A sign's panel: a square facing the riders, `up` over the foot (EventProps leaves it out with no canvas).
    if (p.kind === 'sign') {
      const { size, up } = signPanel(p.variant);
      const h = size / 2;
      for (const [a, b, c] of [
        [
          [-h, up],
          [h, up],
          [h, up + size],
        ],
        [
          [-h, up],
          [h, up + size],
          [-h, up + size],
        ],
      ] as const)
        out.push({ along: [0, 0, 0], across: [a[0], b[0], c[0]], y: [a[1], b[1], c[1]] });
    }
  }
  return out;
}

/** A long, thin triangle (a side of the balloon's tether, however it sways): under WIRE_M across, over 0.5 m long. */
function isWire(t: Tri): boolean {
  const p = [0, 1, 2].map((j) => new Vector3(t.along[j], t.y[j], t.across[j]));
  const [a, b, c] = p as [Vector3, Vector3, Vector3];
  const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  const area = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  return longest > 0.5 && (2 * area) / longest < WIRE_M;
}
/** Whether a triangle (in the prop's frame, its heights over the prop's foot) lies inside a box. */
const inBox = (t: Tri, b: PropBox) =>
  [0, 1, 2].every(
    (j) =>
      Math.abs((t.along[j] ?? 0) - b.along) <= b.hu + TOLERANCE_M &&
      Math.abs((t.across[j] ?? 0) - b.across) <= b.hd + TOLERANCE_M &&
      (t.y[j] ?? 0) >= b.bottom - TOLERANCE_M &&
      (t.y[j] ?? 0) <= b.top + TOLERANCE_M,
  );

/**
 * How far each face of a box sits from what is drawn inside it, m (the most of the six), or Infinity with
 * nothing in it. A box reaching down into the vehicle it rides on (a float's centrepiece, solid from the
 * ground) leaves its bottom out: below the deck is the vehicle's own box.
 */
function berth(tris: readonly Tri[], b: PropBox, onVehicle = false): number {
  const box = new Box3();
  for (const t of tris) {
    if (!inBox(t, b)) continue;
    for (let j = 0; j < 3; j++) box.expandByPoint(new Vector3(t.along[j], t.y[j], t.across[j]));
  }
  if (box.isEmpty()) return Infinity;
  return Math.max(
    Math.abs(box.min.x - (b.along - b.hu)),
    Math.abs(box.max.x - (b.along + b.hu)),
    Math.abs(box.min.z - (b.across - b.hd)),
    Math.abs(box.max.z - (b.across + b.hd)),
    onVehicle ? 0 : Math.abs(box.min.y - b.bottom),
    Math.abs(box.max.y - b.top),
  );
}

interface Vehicle {
  id: string;
  lengthM: number;
  widthM: number;
  heightM: number;
}

/** The parts of a prop outside every shape the sim has for it, as a line each (none: all inside one). */
function outside(p: PropSnapshot, tris: readonly Tri[], vehicle: Vehicle | null): string[] {
  const on = vehicle ? ON_VEHICLE[p.kind] : undefined;
  const foot = on?.up ?? 0;
  const boxes = propBoxes(p.kind, p.variant, p.spanM ?? 0);
  const out: string[] = [];
  for (const t of tris) {
    if (isWire(t)) continue;
    if (!vehicle && Math.min(...t.y) >= OVERHEAD_M) continue;
    if (boxes.some((b) => inBox(t, b))) continue;
    // On a vehicle: its box, the prop `along` its middle and `up` over the road.
    if (
      vehicle &&
      on &&
      [0, 1, 2].every(
        (j) =>
          Math.abs((t.along[j] ?? 0) + on.along) <= vehicle.lengthM / 2 + TOLERANCE_M &&
          Math.abs(t.across[j] ?? 0) <= vehicle.widthM / 2 + TOLERANCE_M &&
          (t.y[j] ?? 0) + foot <= vehicle.heightM + TOLERANCE_M,
      )
    )
      continue;
    out.push(
      `along ${Math.min(...t.along).toFixed(2)}..${Math.max(...t.along).toFixed(2)}, across ${Math.min(...t.across).toFixed(2)}..${Math.max(...t.across).toFixed(2)}, ${(foot + Math.min(...t.y)).toFixed(2)}..${(foot + Math.max(...t.y)).toFixed(2)} m up`,
    );
  }
  return out;
}

// ---- the packs' own pairs ------------------------------------------------------------------------------------

const PACKS = ['base', 'region-pnw', 'region-sf'] as const;
function jsonIn<T>(dir: string): T[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as T);
  } catch {
    return [];
  }
}
const TYPES = new Map<string, Vehicle>();
for (const pack of PACKS)
  for (const t of jsonIn<{
    type: string;
    id: string;
    lengthM: number;
    widthM: number;
    heightM?: number;
    category: TrafficCategory;
  }>(`packs/${pack}/traffic`))
    if (t.type === 'traffic-type')
      TYPES.set(`${pack}:${t.id}`, {
        id: `${pack}:${t.id}`,
        lengthM: t.lengthM,
        widthM: t.widthM,
        heightM: trafficHeightM(t),
      });
const typeOf = (pack: string, ref: string) => TYPES.get(ref.includes(':') ? ref : `${pack}:${ref}`);

interface Pair {
  piece: string;
  kind: PropKind;
  variant: string;
  vehicle: Vehicle;
}

/** Every prop the packs' set pieces put on a vehicle, with the vehicle (render draws a float's dressing by theme). */
function pairs(): Pair[] {
  const out: Pair[] = [];
  for (const pack of PACKS)
    for (const m of jsonIn<{ id: string; effects: Record<string, unknown>[] }>(`packs/${pack}/modifiers`))
      for (const e of m.effects) {
        if (e['kind'] !== 'set-piece') continue;
        const theme = typeof e['theme'] === 'string' ? e['theme'] : '';
        const piece = `${pack}:${m.id}`;
        const add = (kind: PropKind, variant: string, ref: unknown) => {
          const vehicle = typeof ref === 'string' ? typeOf(pack, ref) : undefined;
          expect(vehicle, `${piece}: its vehicle ${String(ref)}`).toBeDefined();
          if (vehicle) out.push({ piece, kind, variant, vehicle });
        };
        if (e['piece'] === 'roadwork') add('arrowBoard', theme, e['vehicle']);
        if (e['piece'] === 'crash-scene') add('lightbar', theme, e['vehicle']);
        if (e['piece'] === 'hay-spill') add('hayLoad', theme, e['vehicle']);
        if (e['piece'] === 'parade') {
          const floats = Array.isArray(e['floats']) ? e['floats'] : [];
          floats.forEach((ref, i) => {
            add('floatDecor', `${theme}-${i}`, ref);
            if (i === 0 && e['inflatable'] === true) add('inflatable', theme, ref);
          });
        }
      }
  return out;
}

/** People's looks: every one render draws (and the packs' and the sim's defaults). */
const PEOPLE = [
  'flagger',
  'cop-waving',
  'cop-radar',
  'marcher-keys',
  'marcher-pnw',
  'marcher-sf',
  'marcher',
  'crossing-guard',
];
/** A waving arm's whole wave: wall-clock seconds over the slowest wave's period (3 rad/s, about 2.1 s). */
const WAVE = Array.from({ length: 22 }, (_, i) => i * 0.1);

describe('set-piece props: what is drawn is what the sim meets (the physical world, 2026-10-06)', () => {
  it('every prop kind the sim sends has a contact rule, and every rule but `vehicle` and `overhead` has boxes', () => {
    expect(Object.keys(PROP_CONTACT).sort()).toEqual([...PROP_KINDS].sort());
    for (const kind of PROP_KINDS) {
      const rule = PROP_CONTACT[kind];
      const own = propBoxes(kind, kind === 'floatDecor' ? 'keys-0' : '', 8);
      if (rule === 'vehicle' || rule === 'overhead') expect(ON_VEHICLE[kind], kind).toBeDefined();
      else expect(own.length, kind).toBeGreaterThan(0);
    }
  });

  it('every prop sim/cops puts up has the contact of what it is drawn as: light, with boxes (law-props.ts meets them)', () => {
    for (const [kind, variant] of Object.entries(LAW_PROP_LOOKS)) {
      expect(['light', 'standing'], `law ${kind}`).toContain(PROP_CONTACT[kind as PropKind]);
      expect(propBoxes(kind as PropKind, variant).length, `law ${kind}'s boxes`).toBeGreaterThan(0);
    }
    // The control: a rule that law-props.ts does not meet (a solid or a vehicle's) is not a law prop's.
    expect(['light', 'standing']).not.toContain(PROP_CONTACT.gantry);
    expect(['light', 'standing']).not.toContain(PROP_CONTACT.floatDecor);
  });

  it('each prop standing on the road is drawn inside its boxes, and each box is what is drawn in it', () => {
    const cases: { name: string; p: PropSnapshot; times?: readonly number[] }[] = [
      { name: 'radar', p: prop('radar', 'keys') },
      { name: 'warning sign', p: prop('sign', 'roadwork') },
      // The law's own props (sim/cops), drawn as the set pieces' sign and radar and met by the same boxes.
      ...Object.entries(LAW_PROP_LOOKS).map(([kind, variant]) => ({
        name: `law ${kind} (${variant})`,
        p: prop(kind as PropKind, variant),
      })),
      { name: 'serial sign', p: prop('sign', 'serial') },
      ...PEOPLE.map((v) => ({ name: `person ${v}`, p: prop('person', v), times: WAVE })),
      ...[4, 6.8, 8, 12].map((spanM) => ({ name: `gantry ${spanM} m`, p: prop('gantry', '', { spanM }) })),
    ];
    const lines: string[] = [];
    for (const c of cases) {
      const tris = drawn(c.p, c.times);
      const off = outside(c.p, tris, null);
      expect(off, `${c.name}: drawn outside its boxes`).toEqual([]);
      for (const b of propBoxes(c.p.kind, c.p.variant, c.p.spanM ?? 0)) {
        const gap = berth(tris, b);
        lines.push(
          `${c.name}: box along ${b.along}±${b.hu} across ${b.across}±${b.hd}, ${b.bottom}..${b.top} m: worst face ${gap.toFixed(3)} m`,
        );
        expect(gap, `${c.name}: a box face off what is drawn`).toBeLessThanOrEqual(TOLERANCE_M);
      }
    }
    console.log(`[examined] ${cases.length} props standing on the road\n  ${lines.join('\n  ')}`);
  });

  it("the gantry's post stands where the sim's box is, past its span by the render's distance", () => {
    expect(GANTRY_POST.outM).toBe(GANTRY_POST_OUT_M);
  });

  it("each prop on a vehicle is drawn inside its vehicle's box (or its own solid box over the deck), for every pair the packs ship", () => {
    const list = pairs();
    const lines: string[] = [];
    for (const pr of list) {
      const p = prop(pr.kind, pr.variant);
      const tris = drawn(p);
      const name = `${pr.piece}: ${pr.kind} ${pr.variant} on ${pr.vehicle.id} (${pr.vehicle.lengthM} x ${pr.vehicle.widthM} x ${pr.vehicle.heightM} m)`;
      if (PROP_CONTACT[pr.kind] === 'overhead') {
        // Over everyone: what is not inside the vehicle's box (the tether's foot is) stands over a rider up on
        // the vehicle's top too.
        const up = ON_VEHICLE[pr.kind]?.up ?? 0;
        const v = pr.vehicle;
        const over = tris.filter(
          (t) =>
            !isWire(t) &&
            ![0, 1, 2].every(
              (j) =>
                Math.abs((t.along[j] ?? 0) + (ON_VEHICLE[pr.kind]?.along ?? 0)) <= v.lengthM / 2 &&
                Math.abs(t.across[j] ?? 0) <= v.widthM / 2 &&
                (t.y[j] ?? 0) + up <= v.heightM,
            ),
        );
        const low = Math.min(...over.flatMap((t) => t.y)) + up;
        lines.push(`${name}: lowest ${low.toFixed(2)} m`);
        expect(low, name).toBeGreaterThanOrEqual(pr.vehicle.heightM + SET_PIECE.riderTallM);
        continue;
      }
      const off = outside(p, tris, pr.vehicle);
      lines.push(`${name}: ${off.length} parts outside`);
      expect(off, name).toEqual([]);
      for (const b of propBoxes(pr.kind, pr.variant)) {
        const gap = berth(tris, b, true);
        expect(gap, `${name}: its own box`).toBeLessThanOrEqual(TOLERANCE_M);
      }
    }
    console.log(`[examined] ${list.length} props on vehicles\n  ${lines.join('\n  ')}`);
    expect(list.map((x) => x.kind).sort()).toEqual(
      expect.arrayContaining(['arrowBoard', 'floatDecor', 'hayLoad', 'inflatable', 'lightbar']),
    );
  });

  it('the rule finds what is not so (negative controls)', () => {
    // The Keys float's old skirt, 3.3 by 9.4 m on its 2.4 by 7.5 m float, a ghost past its sides and ends.
    const keysFloat = typeOf('base', 'keys-parade-float');
    expect(keysFloat).toBeDefined();
    if (!keysFloat) return;
    const old = drawn(prop('floatDecor', 'keys-0')).map((t) => ({
      ...t,
      across: t.across.map((a) => a * (3.3 / 2.5)) as Tri['across'],
      along: t.along.map((a) => a * (9.4 / 7.6)) as Tri['along'],
    }));
    expect(outside(prop('floatDecor', 'keys-0'), old, keysFloat).length).toBeGreaterThan(0);
    // A person's box twice as wide as the person: an invisible berth.
    const person = drawn(prop('person', 'flagger'), WAVE);
    expect(berth(person, { along: 0, across: 0, hu: 0.2, hd: 1, bottom: 0, top: 2.36 })).toBeGreaterThan(
      TOLERANCE_M,
    );
    // The old radar's placard, 0.7 m out to the side: drawn outside the tripod's box.
    const radar = drawn(prop('radar', 'keys')).map((t) => ({
      ...t,
      across: t.across.map((a) => a + 0.7) as Tri['across'],
    }));
    expect(outside(prop('radar', 'keys'), radar, null).length).toBeGreaterThan(0);
    // The old gantry's far post, in the oncoming lanes: no box there.
    const far = drawn(prop('gantry', '', { spanM: 8 })).map((t) => ({
      ...t,
      across: t.across.map((a) => -a) as Tri['across'],
    }));
    expect(outside(prop('gantry', '', { spanM: 8 }), far, null).length).toBeGreaterThan(0);
  });
});
