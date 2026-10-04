// Integer-only drawing into an index buffer, for the region atlases (README.md).
//
// Every pixel decision is integer arithmetic: coordinates must be integers (a float throws), there
// is no anti-aliasing, and anything random comes from a seeded mulberry32, so a sheet rasterises to
// the same indices on every machine. A sheet's tile draws through a painter: tile-local
// coordinates, clipped to the tile's inner rect, so a tile can never paint its neighbour or its
// gutter. The gutter is filled afterwards by `edgeExtend`.

/** A raster: `width` x `height` palette indices, row-major, top row first. Starts all index 0. */
export function createRaster(width, height) {
  return { width, height, data: new Uint8Array(width * height) };
}

/** mulberry32: a small seeded PRNG. Returns a function giving the next uint32. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** FNV-1a over a string's UTF-16 code units: the per-tile seed, so tiles never share a stream. */
export function seedFor(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

// The 5 x 7 font: A to Z, 0 to 9, space and . , - ' ! &. Drawn here, so there is no font file to
// license. '#' is ink.
const FONT_ROWS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
};

/** The characters `glyphs5x7` can draw. */
export const GLYPHS = Object.keys(FONT_ROWS).join('');

function int(name, v) {
  if (!Number.isInteger(v)) throw new Error(`${name} must be an integer, got ${v}`);
  return v;
}

function ints(named) {
  for (const [k, v] of Object.entries(named)) int(k, v);
}

/**
 * A painter over one rect of a raster: tile-local integer coordinates, clipped to the rect.
 * @param {{ width: number, data: Uint8Array }} raster
 * @param {{ x: number, y: number, w: number, h: number }} rect the area it may paint, in pixels
 * @param {(c: number | string) => number} colour resolves a palette index or role to an index
 * @param {number} seed the mulberry32 seed for `rand` and `randInt`
 */
export function painter(raster, rect, colour, seed) {
  const next = mulberry32(seed);
  const lettering = [];
  const { w, h } = rect;
  const put = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < w && y < h) raster.data[(rect.y + y) * raster.width + rect.x + x] = c;
  };
  const span = (x0, x1, y, c) => {
    if (y < 0 || y >= h) return;
    const a = Math.max(0, x0);
    const b = Math.min(w, x1);
    if (a < b)
      raster.data.fill(c, (rect.y + y) * raster.width + rect.x + a, (rect.y + y) * raster.width + rect.x + b);
  };
  const p = {
    /** The paintable width and height in pixels (the tile's inner rect). */
    w,
    h,
    /** The strings drawn with `glyphs5x7`, for the build's lettering check. */
    lettering,
    /** Next uint32 from the tile's own seeded stream. */
    rand: next,
    /** An integer in [0, n). */
    randInt(n) {
      int('n', n);
      return Math.floor((next() * n) / 4294967296);
    },
    /** Fills the whole paintable area. */
    fill(c) {
      p.rect(0, 0, w, h, c);
    },
    /** One pixel. */
    pixel(x, y, c) {
      put(int('x', x), int('y', y), colour(c));
    },
    /** A filled axis-aligned rect: x, y, width, height. */
    rect(x, y, rw, rh, c) {
      const ci = colour(c);
      ints({ x, y, w: rw, h: rh });
      for (let yy = y; yy < y + rh; yy++) span(x, x + rw, yy, ci);
    },
    /**
     * Even-odd scanline fill of a polygon given as [[x, y], ...]. Row y is filled between the
     * crossings of edges with ay <= y < by (or by <= y < ay), each crossing floored.
     */
    poly(points, c) {
      const ci = colour(c);
      for (const [x, y] of points) ints({ x, y });
      const ys = points.map((q) => q[1]);
      for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
        const xs = [];
        for (let i = 0; i < points.length; i++) {
          const [ax, ay] = points[i];
          const [bx, by] = points[(i + 1) % points.length];
          if ((ay <= y && y < by) || (by <= y && y < ay)) {
            xs.push(ax + Math.floor(((y - ay) * (bx - ax)) / (by - ay)));
          }
        }
        xs.sort((m, n) => m - n);
        for (let i = 0; i + 1 < xs.length; i += 2) span(xs[i], xs[i + 1], y, ci);
      }
    },
    /**
     * Stripes inside a rect: lines `thick` px thick every `period` px, starting at the rect's top
     * (or left, with `vertical`).
     */
    stripes(x, y, rw, rh, period, thick, c, vertical = false) {
      const ci = colour(c);
      ints({ x, y, w: rw, h: rh, period, thick });
      if (period < 1) throw new Error('period must be at least 1');
      for (let yy = y; yy < y + rh; yy++) {
        if (vertical) {
          for (let xx = x; xx < x + rw; xx++) if ((xx - x) % period < thick) put(xx, yy, ci);
        } else if ((yy - y) % period < thick) span(x, x + rw, yy, ci);
      }
    },
    /** A filled disc: every pixel with dx² + dy² <= r² + r (the integer midpoint rule). */
    circle(cx, cy, r, c) {
      p.ring(cx, cy, r, -1, c);
    },
    /** A filled ring: inside radius `outer` and outside radius `inner` (the same rule). */
    ring(cx, cy, outer, inner, c) {
      const ci = colour(c);
      ints({ cx, cy, outer, inner });
      const halfWidth = (rad, dy) => {
        if (rad < 0 || dy * dy > rad * rad + rad) return -1;
        let hw = Math.floor(Math.sqrt(rad * rad + rad - dy * dy));
        while (hw * hw + dy * dy > rad * rad + rad) hw--;
        while ((hw + 1) * (hw + 1) + dy * dy <= rad * rad + rad) hw++;
        return hw;
      };
      for (let dy = -outer; dy <= outer; dy++) {
        const o = halfWidth(outer, dy);
        if (o < 0) continue;
        const i = halfWidth(inner, dy);
        if (i < 0) span(cx - o, cx + o + 1, cy + dy, ci);
        else {
          span(cx - o, cx - i, cy + dy, ci);
          span(cx + i + 1, cx + o + 1, cy + dy, ci);
        }
      }
    },
    /**
     * Text in the 5 x 7 font, top-left at (x, y), `scale` px per font pixel, 6 x scale per
     * character. Every string is recorded: atlases hold real landmark lettering only (README.md).
     */
    glyphs5x7(text, x, y, c, scale = 1) {
      const ci = colour(c);
      ints({ x, y, scale });
      lettering.push(text);
      let cx = x;
      for (const ch of text) {
        const rows = FONT_ROWS[ch];
        if (!rows) throw new Error(`glyphs5x7 has no '${ch}'; it draws ${GLYPHS}`);
        rows.forEach((row, ry) => {
          for (let rx = 0; rx < 5; rx++) {
            if (row[rx] === '#') {
              for (let sy = 0; sy < scale; sy++)
                span(cx + rx * scale, cx + (rx + 1) * scale, y + ry * scale + sy, ci);
            }
          }
        });
        cx += 6 * scale;
      }
    },
  };
  return p;
}

/**
 * Fills a `gutter`-px band around an inner rect by copying its edge pixels outward (rows first,
 * then columns over the full height, so the corners take the corner pixel). Mipmaps and bilinear
 * filtering then sample the tile's own colours, never a neighbour's.
 */
export function edgeExtend(raster, inner, gutter) {
  const { width, data } = raster;
  const { x, y, w, h } = inner;
  const row = (yy) => data.subarray(yy * width + x, yy * width + x + w);
  for (let g = 1; g <= gutter; g++) {
    data.set(row(y), (y - g) * width + x);
    data.set(row(y + h - 1), (y + h - 1 + g) * width + x);
  }
  for (let yy = y - gutter; yy < y + h + gutter; yy++) {
    const left = data[yy * width + x];
    const right = data[yy * width + x + w - 1];
    data.fill(left, yy * width + x - gutter, yy * width + x);
    data.fill(right, yy * width + x + w, yy * width + x + w + gutter);
  }
}
