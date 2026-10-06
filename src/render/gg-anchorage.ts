// The Golden Gate's cable anchorages (playtest 4, P4-19, G4; the wave C and run A checks: "two big
// blank slabs (grey and beige) crowd both rails where the main cables end. They read as buildings, not
// anchorages"). The kit's `gg_anchorage` is two 38 m concrete housings, 8 m high, on a 42 m wide apron:
// at the end of the cables a rider rides between two grey blocks the size of a house. What a rider
// should see is each cable coming down and going into a low, stepped housing in the bridge's own paint,
// with a saddle collar where it enters: a structure that holds the cable, not a building. Code-made
// (a few dozen triangles a side, in the landmark layer's one mesh, so no draw call), in the kit's own
// frame, so landmarks.ts places it as it placed the kit's node: the origin is where the cables enter,
// on the centreline at deck-top height, the housings behind it (-Z, along the approach) and the span
// ahead (+Z). The kit's node still says where the cable enters (`cable_entry_m`), and whether there is
// an anchorage at all. Presentation only: nothing here reaches the sim.
import { SoupBuilder, type Soup } from './fred';

/** The housing's figures, metres. [default] */
export const ANCHORAGE = {
  /** How far across the housing is from the cable's centre line on each side, m (it is 2 x this wide). */
  halfWidthM: [2.9, 2.4, 1.9, 1.5],
  /** Where each step ends behind the entry (a positive length along -Z), m: the longest is the plinth. */
  lengthM: [20, 15, 9.5, 4.5],
  /** The height of each step's top over the deck, m; the last is set from the cable's entry. */
  topM: [1.1, 2.6, 4.2],
  /** The cap's top stands this far under the cable's centre, so the cable lies on it, m. */
  capUnderM: 0.3,
  /** How far the housing's foot reaches below the deck top, m (the kit's own `foundation_m`). */
  foundationM: 72,
  /** The saddle collar round the cable's entry: half width, half height, from -z to +z, m. */
  collar: { halfWidthM: 0.9, halfHeightM: 0.6, z0: -0.2, z1: 0.7 },
  /** The plinth and the foot: poured concrete. The collar is the bridge's paint, darker. */
  concrete: '#a7a294',
  collarShade: 0.72,
} as const;

/** A circle that covers an anchorage (both housings, the foot aside), for the layer's levels of detail, m. */
export const ANCHORAGE_PIECE_R_M = 30;

/** The highest point of a housing over the deck top for a cable entering at `entryM`, m. */
export const anchorageTopM = (entryM: number): number => entryM - ANCHORAGE.capUnderM;

/** Shades a `#rrggbb` colour toward black by `k` (1 keeps it). */
function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const part = (shift: number) =>
    Math.round(((n >> shift) & 255) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${part(16)}${part(8)}${part(0)}`;
}

/**
 * The two housings of an anchorage, one under each cable. `saddleX` is the cable's distance from the
 * centre line (the tower's `cable_saddle_x_m`), `entryM` how high over the deck the cable enters, and
 * `paintHex` the bridge's paint (`#rrggbb`).
 */
export function anchorageSoup(saddleX: number, entryM: number, paintHex: string): Soup {
  const A = ANCHORAGE;
  const b = new SoupBuilder();
  const top = [...A.topM, anchorageTopM(entryM)];
  for (const side of [-1, 1]) {
    const x0 = side * saddleX;
    const span = (half: number): [number, number] => [x0 - half, x0 + half];
    // The foot, under the deck, down to the ground (hidden from the road, seen from below).
    b.box(...span(A.halfWidthM[0]), -A.foundationM, 0, -A.lengthM[0], 0.4, A.concrete);
    // The stepped body: a concrete plinth, then the bridge's paint, each shorter and narrower than the
    // last, the highest at the cable (the steps climb toward it).
    top.forEach((y1, k) => {
      const y0 = k === 0 ? 0 : (top[k - 1] as number);
      const [xa, xb] = span(A.halfWidthM[k] as number);
      b.box(xa, xb, y0, y1, -(A.lengthM[k] as number), 0.4, k === 0 ? A.concrete : paintHex);
    });
    // The saddle collar: where the cable goes in.
    const c = A.collar;
    b.box(
      x0 - c.halfWidthM,
      x0 + c.halfWidthM,
      entryM - c.halfHeightM,
      entryM + c.halfHeightM,
      c.z0,
      c.z1,
      shade(paintHex, A.collarShade),
    );
  }
  return b.soup;
}
