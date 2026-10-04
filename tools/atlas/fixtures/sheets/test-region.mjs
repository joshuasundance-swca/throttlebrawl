// A small sheet for atlas.test.ts: one tile of each primitive, an asymmetric F that pins the
// orientation, and real lettering. It bakes into a scratch pack root, never into packs/.

/** The F tile's strokes, in its inner (tile-local) pixels; the test reads them back. */
export const F_STROKES = {
  stem: [10, 10, 12, 100], // x, y, w, h
  top: [10, 10, 80, 12],
  middle: [10, 50, 60, 10],
};

export default {
  region: 'test-region',
  size: 1024,
  tile: 128,
  palette: [
    { hex: '#ffffff', role: 'grey_0' },
    { hex: '#c0c0c0', role: 'grey_2' },
    { hex: '#808080', role: 'grey_4' },
    { hex: '#404040', role: 'grey_6' },
    { hex: '#101820', role: 'line' },
    { hex: '#d23c28', role: 'red' },
    { hex: '#2a9d8f', role: 'teal' },
  ],
  tiles: [
    {
      id: 'lap-siding',
      x: 1,
      y: 0,
      kind: 'facade',
      draw(r) {
        r.fill('grey_2');
        r.stripes(0, 0, r.w, r.h, 10, 2, 'grey_6');
        r.rect(40, 30, 40, 50, 'grey_4');
      },
    },
    {
      id: 'f-glyph',
      x: 2,
      y: 0,
      kind: 'art',
      draw(r) {
        r.fill('red');
        for (const [x, y, w, h] of Object.values(F_STROKES)) r.rect(x, y, w, h, 'line');
      },
    },
    {
      id: 'mural',
      x: 3,
      y: 0,
      w: 2,
      kind: 'art',
      draw(r) {
        r.fill('teal');
        r.circle(60, 60, 30, 'red');
        r.ring(180, 60, 40, 30, 'line');
        r.poly(
          [
            [100, 110],
            [130, 20],
            [160, 110],
          ],
          'grey_0',
        );
        for (let i = 0; i < 40; i++) r.pixel(r.randInt(r.w), r.randInt(r.h), 'line');
      },
    },
    {
      id: 'mile-sign',
      x: 0,
      y: 1,
      kind: 'art',
      draw(r) {
        r.fill('teal');
        r.glyphs5x7('MILE', 10, 10, 'grey_0', 2);
        r.glyphs5x7('0', 40, 40, 'grey_0', 6);
      },
    },
  ],
};
