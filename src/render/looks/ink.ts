// The ink half of the "ink + 1960s film" look (playtest 1b item 6; scratch/styles2's `kodak` row).
// Lit (Lambert) materials get a small shader patch through `onBeforeCompile`:
// - flat, cel-like colour in two shadow bands instead of smooth light;
// - hatching in the shadow bands, drawn in WORLD space (triplanar: the plane the face mostly lies
//   in), so it stays put on the surface as the camera moves instead of swimming over the screen,
//   and fades to its average tone where the lines would get finer than a pixel;
// - or, for the brush look's solid shadow style, flat bands with the deep side filled with ink;
// - the sea gets inked wave crests and a few cream glints, also in world space, drifting slowly.
// The outlines, the grade, grain and vignette are the final pass (post.ts). Numbers are [default].
import type { MaterialKind } from '../look';

/** The patch works on three's Lambert shader: these anchors must each appear exactly once. */
export const VERTEX_ANCHORS = ['#include <common>', '#include <project_vertex>'] as const;
export const FRAGMENT_ANCHORS = ['#include <common>', '#include <opaque_fragment>'] as const;

/** The uniforms every patched material shares (one object each, so a change reaches all). */
export interface InkUniforms {
  /** Unit vector toward the sun, world space. */
  uInkSun: { value: [number, number, number] };
  /** Hatch lines per metre. */
  uInkHatch: { value: number };
  /** Overall brightness of the flat colours (night is darker). */
  uInkExposure: { value: number };
  /** The ink, linear RGB. */
  uInkColor: { value: [number, number, number] };
  /** Seconds, for the drifting waves. */
  uInkTime: { value: number };
  /** Strength of the inked waves on the sea, 0 = plain water. */
  uInkWaves: { value: number };
  /**
   * The shadow style (playtest 1c item 5): 0 = hatched bands (kodak, wasteland), 1 = flat bands with
   * the deep side filled solid ink (the brush look). In between blends the two.
   */
  uInkSolid: { value: number };
  /** Sparse pen strokes on lit faces too, 0 = none (the wasteland look's drawn texture). */
  uInkLitHatch: { value: number };
}

export type InkMode = 'solid' | 'water';

export function inkModeOf(kind: MaterialKind): InkMode {
  return kind === 'water' ? 'water' : 'solid';
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vInkWorld;`;

const VERTEX_WORLD = /* glsl */ `
{
  vec4 inkW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  inkW = instanceMatrix * inkW;
  #endif
  inkW = modelMatrix * inkW;
  vInkWorld = inkW.xyz;
}`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vInkWorld;
uniform vec3 uInkSun;
uniform float uInkHatch;
uniform float uInkExposure;
uniform vec3 uInkColor;
uniform float uInkTime;
uniform float uInkWaves;
uniform float uInkSolid;
uniform float uInkLitHatch;
// Coverage of parallel lines at integer t, width w (a share of the spacing), antialiased; where the
// lines get finer than about two pixels it fades to their average coverage (no moire, no shimmer).
float inkLine(float t, float w) {
  float fw = fwidth(t);
  float d = abs(fract(t + 0.5) - 0.5);
  float cov = 1.0 - smoothstep(w * 0.5 - fw, w * 0.5 + fw, d);
  return mix(cov, w, smoothstep(0.2, 0.5, fw));
}
// A sine-free hash (stable at large world coordinates on mobile GPUs).
float inkHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

const FRAGMENT_SOLID = /* glsl */ `
{
  vec3 inkN = normalize(cross(dFdx(vInkWorld), dFdy(vInkWorld)));
  if (dot(inkN, cameraPosition - vInkWorld) < 0.0) inkN = -inkN;
  float ndl = dot(inkN, uInkSun);
  vec3 an = abs(inkN);
  vec2 hp = an.y >= max(an.x, an.z) ? vInkWorld.xz : (an.x >= an.z ? vInkWorld.zy : vInkWorld.xy);
  float mid = 1.0 - smoothstep(0.18, 0.28, ndl);
  float deep = 1.0 - smoothstep(-0.32, -0.22, ndl);
  float band = mix(1.0, 0.72, mid);
  band = mix(band, 0.56, deep);
  float hatch = max(mid * inkLine((hp.x + hp.y) * uInkHatch, 0.32),
                    deep * inkLine((hp.x - hp.y) * uInkHatch, 0.32));
  // Solid style: one flat step for the mid band, the deep side filled with ink, no hatching.
  float cover = mix(hatch * 0.85, deep * 0.88, uInkSolid);
  // Lit faces: sparse strokes along the first world axis of the face's plane (along the road on
  // the deck, upright on walls), at about a third of the shadow hatch's density.
  if (uInkLitHatch > 0.0) {
    float lit = (1.0 - mid) * inkLine((hp.x + 0.2 * hp.y) * uInkHatch * 0.35, 0.1);
    cover = max(cover, lit * uInkLitHatch);
  }
  band = mix(band, mix(1.0, 0.74, mid), uInkSolid);
  vec3 inked = diffuseColor.rgb * band * uInkExposure;
  inked = mix(inked, uInkColor, cover);
  outgoingLight = inked + totalEmissiveRadiance;
}`;

const FRAGMENT_WATER = /* glsl */ `
{
  // Cells about 6 m along x by 2.2 m along z; one short curved crest per cell, some with a glint.
  vec2 wp = vInkWorld.xz * vec2(0.16, 0.45) + vec2(uInkTime * 0.05, uInkTime * 0.02);
  vec2 cell = floor(wp);
  vec2 f = fract(wp);
  float h = inkHash(cell);
  float h2 = inkHash(cell + 17.0);
  float len = 0.16 + 0.2 * inkHash(cell + 5.0);
  float dx = (f.x - (0.25 + 0.5 * h)) / len;
  float crest = 0.3 + 0.4 * h2 + 0.1 * dx * dx;
  float fw = fwidth(wp.y);
  float along = 1.0 - smoothstep(0.75, 1.0, abs(dx));
  float stroke = along * (1.0 - smoothstep(0.05, 0.05 + fw * 1.5, abs(f.y - crest)));
  float glint = step(0.78, h) * along * (1.0 - smoothstep(0.025, 0.025 + fw, abs(f.y - crest + 0.12)));
  float far = smoothstep(0.06, 0.25, fw);
  stroke = mix(stroke, 0.07, far) * uInkWaves;
  glint = glint * (1.0 - far) * uInkWaves;
  vec3 sea = diffuseColor.rgb * uInkExposure * (0.94 + 0.12 * h2 * (1.0 - far));
  sea = mix(sea, uInkColor * 0.5 + diffuseColor.rgb * 0.3, stroke * 0.8);
  sea = mix(sea, vec3(1.0, 0.86, 0.62) * uInkExposure, glint * 0.75);
  outgoingLight = sea;
}`;

/** The shader parts `onBeforeCompile` receives (a subset of three's WebGLProgramParametersWithUniforms). */
export interface ShaderParts {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

function replaceOnce(src: string, anchor: string, withText: string, where: string): string {
  const at = src.indexOf(anchor);
  if (at < 0 || src.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(`looks: the ink patch expects exactly one "${anchor}" in the ${where} shader`);
  }
  return src.slice(0, at) + withText + src.slice(at + anchor.length);
}

/**
 * The material kinds drawn flat and left out of the brightness ink (G7, the wave B live check). The
 * film pass inks every sharp brightness step, which outlined each stroke of a board's lettering
 * (white on green: a smear in kodak, wasteland and brush) and thickened the hit sparks, small
 * gold chips, into black-rimmed polygons. These kinds carry their own detail, so they say so in the
 * scene target's alpha channel (0 where they draw; post.ts reads it).
 */
export const NO_INK_KINDS: ReadonlySet<MaterialKind> = new Set<MaterialKind>(['board', 'spark']);

/**
 * Patches a basic (unlit) shader in place so it writes alpha 0 into the scene target, which the
 * film pass reads as "no brightness ink here". Only an OPAQUE material may carry it: a blended one
 * would mix the 0 with what is behind it. In the final image alpha is not used, so nothing else shows.
 */
export function patchNoInkShader(shader: Pick<ShaderParts, 'fragmentShader'>): void {
  shader.fragmentShader = replaceOnce(
    shader.fragmentShader,
    '#include <opaque_fragment>',
    '#include <opaque_fragment>\n  gl_FragColor.a = 0.0;',
    'fragment',
  );
}

/** Patches a Lambert shader in place with the ink look for this material's mode. */
export function patchInkShader(shader: ShaderParts, mode: InkMode, uniforms: InkUniforms): void {
  let v = shader.vertexShader;
  v = replaceOnce(v, '#include <common>', `#include <common>${VERTEX_DECL}`, 'vertex');
  v = replaceOnce(v, '#include <project_vertex>', `#include <project_vertex>${VERTEX_WORLD}`, 'vertex');
  let f = shader.fragmentShader;
  f = replaceOnce(f, '#include <common>', `#include <common>${FRAGMENT_DECL}`, 'fragment');
  const body = mode === 'water' ? FRAGMENT_WATER : FRAGMENT_SOLID;
  f = replaceOnce(f, '#include <opaque_fragment>', `${body}\n#include <opaque_fragment>`, 'fragment');
  shader.vertexShader = v;
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, uniforms);
}
