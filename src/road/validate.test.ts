import { describe, expect, it } from 'vitest';
import { MAX_HEIGHT_M } from '../core';
import {
  fixtureNetwork,
  lintRoadNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from './index';

// The road lint (M1 road-1): every rule has a fixture that must fail it, and the clean fixture
// must pass every rule.

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

function clean(): Mutable<BakedNetworkBundle> & { routes: BakedRoute[] } {
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 300, kappa: 0 },
    { id: 'b', lengthM: 401, kappa: 1 / 200, grade: 0.03 },
    { id: 'c', lengthM: 300, kappa: -1 / 250 },
  ]) as Mutable<BakedNetworkBundle>;
  const route: BakedRoute = {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 280 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    checkpoints: [{ road: 'b', s: 200 }],
    closed: false,
  };
  return { ...bundle, routes: [route] };
}

const road = (b: ReturnType<typeof clean>, id: string): Mutable<BakedRoad> => {
  const r = b.roads.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const col = (r: Mutable<BakedRoad>, name: string): number[] => r.samples.data[name] as number[];
const rules = (b: ReturnType<typeof clean>) => lintRoadNetwork(b).map((i) => i.rule);

describe('road/validate: the road lint', () => {
  it('passes a clean fixture, with no issues from any rule', () => {
    expect(lintRoadNetwork(clean())).toEqual([]);
  });

  it('samples: fails a missing sample, a wrong spacing and a missing column', () => {
    const b = clean();
    for (const c of Object.values(road(b, 'a').samples.data)) c.pop();
    expect(rules(b)).toContain('samples');

    const b2 = clean();
    road(b2, 'b').sampleSpacingM = 2.1;
    const issues = lintRoadNetwork(b2);
    expect(issues.some((i) => i.rule === 'samples' && i.pointer === '/sampleSpacingM')).toBe(true);

    const b3 = clean();
    delete (road(b3, 'c').samples.data as Record<string, number[]>)['kappa'];
    expect(rules(b3)).toContain('samples');
  });

  it('samples: fails samples that are not the stated spacing apart', () => {
    const b = clean();
    const x = col(road(b, 'a'), 'x');
    const z = col(road(b, 'a'), 'z');
    // Stretch the road to 1.5 times its length while the file still says 300 m.
    for (let i = 0; i < x.length; i++) {
      x[i] = (x[i] as number) * 1.5;
      z[i] = (z[i] as number) * 1.5;
    }
    const issues = lintRoadNetwork(b).filter((i) => i.rule === 'samples');
    expect(issues.some((i) => i.message.includes('apart'))).toBe(true);
  });

  it('curvature: fails kappa that disagrees with the positions', () => {
    const b = clean();
    const k = col(road(b, 'b'), 'kappa');
    for (let i = 0; i < k.length; i++) k[i] = 0; // a bend claiming to be straight
    const issues = lintRoadNetwork(b).filter((i) => i.rule === 'curvature');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.file).toBe('road:b');
    expect(issues[0]?.pointer).toMatch(/^\/samples\/data\/kappa\/\d+$/);
  });

  it('curvature: fails a right bend stored with a left-hand sign', () => {
    const b = clean();
    const k = col(road(b, 'b'), 'kappa');
    for (let i = 0; i < k.length; i++) k[i] = -(k[i] as number);
    expect(rules(b)).toContain('curvature');
  });

  it('grade: fails grade that disagrees with the elevation', () => {
    const b = clean();
    const g = col(road(b, 'b'), 'grade');
    for (let i = 0; i < g.length; i++) g[i] = 0;
    expect(rules(b)).toContain('grade');
  });

  it('kappa-width: fails |kappa|·dMax >= 0.5', () => {
    const b = fixtureNetwork([{ id: 'tight', lengthM: 20, kappa: 0.11 }]);
    const issues = lintRoadNetwork(b);
    expect(issues.map((i) => i.rule)).toContain('kappa-width');
    // Just under the limit passes: 0.1 · 4.9 = 0.49.
    expect(
      lintRoadNetwork(fixtureNetwork([{ id: 'ok', lengthM: 20, kappa: 0.1 }])).map((i) => i.rule),
    ).not.toContain('kappa-width');
  });

  it('features: fails features, tags and barriers outside the road', () => {
    const b = clean();
    road(b, 'a').features = [{ kind: 'roadsideZone', id: 'z', s0: 250, s1: 320, d0: 5, d1: 9 }];
    expect(rules(b)).toContain('features');

    const b2 = clean();
    road(b2, 'a').tags = [{ s0: -5, s1: 100, side: 'both', tag: 'palms' }];
    expect(rules(b2)).toContain('features');

    const b3 = clean();
    road(b3, 'a').barriers = [{ s0: 0, s1: 400, side: 'left', kind: 'rail', heightM: 1 }];
    expect(rules(b3)).toContain('features');

    const b4 = clean();
    road(b4, 'a').features = [{ kind: 'copSpawn', id: 'c', s0: 10, s1: 20, d0: 9, d1: 5 }];
    expect(rules(b4)).toContain('features');

    const b5 = clean();
    road(b5, 'a').features = [{ kind: 'teleporter', id: 't', s0: 10, s1: 20, d0: 5, d1: 9 }];
    expect(rules(b5)).toContain('features');
  });

  it('features: fails a solid hazard over a lane, passes one off the lanes or one that is not solid (run W-U)', () => {
    const pickup = { kind: 'hazard', id: 'p', s0: 100, s1: 105.4, params: { solid: true, object: 'pickup' } };
    const on = clean();
    road(on, 'a').features = [{ ...pickup, d0: 4.0, d1: 6.1 }]; // over the shoulder (out to 4.9)
    const issues = lintRoadNetwork(on).filter((i) => i.rule === 'features');
    expect(issues.map((i) => i.message).join()).toMatch(/solid hazard p stands on lane R0/);

    const off = clean();
    road(off, 'a').features = [{ ...pickup, d0: 6.0, d1: 8.1 }];
    expect(rules(off)).not.toContain('features');

    const decor = clean();
    road(decor, 'a').features = [{ ...pickup, d0: 1, d1: 3, params: { object: 'pickup' } }];
    expect(rules(decor)).not.toContain('features');
  });

  it("features: a hazard's params.heightM must be above 0 and at most MAX_HEIGHT_M (the height contract)", () => {
    const pickup = {
      kind: 'hazard',
      id: 'p',
      s0: 100,
      s1: 105.4,
      d0: 6.0,
      d1: 8.1,
      params: { solid: true, object: 'pickup', heightM: 1.9 },
    };
    const lint = (heightM: unknown) => {
      const b = clean();
      road(b, 'a').features = [{ ...pickup, params: { ...pickup.params, heightM } }];
      return lintRoadNetwork(b)
        .filter((i) => i.rule === 'features')
        .map((i) => `${i.pointer} ${i.message}`)
        .join();
    };
    expect(lint(1.9)).toBe('');
    // A feature that gives none is fine: the object's default height applies (core hazardHeightM).
    const none = clean();
    road(none, 'a').features = [{ ...pickup, params: { solid: true, object: 'pickup' } }];
    expect(rules(none)).not.toContain('features');
    // The negative controls: zero, negative, over the bound, and not a number.
    for (const bad of [0, -1, MAX_HEIGHT_M + 0.1, '1.9', null])
      expect(lint(bad), `heightM ${String(bad)}`).toMatch(/\/features\/0\/params\/heightM .*heightM/);
  });

  it('junction-ends: fails a road end more than 0.5 m from its junction', () => {
    const b = clean();
    const j = b.network.junctions[1];
    if (!j) throw new Error('fixture');
    j.x += 0.6;
    const issues = lintRoadNetwork(b).filter((i) => i.rule === 'junction-ends');
    // Both roads meeting there are off by 0.6 m.
    expect(issues.length).toBe(2);
    const b2 = clean();
    const j2 = b2.network.junctions[1];
    if (!j2) throw new Error('fixture');
    j2.x += 0.4;
    expect(rules(b2)).not.toContain('junction-ends');
  });

  it('lanes: fails a non-positive width and a first section not at s 0', () => {
    const b = clean();
    const lanes = road(b, 'a').laneSections[0]?.lanes;
    if (!lanes?.[0]) throw new Error('fixture');
    lanes[0] = { ...lanes[0], widthM: 0 };
    expect(rules(b)).toContain('lanes');
    const b2 = clean();
    const sec = road(b2, 'a').laneSections[0];
    if (!sec) throw new Error('fixture');
    sec.s0 = 5;
    expect(rules(b2)).toContain('lanes');
  });

  it('network: fails a missing road, an unknown junction and a road end in no junction', () => {
    const b = clean();
    b.network.roads = [...b.network.roads, 'ghost'];
    expect(rules(b)).toContain('network');
    const b2 = clean();
    road(b2, 'a').from = 'nowhere';
    expect(rules(b2)).toContain('network');
    const b3 = clean();
    const j0 = b3.network.junctions[0];
    if (!j0) throw new Error('fixture');
    j0.ends = [];
    expect(rules(b3)).toContain('network');
  });

  it('route: fails an unconnected main path, a road outside the allowed set and an s off the road', () => {
    const b = clean();
    b.routes[0] = { ...(b.routes[0] as BakedRoute), mainPath: ['a', 'c'] };
    expect(rules(b)).toContain('route');
    const b2 = clean();
    b2.routes[0] = { ...(b2.routes[0] as BakedRoute), allowedRoads: ['a', 'b'] };
    expect(rules(b2)).toContain('route');
    const b3 = clean();
    b3.routes[0] = { ...(b3.routes[0] as BakedRoute), finish: { road: 'c', s: 999 } };
    expect(rules(b3)).toContain('route');
    const b4 = clean();
    b4.routes[0] = { ...(b4.routes[0] as BakedRoute), network: 'other' };
    expect(rules(b4)).toContain('route');
  });

  it('labels each issue with the file the caller names', () => {
    const b = clean();
    road(b, 'b').sampleSpacingM = 2.1;
    const [issue] = lintRoadNetwork(b, (kind, id) => `packs/base/regions/x/${kind}s/${id}.json`);
    expect(issue?.file).toBe('packs/base/regions/x/roads/b.json');
  });
});
