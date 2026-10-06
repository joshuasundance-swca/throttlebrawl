// A lake reads as water from the road (playtest 4 run C's live check, punch item 6: "Lake Samish ... shows only as
// a pale flat plain in the haze, even from the far camera"). The backdrop's far floors come out of the fog's end
// gradually and are wholly the haze's colour inside it, because the near world's own sea and ground cover them
// there. A lake above the sea has no near layer: inside the fog's end it was the haze's colour, the colour of the
// fog on the land round it, so it was a pale plain. A floor above the sea keeps its own colour and takes the
// fog's haze by distance, as the near land does (the mirror of the vertex shader, `floorHazeAt`).
import { describe, expect, it } from 'vitest';
import type { ShaderMaterial } from 'three';
import type { BackdropNetworkFile, BackdropRegionFile } from './data';
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
