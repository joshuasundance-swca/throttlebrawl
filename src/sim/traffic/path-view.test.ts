import { describe, expect, it } from 'vitest';
import { highwayLanes } from '../../road';
import { testConfig } from '../riders/testing';
import { createWorld, worldHash } from '../world';
import { trafficState, trafficSystem } from './index';
import { pathView, placeRoadVehicle } from './path-view';

describe('physical lane ranks in traffic views', () => {
  it('reuses unchanged physical ranks across paths and refreshes same-tick changes', () => {
    const c = testConfig({ edges: [{ id: 'a', lengthM: 3000, kappa: 0, lanes: highwayLanes(2) }] });
    c.trafficTypes = [
      { contentId: 'base:car', category: 'car', lengthM: 4.6, widthM: 1.8, cruiseMps: 15, hazard: 'normal' },
    ];
    const w = createWorld(c);
    trafficSystem.init(w, c);
    const a = placeRoadVehicle(w, c, { type: 0, pos: { edge: 0, s: 100, d: 2, dir: 1 } });
    const b = placeRoadVehicle(w, c, { type: 0, pos: { edge: 0, s: 200, d: 6, dir: 1 } });
    const st = trafficState(w);
    const paths = [st.paths[a]!, st.paths[b]!];
    for (const p of paths) pathView(w, c, st, p);
    let queries = 0;
    const lanesAt = c.road.lanesAt.bind(c.road);
    c.road.lanesAt = (...args) => {
      queries++;
      return lanesAt(...args);
    };
    c.road.lanesAt(0, 100);
    expect(queries).toBe(1);
    queries = 0;
    const hash = worldHash(w);
    for (let n = 0; n < 10; n++) {
      const view = pathView(w, c, st, paths[n % paths.length]!);
      expect(view.rank[a]).toBe(0);
      expect(view.rank[b]).toBe(1);
    }
    expect(worldHash(w)).toBe(hash);
    expect(queries).toBeLessThanOrEqual(2);
    const car = w.movers[st.id[b]!]!;
    car.pos.d = 2;
    expect(pathView(w, c, st, paths[0]!).rank[b]).toBe(0);
    car.pos.d = -6;
    car.pos.dir = -1;
    expect(pathView(w, c, st, paths[1]!).rank[b]).toBe(1);
  });
});
