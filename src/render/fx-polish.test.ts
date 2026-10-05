// G7, the wave B live check's three render rough edges (playtest 3): the tyre smoke read as grey
// concrete slabs in the ink looks, a hit's sparks were a cloud of big flat yellow polygons over the
// lower left of the screen, and the film pass inked every stroke of a sign's lettering into a smear.
// Each is tested as the rule it protects: smoke is soft and translucent and fades; a spark never
// flies at the lens and never covers more than a few pixels; a board's face and a spark are left out
// of the brightness ink in every ink look and unpatched in classic. What a unit test cannot see (the
// pixels the GPU draws) is named in the change note.
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  ShaderLib,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { createLookSet, NO_INK_KINDS, patchNoInkShader } from './looks';
import { POST_FRAGMENT } from './looks/post';
import { defaultRenderParams } from './tuning';
import { cloudAlpha, patchSmokeShader, Skids, SMOKE_MAX, SMOKE_PEAK_ALPHA } from './skids';

afterEach(() => vi.restoreAllMocks());

const fixed = () => {
  let i = 0;
  return () => (i++ * 0.37) % 1;
};

describe('tyre smoke is soft, translucent puffs that fade (not slabs)', () => {
  it('is a flat cloud, not a solid: two triangles an instance, drawn blended with no depth write', () => {
    const s = new Skids(fixed());
    const mat = s.smokeMesh.material as MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.map, 'a soft-edged cloud texture').not.toBeNull();
    expect((s.smokeMesh.geometry.index?.count ?? 0) / 3).toBe(2);
    expect(s.smokeMesh).toBeInstanceOf(InstancedMesh);
    expect(SMOKE_MAX).toBe(48);
  });

  it('the cloud has no edge: it is clear at the rim and changes slowly between neighbours', () => {
    const N = 64;
    const at = (x: number, y: number) => cloudAlpha(((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1);
    let step = 0;
    let rim = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (x < N - 1) step = Math.max(step, Math.abs(at(x, y) - at(x + 1, y)));
        if (y < N - 1) step = Math.max(step, Math.abs(at(x, y) - at(x, y + 1)));
        if (x === 0 || y === 0 || x === N - 1 || y === N - 1) rim = Math.max(rim, at(x, y));
      }
    // The film pass inks a brightness step: a puff's own steepest step is a small share of one
    // grey level a texel, and times a puff's peak alpha it is smaller still.
    expect(step * SMOKE_PEAK_ALPHA).toBeLessThan(0.05);
    expect(rim).toBeLessThan(0.01);
    expect(at(N / 2, N / 2), 'dense in the middle').toBeGreaterThan(0.8);
  });

  it('each puff fades in from nothing, never gets opaque, and is gone before it is removed', () => {
    const s = new Skids(fixed());
    const fade = () => s.smokeMesh.geometry.getAttribute('aPuff').array as Float32Array;
    // One hard slide: lay puffs for a moment, then let go and watch them age out.
    for (let i = 0; i < 30; i++) {
      s.lay(1, new Vector3(i * 0.4, 0, 0), 1, 1 / 60);
      s.endFrame(1 / 60);
    }
    let peak = 0;
    let youngest = 1;
    for (let i = 0; i < 400; i++) {
      s.lay(1, null, 0, 1 / 60);
      s.endFrame(1 / 60);
      const n = s.counts().smoke;
      for (let k = 0; k < n; k++) peak = Math.max(peak, fade()[k * 2] as number);
      if (i === 0) youngest = Math.min(...Array.from({ length: n }, (_v, k) => fade()[k * 2] as number));
    }
    expect(peak, 'translucent at its most').toBeLessThanOrEqual(SMOKE_PEAK_ALPHA + 1e-6);
    expect(peak, 'but there to see').toBeGreaterThan(0.1);
    expect(youngest, 'a brand-new puff starts clear').toBeLessThan(0.1);
    expect(s.counts().smoke).toBe(0);
  });

  it('a lighter slide smokes thinner, not only less often', () => {
    const peakAt = (strength: number) => {
      const s = new Skids(fixed());
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        s.lay(1, new Vector3(i * 0.4, 0, 0), strength, 1 / 60);
        s.endFrame(1 / 60);
        const a = s.smokeMesh.geometry.getAttribute('aPuff').array as Float32Array;
        for (let k = 0; k < s.counts().smoke; k++) peak = Math.max(peak, a[k * 2] as number);
      }
      return peak;
    };
    expect(peakAt(1)).toBeGreaterThan(peakAt(0.3));
  });

  it('faces the lens: the patch lays each puff out in view space, and fades it by its own alpha', () => {
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };
    patchSmokeShader(shader);
    expect(shader.vertexShader).toContain('attribute vec2 aPuff');
    expect(shader.vertexShader).toContain('modelViewMatrix * instanceMatrix');
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= vPuffAlpha');
    // The material wires it: its compile hook runs the same patch.
    const s = new Skids(fixed());
    const m = s.smokeMesh.material as MeshBasicMaterial;
    const again = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };
    m.onBeforeCompile(again as never, undefined as never);
    expect(again.vertexShader).toBe(shader.vertexShader);
  });

  it('is still two draw calls at most, each hidden while empty', () => {
    const s = new Skids(fixed());
    const meshes: Mesh[] = [];
    s.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(s.smokeMesh.visible).toBe(false);
    s.endFrame(1 / 60);
    expect(s.smokeMesh.visible).toBe(false);
  });
});

describe('a hit burst stays fine and never flies at the camera', () => {
  const PX_TALL = 412;
  const FOV = 62;
  const focalPx = PX_TALL / 2 / Math.tan((FOV / 2) * (Math.PI / 180));

  const rig = (eye: Vector3) => {
    const fx = new FeelEffects(createFlatLook(), defaultRenderParams());
    const cam = new PerspectiveCamera(FOV, 915 / PX_TALL, 0.3, 700);
    cam.position.copy(eye);
    cam.lookAt(eye.x, eye.y, eye.z - 10);
    cam.updateMatrixWorld(true);
    fx.fitTint(cam);
    return fx;
  };
  const sparkMesh = (fx: FeelEffects) => fx.root.getObjectByName('feel-sparks') as InstancedMesh;
  const sparks = (fx: FeelEffects) => {
    const mesh = sparkMesh(fx);
    const m = new Matrix4();
    const out: { at: Vector3; scale: number }[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      out.push({ at: new Vector3().setFromMatrixPosition(m), scale: new Vector3().setFromMatrixScale(m).x });
    }
    return out;
  };
  const chip = () => {
    const mesh = sparkMesh(rig(new Vector3()));
    mesh.geometry.computeBoundingBox();
    return (mesh.geometry.boundingBox?.max.x ?? 0) * 2;
  };

  it('no spark is thrown back toward the lens, so none closes on the camera', () => {
    vi.spyOn(Math, 'random').mockImplementation(fixed());
    const eye = new Vector3(0, 3, 0);
    const burst = new Vector3(-1.5, 1.2, -4);
    const fx = rig(eye);
    fx.burst(burst, 2, 0.5, 0.5); // a hit pushed toward +x +z, partly at the camera
    const start = burst.distanceTo(eye);
    fx.update(0.016, 0.016, false);
    let nearest = Infinity;
    for (let i = 0; i < 20; i++) {
      for (const sp of sparks(fx)) nearest = Math.min(nearest, sp.at.distanceTo(eye));
      fx.update(0.016, 0.016, false);
    }
    expect(sparks(fx).length).toBeGreaterThan(0);
    expect(nearest).toBeGreaterThanOrEqual(start - 0.1);
  });

  it('a spark covers a few pixels at most at any distance, on the phone-wide 412 px view', () => {
    vi.spyOn(Math, 'random').mockImplementation(fixed());
    const size = chip();
    let widest = 0;
    for (const d of [1.2, 2, 3, 5, 8, 14, 30]) {
      const fx = rig(new Vector3());
      fx.burst(new Vector3(0, 0, -d), 2);
      fx.update(0.001, 0.001, false);
      for (const sp of sparks(fx)) {
        const dist = sp.at.length();
        widest = Math.max(widest, ((size * sp.scale) / dist) * focalPx);
      }
    }
    expect(widest).toBeLessThanOrEqual(8);
    expect(widest, 'but a burst still reads').toBeGreaterThan(1);
  });
});

describe('the film pass leaves a board and a spark out of the brightness ink', () => {
  const basicShader = () => ({ fragmentShader: ShaderLib.basic.fragmentShader });
  const compile = (m: MeshBasicMaterial) => {
    const shader = { ...basicShader(), vertexShader: ShaderLib.basic.vertexShader };
    m.onBeforeCompile(shader as never, undefined as never);
    return shader.fragmentShader;
  };

  it('writes alpha 0 after the colour in every ink look, and compiles untouched in classic', () => {
    const set = createLookSet(createFlatLook());
    const board = set.material('board', { color: '#1f6b3a' }) as MeshBasicMaterial;
    const spark = set.material('spark', { vertexColors: true }) as MeshBasicMaterial;
    const classicKey = board.customProgramCacheKey();
    expect(compile(board), 'classic').toBe(ShaderLib.basic.fragmentShader);
    for (const id of ['kodak', 'wasteland', 'brush'] as const) {
      set.select(id);
      for (const m of [board, spark]) {
        const f = compile(m);
        expect(f, id).toContain('gl_FragColor.a = 0.0');
        // After the colour is written (and so after anything that sets alpha), not before.
        expect(f.indexOf('gl_FragColor.a = 0.0'), id).toBeGreaterThan(
          f.indexOf('#include <opaque_fragment>'),
        );
        expect(m.customProgramCacheKey(), id).not.toBe(classicKey);
      }
    }
    set.select('classic');
    expect(compile(board)).toBe(ShaderLib.basic.fragmentShader);
    expect(board.customProgramCacheKey()).toBe(classicKey);
  });

  it('recompiles the program at a look switch, and only the flagged kinds are patched', () => {
    const set = createLookSet(createFlatLook());
    const board = set.material('board', { color: '#1f6b3a' }) as MeshBasicMaterial;
    const glint = set.material('glint', { vertexColors: true }) as MeshBasicMaterial;
    const v0 = board.version;
    set.select('kodak');
    expect(board.version).toBeGreaterThan(v0);
    expect(Object.hasOwn(glint, 'onBeforeCompile'), 'a glint keeps its ink outline').toBe(false);
    expect([...NO_INK_KINDS].sort()).toEqual(['board', 'spark']);
  });

  it('the pass reads the flag: brightness ink is off on a flagged pixel and beside one, depth ink is not', () => {
    const line = POST_FRAGMENT.split(/\r?\n/).find((l) => l.includes('colorInk *='));
    expect(line, 'colorInk is gated').toBeDefined();
    // The centre pixel and each of the four neighbours the edge test reads.
    expect(line?.match(/inkAllowed\(/g)).toHaveLength(5);
    // Only the brightness ink: the depth ink (silhouettes, creases) is not multiplied by the flag.
    expect(POST_FRAGMENT).toMatch(/ink = max\(depthInk, colorInk\)/);
    expect(POST_FRAGMENT).not.toMatch(/depthInk\s*\*=/);
  });

  it('a blended material is never patched (its 0 would mix with the road behind it)', () => {
    const set = createLookSet(createFlatLook());
    const tint = set.material('tint', { vertexColors: true, overlay: true }) as MeshBasicMaterial;
    set.select('kodak');
    expect(tint.transparent).toBe(true);
    expect(Object.hasOwn(tint, 'onBeforeCompile')).toBe(false);
  });

  it('the patch needs exactly one opaque_fragment anchor, and says so when it is not there', () => {
    expect(() => patchNoInkShader({ fragmentShader: 'void main() {}' })).toThrow(/opaque_fragment/);
    const s = basicShader();
    patchNoInkShader(s);
    expect(s.fragmentShader.match(/gl_FragColor\.a = 0\.0/g)).toHaveLength(1);
  });
});
