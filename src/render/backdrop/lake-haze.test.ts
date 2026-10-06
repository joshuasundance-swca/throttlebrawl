// A lake reads as water from the road (playtest 4 run C's live check, punch item 6: "Lake Samish ... shows only as
// a pale flat plain in the haze, even from the far camera"). The backdrop's far floors come out of the fog's end
// gradually and are wholly the haze's colour inside it, because the near world's own sea and ground cover them
// there. A lake above the sea has no near layer: inside the fog's end it was the haze's colour, the colour of the
// fog on the land round it, so it was a pale plain. A floor above the sea keeps its own colour and takes the
// fog's haze by distance, as the near land does (the mirror of the vertex shader, `floorHazeAt`).
//
// Run C's fix check (punch item 5: "From the default chase camera, the lake is still a pale band beyond the cabins,
// in rain, at s 938 to 2638") found the law above was not the land's: it hazed the lake by straight distance from
// 0 m, per vertex, while three's fog on the land starts at 220 m and goes by view depth, so at 150 m the lake was
// 0.23 haze (0.43 at 219 m) beside a clear bank. The lake now takes three's own law per pixel (the second block below); with no fog
// start (`floorHazeAt`'s defaults) the mirror is the old law, which the first block keeps as the control.
import { describe, expect, it } from 'vitest';
import type { ShaderMaterial } from 'three';
import type { BackdropNetworkFile, BackdropRegionFile } from './data';
import { Color } from 'three';
import { buildBackdrop, buildSoup, floorHazeAt, NEAR_WATER_FLOOR } from './builder';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const region: BackdropRegionFile = {
  formatVersion: 1,
  region: 'test',
  hazeM: 34000,
  floorColour: '#3e5446',
  pieces: [],
};
const ring: [number, number][] = [
  [-100, 100],
  [100, 100],
  [100, 400],
  [-100, 400],
];
const network = (surface: 'water' | 'land', y: number): BackdropNetworkFile => ({
  formatVersion: 1,
  network: 'test-net',
  originLatDeg: 48,
  originLonDeg: -122,
  pieces: [{ id: 'f', kind: 'floor', surface, frame: 'local', colour: '#4e6b67', area: ring, y }],
});

/** The floor flag of every vertex of the piece's own triangles (not the far ring, which follows the camera). */
function floorFlags(file: BackdropNetworkFile): Set<number> {
  const { soup } = buildSoup(region, file, [], 7);
  const out = new Set<number>();
  for (let v = 0; v < soup.info.length / 4; v++)
    if (soup.info[v * 4 + 3] === 0) out.add(soup.info[v * 4 + 1]!);
  return out;
}

describe('a floor above the sea is drawn in its own colour inside the fog (playtest 4 run C, punch item 6)', () => {
  const FOG_FAR = 480;

  it('the shader mirror: a sea floor is wholly haze inside the fog; a lake takes the haze by distance', () => {
    // The control: the sea's and the land's far floors (the near world covers them inside the fog's end).
    for (const d of [20, 60, 150, 300, 480]) expect(floorHazeAt(d, FOG_FAR, 2, 1)).toBe(1);
    // The lake: the haze of the fog by distance, not the whole of it.
    const lake = [20, 60, 150, 300, 480].map((d) => floorHazeAt(d, FOG_FAR, 2, NEAR_WATER_FLOOR));
    print(
      `[examined] lake haze at 20, 60, 150, 300, 480 m (fog end 480 m): ${lake.map((h) => h.toFixed(2)).join(', ')}`,
    );
    expect(lake[1]!).toBeLessThan(0.2);
    expect(lake[2]!).toBeLessThan(0.5);
    for (let i = 1; i < lake.length; i++) expect(lake[i]!).toBeGreaterThanOrEqual(lake[i - 1]!);
    // It meets the sea's floor at the fog's end, so the far lake is the far floor's haze, and from there on the two agree.
    expect(lake.at(-1)!).toBeCloseTo(1, 5);
    for (const d of [480, 700, 1200, 3000])
      for (const camY of [2, 100, 300])
        expect(floorHazeAt(d, FOG_FAR, camY, NEAR_WATER_FLOOR)).toBeCloseTo(
          floorHazeAt(d, FOG_FAR, camY, 1),
          9,
        );
  });

  it('only a water floor above the sea is flagged: the sea, and land at any height, keep the far floor flag', () => {
    expect([...floorFlags(network('water', 82.85))]).toEqual([NEAR_WATER_FLOOR]);
    expect([...floorFlags(network('water', 0))]).toEqual([1]);
    expect([...floorFlags(network('land', 40))]).toEqual([1]);
  });

  it("the backdrop's shader carries it (a guard against the mirror drifting from the shader)", () => {
    const built = buildBackdrop(region, network('water', 82.85), [], 7);
    const material = built.mesh.material as ShaderMaterial;
    expect(material.vertexShader).toContain('nearWater');
    built.dispose();
  });
});

describe("a lake takes the fog the land round it takes: three's law by view depth from the fog's start (run C fix check, punch 5)", () => {
  const FOG_NEAR = 220;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  it("the mirror: no haze nearer than the fog's start, three's smoothstep inside the fog, the far floor's past it", () => {
    for (const fogFar of [480, 700]) {
      const rows: string[] = [];
      for (const d of [20, 60, 150, 219, 300, 400, fogFar])
        for (const depth of [d, d * 0.6]) {
          const lake = floorHazeAt(d, fogFar, 2, NEAR_WATER_FLOOR, FOG_NEAR, depth);
          // The land at the same view depth: three's fog (fog_fragment: smoothstep(fogNear, fogFar, vFogDepth)).
          expect(lake).toBeCloseTo(smooth(FOG_NEAR, fogFar, depth), 9);
          if (depth === d)
            rows.push(
              `${d} m: ${lake.toFixed(2)} (old law ${floorHazeAt(d, fogFar, 2, NEAR_WATER_FLOOR).toFixed(2)})`,
            );
        }
      print(
        `[examined] lake haze, fog ${FOG_NEAR} to ${fogFar} m, looking straight at it: ${rows.join(', ')}`,
      );
      // The control: the old law hazed the lake at 150 m while the land beside it was clear.
      expect(floorHazeAt(150, fogFar, 2, NEAR_WATER_FLOOR)).toBeGreaterThan(0.1);
      expect(floorHazeAt(150, fogFar, 2, NEAR_WATER_FLOOR, FOG_NEAR, 150)).toBe(0);
      for (const d of [fogFar, fogFar * 1.5, fogFar * 3])
        expect(floorHazeAt(d, fogFar, 100, NEAR_WATER_FLOOR, FOG_NEAR, d)).toBeCloseTo(
          floorHazeAt(d, fogFar, 100, 1),
          9,
        );
    }
  });

  it("the shader carries it: the lake's fog per pixel from the fog's start, which the renderer passes each frame", () => {
    const built = buildBackdrop(region, network('water', 82.85), [], 7);
    const material = built.mesh.material as ShaderMaterial;
    expect(material.fragmentShader).toContain('smoothstep(uFogNear, uFogFar, vDepth)');
    expect(material.vertexShader).toContain('(1.0 - nearWater)');
    built.update({ x: 0, y: 0, z: 0 }, new Color('#ffffff'), 480, 0, FOG_NEAR);
    expect(material.uniforms['uFogNear']!.value).toBe(FOG_NEAR);
    expect(material.uniforms['uFogFar']!.value).toBe(480);
    built.dispose();
  });
});
