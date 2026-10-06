// The Keys' sea in colour bands (playtest 4, P4-19; the identity study's S4: "Water in colour bands. Pale
// turquoise over sand, dark seagrass patches and deep-blue channels"; the sea was one flat colour). A
// network whose roads run beside open water draws its sea as a grid of vertex-coloured squares in place
// of the one plane, so the sea can be a different colour in different places, and nothing about a route
// is a texture: every colour is read from the bake or from how far a point is from land.
//
// What the colour reads:
//   - the channel: a bridge raised for boats goes over deep water. Wherever the baked deck stands high
//     (the Seven Mile's hump over Moser Channel, Bahia Honda's and Spanish Harbor's spans), the sea under
//     it is deep, and the channel runs across the road a long way each side;
//   - the open sea: far from any land the water is a little deeper than the flats, the more the farther;
//   - the flats: everywhere else it is the shallows, the region's own water colour, with seeded patches of
//     dark seagrass and pale sand, so the flats are not one flat colour either.
// "Land" is a metre of road whose sides are not water, or whose side is tagged `water-shallow` (a sandbar's
// flats), or an island of a landmark's own (Pigeon Key). The bands are tints that multiply the look's own
// water colour (a palette still recolours the sea), so the shallows are that colour untouched.
//
// A `salt-pond` span of a side (Smathers Beach's inland ponds, playtest 4 run B's fix check, punch item 5: "the
// road reads as water on both sides") is painted brackish, pale olive and not turquoise, with a mud edge by the
// road and at its ends and far side, so the sea on one side of the road and the pond on the other read as two
// waters. The span's `water-shallow` stays under it (the land is not drawn there, the sim reads the water's edge).
//
// Drawing: one mesh, one draw call, a fixed number of triangles however long the route is. The mesh is a
// grid of fine squares around the camera (snapped to the grid, so a colour never swims) inside one ring of
// large squares out to where the old plane ended; it re-lays itself, in 1,200 or so vertices, when
// the camera crosses a square. Numbers are [default].
import { BufferAttribute, BufferGeometry, Color, Mesh } from 'three';
import { onSide, type RoadNetwork } from '../road';
import type { LookStyle } from './look';
import { CLASSIC_PALETTE } from './look';
import { islandBoxes, themeAt, type SideTag } from './scenery';

export const SEA_BANDS = {
  /** A deck this high over the sea (world y) is over a channel: from here the water starts to deepen... */
  channelFromM: 5,
  /** ...and from here it is wholly channel. */
  channelFullM: 11,
  /** How far a channel reaches along the road past its last high metre, and across it each side, m. */
  channelAlongM: 120,
  channelAcrossM: 420,
  /** Open sea: deeper than the flats from this far from land, to its full share at the second distance, m. */
  openFromM: 800,
  openToM: 3600,
  openShare: 0.4,
  /** Metres between the samples of the road the plan reads: land (one per), and the high deck. */
  landStepM: 150,
  deckStepM: 30,
  /**
   * The patches of seagrass and sand (run C's live check, lane J3: "the flats look one turquoise"): the size
   * of a patch, m; the second, finer octave's share of that size; and the noise value where a patch starts
   * and where its tint is full. A patch is two squares of the fine grid and a little more, so it is a shape
   * and not a vertex, and a view of the flats holds several (tests/sim/keys-places-sight).
   */
  patchM: 60,
  octaveShare: 0.55,
  patchFrom: 0.04,
  patchTo: 0.36,
  /** How many lattice points' tints are kept between re-lays (the camera's trail), before the memory is dropped. */
  memoryMax: 20000,
  /** The fine grid round the camera: squares each side and the side of one, m. */
  cells: 32,
  cellM: 28,
  /** The colours of the deep channel (display sRGB), and the tints of a sand patch and a seagrass patch. */
  deep: '#16639f',
  sand: [1.3, 1.2, 0.95],
  seagrass: [0.5, 0.72, 0.62],
  /**
   * A salt pond (display sRGB): pale olive, and its mud; how far inland it reaches from the road's edge, the width of
   * the mud by the road, on its far side and at each end, and how far apart the road samples its spans are, m. A
   * pond is 3 squares of the fine grid deep, so its middle holds a vertex or two of its own colour. [default]
   */
  pond: '#a8b47c',
  mud: '#6f5f43',
  pondDepthM: 90,
  pondMudRoadM: 16,
  pondMudFarM: 26,
  pondMudEndM: 40,
  pondStepM: 15,
} as const;

type Tint = readonly [number, number, number];

interface Anchor {
  x: number;
  z: number;
}
/** A metre of road whose deck is over a channel: where it is, which way it runs, how deep (0 to 1). */
interface DeckSample extends Anchor {
  tx: number;
  tz: number;
  depth: number;
}

/** What the sea's colour is read from, for one network. */
export interface SeaPlan {
  /** Where land stands (thinned), for the distance to the nearest. */
  land: readonly Anchor[];
  /** The high stretches of deck. */
  deck: readonly DeckSample[];
  /** The salt ponds, sampled along the road's edge (`SEA_BANDS.pondStepM` apart). */
  ponds: readonly PondSample[];
}

/**
 * A metre of the road's edge beside a salt pond: where it is, which way the road runs, which way is inland (away from
 * the road, unit), and how far the sample is from the nearer end of its span.
 */
interface PondSample extends Anchor {
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  endM: number;
}

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The plan for a network, or null when none of its roads runs beside water (then the sea stays one
 * plane). `tagsOf` gives a road's scenery tags (road-mesh.ts holds the dressing).
 */
export function seaPlanFor(
  road: RoadNetwork,
  tagsOf: (edge: RoadNetwork['edges'][number]) => readonly SideTag[] | undefined,
): SeaPlan | null {
  const land: Anchor[] = [];
  const deck: DeckSample[] = [];
  const ponds: PondSample[] = [];
  let water = false;
  for (const e of road.edges) {
    const tags = tagsOf(e);
    for (const t of tags ?? []) {
      if (t.tag !== 'salt-pond') continue;
      for (const side of [-1, 1] as const) {
        if (!onSide(t, side < 0 ? 'left' : 'right')) continue;
        const near = Math.max(-e.dMin, e.dMax) + 0.6;
        for (let s = t.s0; s <= t.s1 + 1e-6; s += SEA_BANDS.pondStepM) {
          const u = Math.min(s, t.s1);
          const edge = road.toWorld(e.index, u, side * near, 0);
          const out = road.toWorld(e.index, u, side * (near + 1), 0);
          const f = road.frameAt(e.index, u);
          ponds.push({
            x: edge.x,
            z: edge.z,
            tx: f.tx,
            tz: f.tz,
            nx: (out.x - edge.x) / Math.hypot(out.x - edge.x, out.z - edge.z),
            nz: (out.z - edge.z) / Math.hypot(out.x - edge.x, out.z - edge.z),
            endM: Math.min(u - t.s0, t.s1 - u),
          });
        }
      }
    }
    if (!tags?.some((t) => t.tag.startsWith('water'))) {
      // A road with no water at all is land from end to end.
      for (let s = 0; s <= e.length; s += SEA_BANDS.landStepM) {
        const p = road.toWorld(e.index, s, 0, 0);
        land.push({ x: p.x, z: p.z });
      }
      continue;
    }
    water = true;
    for (let s = 0; s <= e.length; s += SEA_BANDS.deckStepM) {
      const p = road.toWorld(e.index, s, 0, 0);
      const wet = themeAt(tags, 'left', s) === 'water' && themeAt(tags, 'right', s) === 'water';
      const flats = tags.some((t) => t.tag === 'water-shallow' && t.s0 <= s && s <= t.s1);
      if ((!wet || flats) && s % SEA_BANDS.landStepM < SEA_BANDS.deckStepM) land.push({ x: p.x, z: p.z });
      const depth = smooth(SEA_BANDS.channelFromM, SEA_BANDS.channelFullM, p.y);
      if (wet && depth > 0) {
        const f = road.frameAt(e.index, s);
        deck.push({ x: p.x, z: p.z, tx: f.tx, tz: f.tz, depth });
      }
    }
  }
  if (!water) return null;
  for (const b of islandBoxes(road)) land.push({ x: b.x, z: b.z });
  return { land, deck, ponds };
}

/** How deep the sea is at a point, 0 (the flats) to 1 (the channel). */
export function seaDepthAt(plan: SeaPlan, x: number, z: number): number {
  let channel = 0;
  for (const d of plan.deck) {
    const dx = x - d.x;
    const dz = z - d.z;
    const along = dx * d.tx + dz * d.tz;
    const across = -dx * d.tz + dz * d.tx;
    const ua = along / SEA_BANDS.channelAlongM;
    const uc = across / SEA_BANDS.channelAcrossM;
    if (ua * ua + uc * uc >= 1) continue;
    const reach = Math.sqrt(ua * ua + uc * uc);
    channel = Math.max(channel, d.depth * (1 - smooth(0.15, 1, reach)));
  }
  let nearest2 = Infinity;
  for (const a of plan.land) nearest2 = Math.min(nearest2, (x - a.x) * (x - a.x) + (z - a.z) * (z - a.z));
  const open = SEA_BANDS.openShare * smooth(SEA_BANDS.openFromM, SEA_BANDS.openToM, Math.sqrt(nearest2));
  return Math.max(channel, open);
}

/** A hash of a lattice point and a seed, in [0, 1) (no Math.random, no sine: stable everywhere). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One octave of smooth value noise in [-1, 1] over a lattice `cellM` apart. */
function valueNoise(x: number, z: number, cellM: number, seed: number): number {
  const u = x / cellM;
  const v = z / cellM;
  const ix = Math.floor(u);
  const iz = Math.floor(v);
  const fx = smooth(0, 1, u - ix);
  const fz = smooth(0, 1, v - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}

/**
 * The seagrass and the sand, in [-1, 1]: two octaves, the second turned and finer, so a patch is a
 * ragged shape and not a square of the lattice.
 */
function patchNoise(x: number, z: number, seed: number): number {
  const turnedX = x * 0.8 - z * 0.6;
  const turnedZ = x * 0.6 + z * 0.8;
  return (
    0.68 * valueNoise(x, z, SEA_BANDS.patchM, seed) +
    0.32 * valueNoise(turnedX + 91, turnedZ - 47, SEA_BANDS.patchM * SEA_BANDS.octaveShare, seed + 7)
  );
}

/** The deep channel's tint over the classic water colour, per channel (linear, as a vertex colour multiplies). */
function deepTint(): Tint {
  const deep = new Color(SEA_BANDS.deep);
  const base = new Color(CLASSIC_PALETTE.water);
  return [deep.r / base.r, deep.g / base.g, deep.b / base.b];
}
const DEEP: Tint = deepTint();

/** A display colour as a tint over the classic water colour (as `deepTint`). */
function tintOf(hex: string): Tint {
  const c = new Color(hex);
  const base = new Color(CLASSIC_PALETTE.water);
  return [c.r / base.r, c.g / base.g, c.b / base.b];
}
const POND: Tint = tintOf(SEA_BANDS.pond);
const MUD: Tint = tintOf(SEA_BANDS.mud);

/**
 * How far a point is inside a salt pond, and how muddy it is there: `cover` is 1 inside the pond and 0 outside
 * (a few metres of soft edge), `mud` is 1 on the mud edge by the road, on the far side and at the ends.
 */
function pondAt(plan: SeaPlan, x: number, z: number): { cover: number; mud: number } {
  let best = { cover: 0, mud: 0 };
  const reach = SEA_BANDS.pondStepM * 0.75;
  const D = SEA_BANDS.pondDepthM;
  for (const p of plan.ponds) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx * p.tx + dz * p.tz) > reach) continue;
    const c = dx * p.nx + dz * p.nz;
    if (c < -8 || c > D + 8) continue;
    const cover = smooth(-8, 2, c) * (1 - smooth(D - 2, D + 8, c));
    if (cover <= best.cover) continue;
    const mud = Math.max(
      1 - smooth(0, SEA_BANDS.pondMudRoadM, c),
      smooth(D - SEA_BANDS.pondMudFarM, D, c),
      1 - smooth(0, SEA_BANDS.pondMudEndM, p.endM),
    );
    best = { cover, mud };
  }
  return best;
}

/**
 * The tint of the sea at a point: what its vertex colour multiplies the water colour by. 1, 1, 1 is the
 * shallows untouched; a patch of sand lifts it, a patch of seagrass darkens it, a channel turns it deep blue.
 */
export function seaTintAt(plan: SeaPlan, x: number, z: number, seed: number): Tint {
  const depth = seaDepthAt(plan, x, z);
  const n = patchNoise(x, z, seed);
  // The patches live on the flats and give way to the deep before it is dark.
  const flat = 1 - smooth(0, 0.5, depth);
  const sand = smooth(SEA_BANDS.patchFrom, SEA_BANDS.patchTo, n) * flat;
  const grass = smooth(SEA_BANDS.patchFrom, SEA_BANDS.patchTo, -n) * flat;
  const deep = smooth(0, 1, depth);
  const out: [number, number, number] = [1, 1, 1];
  for (let k = 0; k < 3; k++) {
    const patched = 1 + ((SEA_BANDS.sand[k] ?? 1) - 1) * sand + ((SEA_BANDS.seagrass[k] ?? 1) - 1) * grass;
    out[k] = patched + ((DEEP[k] ?? 1) - patched) * deep;
  }
  // A salt pond: brackish, with a mud edge, over whatever the sea would be there.
  const pond = plan.ponds.length ? pondAt(plan, x, z) : null;
  if (pond && pond.cover > 0)
    for (let k = 0; k < 3; k++) {
      const water = (POND[k] ?? 1) + ((MUD[k] ?? 1) - (POND[k] ?? 1)) * pond.mud;
      out[k] = (out[k] ?? 1) + (water - (out[k] ?? 1)) * pond.cover;
    }
  return out;
}

/**
 * The sea as one mesh: fine squares around the camera inside a ring of large ones out to the extent the
 * old plane had. `update` re-lays the fine squares when the camera crosses one.
 */
export class SeaBands {
  readonly mesh: Mesh;
  readonly triangles: number;
  private readonly xs: number[];
  private readonly zs: number[];
  private readonly position: Float32Array;
  private readonly colour: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly tints = new Map<string, Tint>();
  private cellX = NaN;
  private cellZ = NaN;

  constructor(
    private readonly plan: SeaPlan,
    look: LookStyle,
    private readonly seed: number,
    /** The old plane: its middle and its half sides, m. */
    private readonly extent: { x: number; z: number; halfX: number; halfZ: number },
    /** Where the camera starts, m. */
    start: { x: number; z: number },
  ) {
    const n = SEA_BANDS.cells + 3;
    this.xs = new Array<number>(n).fill(0);
    this.zs = new Array<number>(n).fill(0);
    this.position = new Float32Array(n * n * 3);
    this.colour = new Float32Array(n * n * 3);
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j;
        const b = i * n + j + 1;
        const c = (i + 1) * n + j;
        const d = (i + 1) * n + j + 1;
        // Facing up: (b - a) x (c - a) points along +y.
        index.push(a, b, c, c, b, d);
      }
    }
    this.triangles = index.length / 3;
    const normal = new Float32Array(n * n * 3);
    for (let k = 0; k < n * n; k++) normal[k * 3 + 1] = 1;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colour, 3));
    this.geometry.setIndex(index);
    // `paletteBase`: the vertex colours multiply the region's water colour, they do not replace it.
    this.mesh = new Mesh(this.geometry, look.material('water', { vertexColors: true, paletteBase: true }));
    this.mesh.name = 'road-water';
    // The grid moves with the camera, and the bounds with it: it is never culled whole.
    this.mesh.frustumCulled = false;
    this.update(start.x, start.z);
  }

  /**
   * The tint at a point of the lattice, from the plan the first time and from memory after: the fine squares
   * snap to the grid, so a re-lay one square on shares all but a row and a column of its points with the last
   * (the plan's walk over the road's land and decks is the cost, and it would be paid on a thousand points
   * every second at race speed). The memory is dropped when it is large, a long race's worth.
   */
  private tintAt(x: number, z: number): Tint {
    const key = `${x},${z}`;
    let t = this.tints.get(key);
    if (!t) {
      if (this.tints.size > SEA_BANDS.memoryMax) this.tints.clear();
      t = seaTintAt(this.plan, x, z, this.seed);
      this.tints.set(key, t);
    }
    return t;
  }

  /** Re-lays the fine squares about the camera (snapped to the square it stands in). */
  update(cameraX: number, cameraZ: number): void {
    const { cells, cellM } = SEA_BANDS;
    const cx = Math.round(cameraX / cellM);
    const cz = Math.round(cameraZ / cellM);
    if (cx === this.cellX && cz === this.cellZ) return;
    this.cellX = cx;
    this.cellZ = cz;
    const e = this.extent;
    const lay = (out: number[], centre: number, mid: number, half: number) => {
      // The first and last lines are the old plane's edge, the lines between are the fine grid.
      const lo = mid - half;
      const hi = mid + half;
      out[0] = lo;
      for (let k = 0; k <= cells; k++) {
        const v = (centre + k - cells / 2) * cellM;
        out[k + 1] = Math.min(hi - 1, Math.max(lo + 1, v));
      }
      out[cells + 2] = hi;
    };
    lay(this.xs, cx, e.x, e.halfX);
    lay(this.zs, cz, e.z, e.halfZ);
    const n = cells + 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = this.xs[i] ?? 0;
        const z = this.zs[j] ?? 0;
        const k = (i * n + j) * 3;
        this.position[k] = x;
        this.position[k + 1] = 0;
        this.position[k + 2] = z;
        const t = this.tintAt(x, z);
        this.colour[k] = t[0];
        this.colour[k + 1] = t[1];
        this.colour[k + 2] = t[2];
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
