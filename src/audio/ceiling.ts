// The output ceiling (M2.md audio-2: "nothing clips in a pile-up"). The master limiter is a
// DynamicsCompressor, and an offline render of a pile-up showed it lets instant-attack impacts
// through (and browsers add make-up gain): the peak reached about 1.57, a hard digital clip on the
// phone. The ceiling sits after the limiter: a WaveShaper that is exactly linear up to `KNEE` and
// bends smoothly towards 1.0 above it, so ordinary play is untouched and a pile-up saturates
// instead of clipping. The shaper sees the signal at half level (its curve covers -2..2), and a
// WaveShaper holds its end values for anything beyond the curve, so the output never passes 1.0.

/** Output level up to which the ceiling passes the signal unchanged. */
export const KNEE = 0.8;
/** The curve covers inputs from -RANGE to RANGE. */
const RANGE = 2;

/** The transfer function: linear to KNEE, then a tanh knee that approaches 1.0. */
export function ceilingShape(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
}

let curve: Float32Array<ArrayBuffer> | null = null;
function ceilingCurve(): Float32Array<ArrayBuffer> {
  if (curve) return curve;
  const n = 4097;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = ceilingShape(((i / (n - 1)) * 2 - 1) * RANGE);
  return (curve = c);
}

/** Builds the ceiling into `out`; connect the limiter to the returned node. */
export function createCeiling(ctx: BaseAudioContext, out: AudioNode): AudioNode {
  const pre = ctx.createGain();
  pre.gain.value = 1 / RANGE;
  const shaper = ctx.createWaveShaper();
  shaper.curve = ceilingCurve();
  pre.connect(shaper).connect(out);
  return pre;
}
