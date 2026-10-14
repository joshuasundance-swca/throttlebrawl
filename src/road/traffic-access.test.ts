import { describe, expect, it } from 'vitest';
import { fixtureBranchNetwork, lintRoadNetwork, readConnector } from './index';

describe('explicit branch traffic validation', () => {
  it('accepts an ordinary shortcut with complete directed access, independent of racing kind', () => {
    const f = fixtureBranchNetwork();
    const route = {
      ...f.route,
      branches: [
        { id: 'cut', kind: 'shortcut' as const, roads: ['c-in', 'cut', 'c-out'], traffic: 'road' as const },
      ],
    };
    expect(lintRoadNetwork({ ...f, routes: [route] }).filter((i) => i.pointer.includes('/traffic'))).toEqual(
      [],
    );
  });
  it('rejects a branch whose only entrance comes from an opposing lane', () => {
    const f = fixtureBranchNetwork();
    const network = {
      ...f.network,
      junctions: f.network.junctions.map((j) => ({
        ...j,
        connectors: j.connectors.map((raw) => {
          const r = readConnector(raw);
          return r?.road === 'c-in' ? { ...r, from: { ...r.from, lane: 'L1' } } : raw;
        }),
      })),
    };
    const route = {
      ...f.route,
      branches: [{ id: 'cut', roads: ['c-in', 'cut', 'c-out'], traffic: 'road' as const }],
    };
    const found = lintRoadNetwork({ ...f, network, routes: [route] });
    expect(found.some((i) => i.pointer.includes('/traffic') && i.message.includes('legal'))).toBe(true);
    expect(
      lintRoadNetwork({
        ...f,
        network,
        routes: [{ ...route, branches: [{ id: 'cut', roads: ['c-in', 'cut', 'c-out'] }] }],
      }).some((i) => i.pointer.includes('/traffic')),
    ).toBe(false);
  });
  it('rejects traffic permission through a gap while preserving an excluded rider-only choice', () => {
    const f = fixtureBranchNetwork();
    const roads = f.roads.map((r) =>
      r.id === 'cut' ? { ...r, features: [{ kind: 'gap', id: 'hole', s0: 100, s1: 110, d0: -2, d1: 2 }] } : r,
    );
    const branch = { id: 'cut', roads: ['c-in', 'cut', 'c-out'] };
    const findings = (traffic: 'road' | 'none') =>
      lintRoadNetwork({ ...f, roads, routes: [{ ...f.route, branches: [{ ...branch, traffic }] }] });
    expect(findings('road').some((i) => i.pointer.includes('/traffic') && i.message.includes('gap'))).toBe(
      true,
    );
    expect(findings('none').some((i) => i.pointer.includes('/traffic'))).toBe(false);
  });
});
