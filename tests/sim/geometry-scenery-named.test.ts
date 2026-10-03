/// <reference types="vite/client" />
// The scenery sweep (geometry-scenery.ts) over the named seeds: the fixed test seeds and every seed a
// skeptic named. The spread seeds run in geometry-scenery-spread.test.ts. Also here: the negative
// control, a broken scene the sweep must flag.
import { describe, expect, it } from 'vitest';
import { buildRoadScene } from '../../src/render/road-mesh';
import type { ScenerySpot } from '../../src/render/scenery';
import { scatterRoadside } from '../../src/render/roadside';
import { DownIndex, look, NAMED_SEEDS, routeNetworks, track } from './geometry-routes';
import { badProps, badSpots, kitOf, scenerySweep } from './geometry-scenery';

scenerySweep('named', NAMED_SEEDS);

describe('negative control: the scenery sweep fires on a broken scene', () => {
  it('flags a palm out at sea, a pole on a bridge, a floating shack and a boat on land', () => {
    const net = routeNetworks().find((n) => n.id === 'keys-m1')!;
    const t = track(net);
    const built = buildRoadScene(t.road, look, t.dressing, { seed: 1 });
    const ground = new DownIndex(built.group);
    const clean = badSpots(t, built.spots, ground);
    expect([...clean.water, ...clean.land]).toEqual([]);
    const palm = built.spots.find((s) => s.kind === 'palm')!;
    const shack = built.spots.find((s) => s.kind === 'shack')!;
    const boat = built.spots.find((s) => s.kind === 'skiff' || s.kind === 'boat')!;
    const bridge = t.road.edges.find((e) => e.id === 'm1-long-bridge')!;
    const deck = t.road.toWorld(bridge.index, 600, 9, 0);
    const broken: ScenerySpot[] = [
      // 300 m further out than any land strip reaches.
      { ...palm, p: { ...palm.p, x: palm.p.x + 300, z: palm.p.z + 300 } },
      { ...palm, kind: 'pole', edge: bridge.index, s: 600, d: 9, p: deck },
      { ...shack, p: { ...shack.p, y: shack.p.y + 2 } },
      { ...boat, p: { ...palm.p, y: 0 } },
    ];
    const r = badSpots(t, broken, ground);
    built.dispose();
    process.stdout.write(
      `[negative control] ${r.water.length + r.land.length} of 4 flagged: ${[...r.water, ...r.land].join(' | ')}\n`,
    );
    expect(r.water.some((l) => l.includes(' palm ') && l.includes('over'))).toBe(true);
    expect(r.water.some((l) => l.includes(' pole m1-long-bridge') && l.includes('bridge'))).toBe(true);
    expect(r.land.some((l) => l.includes(' shack ') && l.includes('floats'))).toBe(true);
    expect(r.water.some((l) => l.includes('a boat on road-land'))).toBe(true);
  });

  it('flags a roadside prop out at sea, one hovering a metre up and one on a bridge', () => {
    const net = routeNetworks().find((n) => n.id === 'osm-pnw-gorge')!;
    const t = track(net);
    const kit = kitOf(t)!;
    const built = buildRoadScene(t.road, look, t.dressing, { seed: 7 });
    const ground = new DownIndex(built.group);
    const items = scatterRoadside({
      road: t.road,
      dressing: t.dressing,
      seed: 7,
      density: 1,
      kit,
      landReach: (e, side, s) => built.landReach(e, side, s),
      spots: built.spots,
    });
    expect(items.length).toBeGreaterThan(300);
    const clean = badProps(t, kit, items, ground);
    expect([...clean.water, ...clean.land]).toEqual([]);
    // A one-point prop, so only its anchor is read.
    const fern = items.find((i) => i.rule === 'fern')!;
    const bridge = t.road.edges.find((e) => e.id === 'osm-gorge-latourell')!;
    const broken = [
      { ...fern, p: { ...fern.p, x: fern.p.x + 2000, z: fern.p.z + 2000 } },
      { ...fern, p: { ...fern.p, y: fern.p.y + 1 } },
      { ...fern, edge: bridge.index, s: 1080, p: t.road.toWorld(bridge.index, 1080, 8, 0) },
    ];
    const r = badProps(t, kit, broken, ground);
    built.dispose();
    process.stdout.write(
      `[negative control] ${r.water.length + r.land.length} of 3 props flagged: ${[...r.water, ...r.land].join(' | ')}\n`,
    );
    expect(r.water.some((l) => l.includes(' over '))).toBe(true);
    expect(r.land.some((l) => l.includes('1.00 m off the land'))).toBe(true);
    expect(r.water.some((l) => l.includes('osm-gorge-latourell') && l.includes('bridge'))).toBe(true);
  });
});
