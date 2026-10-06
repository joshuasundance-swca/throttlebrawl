// The Key deer's coat as the game draws it (playtest 4, run B's fix check, punch item 6: "small brown shapes
// ... brown on the sand"). CX5's buck and doe (`keys-identity`, variants 0 and 1) are painted a dark brown
// back and a tan belly and legs, and the tan is the Keys' sand (`#d8c08c`) in everything but name: over a quarter of
// the buck vanished into the ground it stood on, and the brown was only 2.3 times darker than the sand. The file is
// Blender work and is left as it is (as `finishShore` leaves the shore kit's); the bake deepens the coat here, once,
// so a deer reads against sand at 3:1 or better and keeps its two tones, and its black (eyes, hooves) and white
// (tail flash, antlers) are as they were. Presentation only.
import { BufferGeometry, Float32BufferAttribute } from 'three';

/** Luminance of a linear colour (Rec. 709). */
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Under this luminance a colour is black (an eye, a hoof) and stays; over `WHITE` it is the tail's flash and stays. */
const BLACK = 0.03;
const WHITE = 0.9;
/**
 * The coat's new luminance from its old: `BASE + SLOPE * old`. The dark brown (0.21) becomes 0.061 and the tan (0.75)
 * 0.115: against the sand (0.54) 5.3:1 and 3.6:1. [default]
 */
const BASE = 0.04;
const SLOPE = 0.1;

/** A deer variant's geometry with its coat deepened (a copy: the baked file is not touched). */
export function deerCoat(g: BufferGeometry): BufferGeometry {
  const out = g.clone();
  const col = out.getAttribute('color');
  if (!col) return out;
  const next = new Float32Array(col.count * 3);
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i);
    const gr = col.getY(i);
    const b = col.getZ(i);
    const l = lum(r, gr, b);
    const k = l <= BLACK || l >= WHITE ? 1 : (BASE + SLOPE * l) / l;
    next[i * 3] = r * k;
    next[i * 3 + 1] = gr * k;
    next[i * 3 + 2] = b * k;
  }
  out.setAttribute('color', new Float32BufferAttribute(next, 3));
  return out;
}
