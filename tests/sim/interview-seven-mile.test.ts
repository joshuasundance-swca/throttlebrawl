/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createSimWithWorld } from '../../src/sim/create';
import { COP_CHASING, copsState } from '../../src/sim/cops';
import { aiState } from '../../src/sim/ai';
import { ISOLATED } from './batch';

const all = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const choice = regionChoices(all).find((c) => lookup(all.events, c.eventId).region === 'florida-keys')!;
const streams = createStreamCache();
const config = buildSimConfig(
  all,
  streams.forEvent(all, choice.eventId, undefined, 'base:osm-seven-mile-run'),
  {
    seed: 1,
    eventId: choice.eventId,
    route: 'base:osm-seven-mile-run',
    tuning: ISOLATED,
  },
);

it('the old road offers occasional participation rather than none or everybody', () => {
  const branch = config.route.branches.find((b) =>
    b.edges.some((e) => config.road.featuresOf(e, 'rampTruck').length),
  )!;
  expect(branch.aiTake).toBeGreaterThan(0);
  expect(branch.aiTake).toBeLessThan(0.5);
  const rival = config.riders.find((r) => r.controller.kind === 'ai')!;
  let takes = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { world } = createSimWithWorld({
      ...config,
      seed,
      riders: [rival],
      trafficTypes: [],
      modifiers: [],
    });
    if (aiState(world).shortcuts[0]) takes++;
  }
  expect(takes).toBeGreaterThan(5);
  expect(takes).toBeLessThan(35);
});

it('a rival rides from the turn-off through the branch and returns to the highway', () => {
  const branch = config.route.branches.find((b) =>
    b.edges.some((e) => config.road.featuresOf(e, 'rampTruck').length),
  )!;
  const zone = branch.choice!;
  const rival = config.riders.find((r) => r.controller.kind === 'ai')!;
  const player = config.riders.find((r) => r.controller.kind === 'player')!;
  const cfg = {
    ...config,
    riders: [{ ...rival, controller: { kind: 'ai' as const, style: 'racer' }, bike: player.bike }],
    trafficTypes: [],
    modifiers: [],
  };
  const { sim, world } = createSimWithWorld(cfg);
  const m = world.movers[0]!;
  m.pos = { edge: zone.edge, s: zone.s0, d: (zone.d0 + zone.d1) / 2, dir: 1 };
  m.speed = player.bike.topSpeedMps;
  aiState(world).shortcuts[0] = 0xffffffff;
  const visited = new Set<number>();
  const crashes: unknown[] = [];
  for (let tick = 0; tick < 60 * 500; tick++) {
    sim.step([]);
    if (branch.edges.includes(m.pos.edge)) visited.add(m.pos.edge);
    for (const e of sim.events()) if (e.type === 'crash') crashes.push(e.data);
    if (
      crashes.length ||
      (visited.size === branch.edges.length && !branch.edges.includes(m.pos.edge) && m.mode === 'Road')
    )
      break;
  }
  expect(crashes).toEqual([]);
  expect([...visited].sort()).toEqual([...branch.edges].sort());
  expect(branch.edges.includes(m.pos.edge)).toBe(false);
});

it.each(['rival', 'police'] as const)(
  '%s can ride the real staging hops and missing span using its own controller',
  (kind) => {
    const branch = config.route.branches.find((b) =>
      b.edges.some((e) => config.road.featuresOf(e, 'rampTruck').length),
    )!;
    const rival = config.riders.find((r) => r.controller.kind === 'ai')!;
    const participant =
      kind === 'rival'
        ? { ...rival, controller: { kind: 'ai' as const, style: 'racer' } }
        : config.riders.find((r) => r.controller.kind === 'cop')!;
    const player = config.riders.find((r) => r.controller.kind === 'player')!;
    const cfg = {
      ...config,
      riders: [{ ...participant, bike: player.bike }, player],
      trafficTypes: [],
      modifiers: [],
    };
    for (const edge of branch.edges) {
      const gaps = cfg.road.featuresOf(edge, 'gap');
      if (!gaps.length) continue;
      const { sim, world } = createSimWithWorld(cfg);
      const m = world.movers[0]!;
      m.pos = { edge, s: Math.max(0, gaps[0]!.s0 - 180), d: 0, dir: 1 };
      m.speed = player.bike.topSpeedMps;
      if (kind === 'police') {
        const p = world.movers[1]!;
        p.pos = { edge, s: gaps[0]!.s1 + 120, d: 3, dir: 1 };
        const st = copsState(world);
        st.phase[m.id] = COP_CHASING;
        st.target[m.id] = p.id;
      }
      let landed = false;
      const crashes: unknown[] = [];
      for (let tick = 0; tick < 60 * 25; tick++) {
        sim.step([]);
        for (const e of sim.events()) if (e.type === 'crash') crashes.push(e.data);
        if (m.mode === 'Road' && (m.pos.edge !== edge || m.pos.s > gaps[0]!.s1 + 10)) {
          landed = true;
          break;
        }
        if (crashes.length) break;
      }
      expect(crashes, cfg.road.edges[edge]!.id).toEqual([]);
      expect(landed, cfg.road.edges[edge]!.id).toBe(true);
    }
  },
);
