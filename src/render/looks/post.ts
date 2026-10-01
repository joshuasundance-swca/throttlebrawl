// The film half of the "ink + 1960s film" look: one final full-screen pass (scratch/styles2's
// `kodak` recipe: "one 3D-LUT tap, grain and vignette folded into one final pass"). The scene is
// drawn into an offscreen target with a depth texture; this pass then:
// - inks outlines where depth breaks or creases (riders, vehicles, road edges against the sea,
//   rails) and where brightness jumps sharply (road against sand, markings), fading them out with
//   distance so the far haze stays soft;
// - paints the sky as a warm gradient (its horizon colour is the fog colour, so it meets the haze);
// - converts to display sRGB, applies the look's grade (one 3D-table tap; the table is swapped in
//   place when the look changes), a warm vignette and moving film grain.
// Playtest 1c item 5 adds two dials for the newer looks: which table, and a brush line (the outline
// width swells and thins over the screen, with a harder edge).
// Cost per pixel: 5 depth taps, 5 colour taps and 1 table tap, one extra full-screen draw.
import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DepthTexture,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { buildGradeLut, GRADES, LUT_SIZE, type GradeId } from './grade';

/** What the look hands the final pass each frame. Colours are linear RGB. */
export interface PostSettings {
  /** Outline strength, 0 = none. */
  ink: number;
  /** Outline sample offset, device pixels. */
  inkWidthPx: number;
  /** Outlines fade out by this distance, metres. */
  inkFarM: number;
  inkColor: readonly [number, number, number];
  skyTop: readonly [number, number, number];
  skyHorizon: readonly [number, number, number];
  /** Grade strength, 0 = ungraded, 1 = the full table. */
  grade: number;
  /** Which colour table (playtest 1c item 5: each look picks one). */
  lut: GradeId;
  /** 0 = even pen outlines, 1 = brush outlines that swell and thin (the brush look). */
  brush: number;
  /** Vignette strength, 0 = none. */
  vignette: number;
  /** Grain amplitude in display values, 0 = none. */
  grain: number;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler3D tLut;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uInk;
uniform float uInkWidth;
uniform float uInkFar;
uniform vec3 uInkColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uGrade;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uBrush;
varying vec2 vUv;

// 1 / distance along the view axis from a perspective depth value: affine on any plane, so its
// second difference is zero across flat surfaces and large at silhouettes and creases.
float invDist(float d) { return (uFar - (uFar - uNear) * d) / (uNear * uFar); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Smooth value noise over screen cells, for the brush line's swell and taper.
float brushNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = grainHash(i);
  float b = grainHash(i + vec2(1.0, 0.0));
  float c = grainHash(i + vec2(0.0, 1.0));
  float d = grainHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float width = uInkWidth;
  if (uBrush > 0.0) width *= 1.0 + uBrush * (brushNoise(gl_FragCoord.xy / 22.0) - 0.5) * 1.2;
  vec2 ox = vec2(uTexel.x * width, 0.0);
  vec2 oy = vec2(0.0, uTexel.y * width);
  float dc = texture(tDepth, vUv).r;
  vec3 col = texture(tColor, vUv).rgb;
  float ink = 0.0;
  if (dc >= 0.999999) {
    col = mix(uSkyHorizon, uSkyTop, smoothstep(0.45, 1.1, vUv.y));
  } else {
    float ic = invDist(dc);
    float il = invDist(texture(tDepth, vUv - ox).r);
    float ir = invDist(texture(tDepth, vUv + ox).r);
    float id = invDist(texture(tDepth, vUv - oy).r);
    float iu = invDist(texture(tDepth, vUv + oy).r);
    float lap = max(abs(il + ir - 2.0 * ic), abs(id + iu - 2.0 * ic)) / ic;
    // A brush line has a harder edge than a pen line.
    float depthInk = smoothstep(0.035, mix(0.1, 0.055, uBrush), lap);
    float ll = sqrt(luma(texture(tColor, vUv - ox).rgb));
    float lr = sqrt(luma(texture(tColor, vUv + ox).rgb));
    float ld = sqrt(luma(texture(tColor, vUv - oy).rgb));
    float lu = sqrt(luma(texture(tColor, vUv + oy).rgb));
    float colorInk = smoothstep(0.14, 0.26, max(abs(ll - lr), abs(ld - lu)));
    ink = max(depthInk, colorInk) * (1.0 - smoothstep(uInkFar * 0.5, uInkFar, 1.0 / ic)) * uInk;
  }
  col = mix(col, uInkColor, clamp(ink, 0.0, 1.0));
  vec3 s = clamp(toSrgb(col), 0.0, 1.0);
  const float n = ${LUT_SIZE.toFixed(1)};
  vec3 graded = texture(tLut, s * ((n - 1.0) / n) + 0.5 / n).rgb;
  s = mix(s, graded, uGrade);
  float r = length(vUv - 0.5) * 1.41421;
  float v = smoothstep(0.42, 1.05, r) * uVignette;
  s *= 1.0 - v * 0.6;
  s = mix(s, s * vec3(1.0, 0.9, 0.78), v);
  s += (grainHash(gl_FragCoord.xy + fract(uTime * 7.31) * 613.0) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;

export class LookPost {
  private readonly target: WebGLRenderTarget;
  private readonly lut: Data3DTexture;
  private readonly material: ShaderMaterial;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private lutId: GradeId = 'kodachrome';
  private readonly lutData = new Map<GradeId, Uint8Array>();

  constructor() {
    const depthTexture = new DepthTexture(1, 1);
    this.target = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      depthTexture,
    });
    const first = buildGradeLut(LUT_SIZE, GRADES[this.lutId]);
    this.lutData.set(this.lutId, first);
    this.lut = new Data3DTexture(first.slice(), LUT_SIZE, LUT_SIZE, LUT_SIZE);
    this.lut.format = RGBAFormat;
    this.lut.type = UnsignedByteType;
    this.lut.minFilter = LinearFilter;
    this.lut.magFilter = LinearFilter;
    this.lut.wrapS = this.lut.wrapT = this.lut.wrapR = ClampToEdgeWrapping;
    this.lut.unpackAlignment = 1;
    this.lut.needsUpdate = true;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depthTexture },
        tLut: { value: this.lut },
        uTexel: { value: new Vector2(1, 1) },
        uNear: { value: 0.3 },
        uFar: { value: 760 },
        uInk: { value: 1 },
        uInkWidth: { value: 1 },
        uInkFar: { value: 350 },
        uInkColor: { value: [0, 0, 0] },
        uSkyTop: { value: [1, 1, 1] },
        uSkyHorizon: { value: [1, 1, 1] },
        uGrade: { value: 1 },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uTime: { value: 0 },
        uBrush: { value: 0 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /** Draws the scene through the pass to the canvas. */
  render(
    gl: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera | Camera,
    s: PostSettings,
    time: number,
  ): void {
    gl.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const u = this.material.uniforms as Record<string, { value: unknown }>;
    (u['uTexel']!.value as Vector2).set(1 / w, 1 / h);
    const persp = camera as PerspectiveCamera;
    u['uNear']!.value = persp.near ?? 0.3;
    u['uFar']!.value = persp.far ?? 760;
    u['uInk']!.value = s.ink;
    u['uInkWidth']!.value = s.inkWidthPx;
    u['uInkFar']!.value = s.inkFarM;
    u['uInkColor']!.value = s.inkColor;
    u['uSkyTop']!.value = s.skyTop;
    u['uSkyHorizon']!.value = s.skyHorizon;
    u['uGrade']!.value = s.grade;
    u['uVignette']!.value = s.vignette;
    u['uGrain']!.value = s.grain;
    u['uTime']!.value = time;
    u['uBrush']!.value = s.brush;
    if (s.lut !== this.lutId) this.useLut(s.lut);
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.render(scene, camera);
    gl.setRenderTarget(previous);
    gl.render(this.quadScene, this.quadCamera);
  }

  /** Swaps the colour table in place (16 KB, once, at a look switch). Each table is baked once. */
  private useLut(id: GradeId): void {
    let data = this.lutData.get(id);
    if (!data) {
      data = buildGradeLut(LUT_SIZE, GRADES[id]);
      this.lutData.set(id, data);
    }
    (this.lut.image.data as Uint8Array).set(data);
    this.lut.needsUpdate = true;
    this.lutId = id;
  }

  dispose(): void {
    this.target.dispose();
    this.lut.dispose();
    this.material.dispose();
  }
}
