import { Color, Fog, MeshBasicMaterial, MeshLambertMaterial, Scene, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { createFlatLook, type MaterialKind } from '../look';
import { defaultRenderParams } from '../tuning';
import {
  buildGradeLut,
  createLookSet,
  DEFAULT_LOOK,
  FRAGMENT_ANCHORS,
  isLookId,
  kodachromeGrade,
  KODAK_PALETTE,
  LOOK_IDS,
  LUT_SIZE,
  patchInkShader,
  VERTEX_ANCHORS,
  type InkUniforms,
  type ShaderParts,
} from '.';

// Playtest 1b item 6: the maintainer's favourite look, "Ink + 1960s film" (`kodak`), as a playable
// look next to `classic`, switchable in Settings. These cover what can be checked without a GPU:
// the switch, the palette, the shader patch's anchors and the grade. The browser spec
// (tests/e2e/render-looks.spec.ts) checks the drawn frame and that the sim does not change.

const ALL_KINDS: MaterialKind[] = [
  'road',
  'shoulder',
  'shortcut',
  'marking',
  'markingCenter',
  'rampMark',
  'post',
  'rail',
  'deck',
  'land',
  'water',
  'bike',
  'rider',
  'vehicle',
  'ped',
  'prop',
  'weapon',
  'glint',
  'lightbar',
  'sky',
  'spark',
  'splash',
  'tint',
  'flash',
  'board',
  'streak',
  'boost',
];

const lambertShader = (): ShaderParts => ({
  vertexShader: ShaderLib.lambert.vertexShader,
  fragmentShader: ShaderLib.lambert.fragmentShader,
  uniforms: {},
});

/** Runs a material's onBeforeCompile on a fresh Lambert shader and returns the result. */
function compiled(m: MeshLambertMaterial): ShaderParts {
  const shader = lambertShader();
  m.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

const params = () => defaultRenderParams();

describe('the look set', () => {
  it('lists the playable looks, classic first and the default', () => {
    expect(LOOK_IDS).toEqual(['classic', 'kodak']);
    expect(DEFAULT_LOOK).toBe('classic');
    expect(isLookId('kodak')).toBe(true);
    expect(isLookId('sepia')).toBe(false);
    expect(createLookSet(createFlatLook()).id).toBe('classic');
  });

  it('classic hands out exactly the M1 look: same material types and colours for every kind', () => {
    const flat = createFlatLook();
    const set = createLookSet(createFlatLook());
    for (const kind of ALL_KINDS) {
      for (const p of [undefined, { vertexColors: true }, { doubleSided: true }]) {
        const a = flat.material(kind, p) as MeshLambertMaterial;
        const b = set.material(kind, p) as MeshLambertMaterial;
        expect(b.constructor, kind).toBe(a.constructor);
        expect(b.color.getHexString(), kind).toBe(a.color.getHexString());
        // No ink patch in classic: the shader compiles exactly as three ships it.
        if (b instanceof MeshLambertMaterial) {
          const s = compiled(b);
          expect(s.fragmentShader, kind).toBe(ShaderLib.lambert.fragmentShader);
          expect(s.vertexShader, kind).toBe(ShaderLib.lambert.vertexShader);
        }
      }
    }
    console.log(`[examined] ${ALL_KINDS.length} material kinds x 3 parameter sets against the M1 look`);
  });

  it('switches to kodak and back on the same material objects: recoloured, repatched, restored', () => {
    const set = createLookSet(createFlatLook());
    const road = set.material('road') as MeshLambertMaterial;
    const water = set.material('water') as MeshLambertMaterial;
    const rider = set.material('rider', { vertexColors: true }) as MeshLambertMaterial;
    const glint = set.material('glint', { vertexColors: true }) as MeshBasicMaterial;
    const classicRoad = road.color.getHexString();
    const v0 = road.version;
    const classicKey = road.customProgramCacheKey();

    expect(set.select('kodak')).toBe(true);
    expect(set.id).toBe('kodak');
    expect(set.material('road')).toBe(road); // same object: the views need no rebuild
    expect(`#${road.color.getHexString()}`).toBe(KODAK_PALETTE.road);
    expect(`#${water.color.getHexString()}`).toBe(KODAK_PALETTE.water);
    expect(rider.color.getHexString()).toBe('ffffff'); // vertex colours keep the riders' own colours
    expect(road.version).toBeGreaterThan(v0); // needsUpdate: the lit program recompiles
    expect(road.customProgramCacheKey()).not.toBe(classicKey);
    const solid = compiled(road);
    expect(solid.fragmentShader).toContain('inkLine(');
    expect(solid.fragmentShader).not.toContain('inkHash(cell');
    const sea = compiled(water);
    expect(sea.fragmentShader).toContain('inkHash(cell');
    expect(Object.hasOwn(glint, 'onBeforeCompile')).toBe(false); // unlit: never patched

    // A material first asked for while kodak is on comes out in kodak colours too.
    expect(`#${(set.material('shoulder') as MeshLambertMaterial).color.getHexString()}`).toBe(
      KODAK_PALETTE.shoulder,
    );

    expect(set.select('kodak')).toBe(false); // no change
    expect(set.select('sepia')).toBe(false); // unknown: ignored
    expect(set.id).toBe('kodak');
    expect(set.select('classic')).toBe(true);
    expect(road.color.getHexString()).toBe(classicRoad);
    expect(compiled(road).fragmentShader).toBe(ShaderLib.lambert.fragmentShader);
    expect(road.customProgramCacheKey()).toBe(classicKey);
  });

  it('restyles the sky and haze with the look, and restores the classic ones', () => {
    const set = createLookSet(createFlatLook());
    const scene = new Scene();
    set.setupScene(scene, { timeOfDay: 'golden-hour' });
    const bg = (scene.background as Color).getHexString();
    const fog = (scene.fog as Fog).color.getHexString();
    set.select('kodak');
    expect((scene.background as Color).getHexString()).not.toBe(bg);
    expect((scene.fog as Fog).color.getHexString()).toBe((scene.background as Color).getHexString());
    set.select('classic');
    expect((scene.background as Color).getHexString()).toBe(bg);
    expect((scene.fog as Fog).color.getHexString()).toBe(fog);
    // A road set up while kodak is on starts in kodak.
    set.select('kodak');
    const fresh = new Scene();
    set.setupScene(fresh, { timeOfDay: 'golden-hour' });
    expect((fresh.background as Color).getHexString()).toBe((scene.background as Color).getHexString());
  });

  it('asks for the film pass only in kodak, with the sliders it was given', () => {
    const set = createLookSet(createFlatLook());
    const p = params();
    expect(set.post(p)).toBeNull();
    set.select('kodak');
    const film = set.post({
      ...p,
      inkLines: 0.4,
      filmGrain: 0.1,
      vignette: 0.2,
      filmGrade: 0.7,
      inkWidthPx: 2,
    });
    expect(film).toMatchObject({ ink: 0.4, grain: 0.1, vignette: 0.2, grade: 0.7, inkWidthPx: 2 });
    expect(set.post(p)?.ink).toBe(p.inkLines);
  });
});

describe('the ink shader patch', () => {
  const uniforms = (): InkUniforms => ({
    uInkSun: { value: [0, 1, 0] },
    uInkHatch: { value: 5 },
    uInkExposure: { value: 1 },
    uInkColor: { value: [0, 0, 0] },
    uInkTime: { value: 0 },
    uInkWaves: { value: 1 },
  });

  it("finds each anchor exactly once in three's Lambert shader (a three upgrade that moves one fails here)", () => {
    const v = ShaderLib.lambert.vertexShader;
    const f = ShaderLib.lambert.fragmentShader;
    for (const a of VERTEX_ANCHORS) expect(v.split(a).length - 1, a).toBe(1);
    for (const a of FRAGMENT_ANCHORS) expect(f.split(a).length - 1, a).toBe(1);
  });

  it('adds the world position, the hatch in the shadow bands and the shared uniforms', () => {
    const s = lambertShader();
    const u = uniforms();
    patchInkShader(s, 'solid', u);
    expect(s.vertexShader).toContain('vInkWorld = inkW.xyz');
    expect(s.vertexShader).toContain('instanceMatrix * inkW'); // instanced palms and posts too
    expect(s.fragmentShader.indexOf('outgoingLight = inked')).toBeLessThan(
      s.fragmentShader.indexOf('#include <opaque_fragment>'),
    );
    expect(s.uniforms['uInkHatch']).toBe(u.uInkHatch); // shared, so one slider reaches every material
  });

  it('refuses a shader without its anchors instead of drawing the classic look by accident', () => {
    const s = lambertShader();
    s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', '');
    expect(() => patchInkShader(s, 'solid', uniforms())).toThrow(/opaque_fragment/);
  });
});

describe('the Kodachrome grade', () => {
  const luma = ([r, g, b]: number[]) => 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

  it('warms neutral greys, lifts black to a warm brown and keeps white a cream', () => {
    for (const v of [0.2, 0.5, 0.8]) {
      const [r, , b] = kodachromeGrade(v, v, v);
      expect(r, `grey ${v}`).toBeGreaterThan(b);
    }
    const black = kodachromeGrade(0, 0, 0);
    expect(black[0]).toBeGreaterThan(0.05);
    expect(black[0]).toBeGreaterThan(black[2]);
    const white = kodachromeGrade(1, 1, 1);
    expect(white[0]).toBeGreaterThan(0.95);
    expect(white[2]).toBeLessThan(0.9);
  });

  it('keeps the tone order of greys (no inversions) and boosts saturation', () => {
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const l = luma(kodachromeGrade(i / 20, i / 20, i / 20));
      expect(l).toBeGreaterThan(last);
      last = l;
    }
    const teal = [0.1, 0.55, 0.6] as const;
    const out = kodachromeGrade(...teal);
    const spread = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(out)).toBeGreaterThan(spread(teal) * 0.95);
  });

  it('bakes into a 16-cube RGBA table whose corners match the grade', () => {
    const lut = buildGradeLut();
    expect(lut.length).toBe(LUT_SIZE ** 3 * 4);
    const at = (r: number, g: number, b: number) => {
      const i = ((b * LUT_SIZE + g) * LUT_SIZE + r) * 4;
      return [lut[i], lut[i + 1], lut[i + 2], lut[i + 3]];
    };
    const n = LUT_SIZE - 1;
    expect(at(0, 0, 0).slice(0, 3)).toEqual(kodachromeGrade(0, 0, 0).map((v) => Math.round(v * 255)));
    expect(at(n, 0, 0).slice(0, 3)).toEqual(kodachromeGrade(1, 0, 0).map((v) => Math.round(v * 255)));
    expect(at(0, 0, n).slice(0, 3)).toEqual(kodachromeGrade(0, 0, 1).map((v) => Math.round(v * 255)));
    expect(at(n, n, n)[3]).toBe(255);
  });
});
