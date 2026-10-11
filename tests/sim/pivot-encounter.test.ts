/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, startCareer } from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { createSim, quantizeInput, type EntitySnapshot, type SimInput } from '../../src/sim/api';
import { firstSeed, ISOLATED, seedRange } from './batch';
import { careerRace, onTierBike, REG, tierBike } from './career-harness';

const defs = careerDefs(REG);
const selected = defs.find((d) =>
  d.nodes.some((n) => n.id === d.boss && n.event === 'region-sf:sf-boss-pivot'),
);
if (!selected) throw new Error('No canonical Pivot finale');
const def = selected;
const selectedNode = def.nodes.find((n) => n.id === def.boss);
if (!selectedNode) throw new Error('No finale node');
const node = selectedNode,
  plan = eventPlan(REG, node.event);
const firstLength = plan.lengths[0];
if (!firstLength) throw new Error('No authored finale length');
const authoredRoute = REG.routes[firstLength.route];
if (!authoredRoute) throw new Error('No authored finale route');
const profile = onTierBike(REG, def, node, startCareer(defs, { ...DEFAULT_PROFILE }));
const LIMIT = 3600,
  SEEDS = seedRange(1, 8);
function run(seed: number) {
  const built = careerRace(def, node, profile, seed, { tuning: ISOLATED });
  const { config } = built,
    sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const rivalId = config.riders.findIndex((r) => r.contentId === plan.rules.rival);
  const initial = sim
    .snapshot()
    .entities.filter((e) => e.kind === 'rider')
    .map((e) => ({
      id: e.id,
      contentId: e.contentId,
      progress: e.progress,
      speed: e.speed,
      road: e.road,
    }));
  const inputs: SimInput[] = [];
  const phases: {
    phase: string;
    tick: number;
    speed: number;
    playerSpeed: number;
    gap: number;
    d: number;
  }[] = [];
  let last = '',
    tell = -1,
    firstTell = -1,
    act = -1,
    open = -1,
    ended = -1;
  let openSpeed = 0,
    endSpeed = 0,
    openGap = 0,
    endGap = 0;
  let attacks = 0,
    collisions = 0,
    offRoad = 0;
  let line: number | null = null;
  while (sim.tick < LIMIT && !sim.isOver()) {
    const snap = sim.snapshot(),
      me = snap.entities[playerId] as EntitySnapshot,
      pv = snap.entities[rivalId] as EntitySnapshot;
    const phase = pv.signature?.phase ?? '';
    if (phase !== last) {
      phases.push({
        phase,
        tick: sim.tick,
        speed: pv.speed,
        playerSpeed: me.speed,
        gap: me.progress - pv.progress,
        d: pv.road.d,
      });
      if (phase === 'tell') {
        tell = sim.tick;
        if (firstTell < 0) firstTell = sim.tick;
      }
      if (phase === 'act') act = sim.tick;
      if (phase === 'open') {
        open = sim.tick;
        openSpeed = pv.speed;
        openGap = me.progress - pv.progress;
      }
      if (open >= 0 && phase === '') {
        ended = sim.tick;
        endSpeed = pv.speed;
        endGap = me.progress - pv.progress;
        if (endGap > 0 && openGap < 0 && collisions === 0 && offRoad === 0) break;
      }
      last = phase;
    }
    if (phase === 'open' && (me.mode !== 'Road' || pv.mode !== 'Road')) offRoad++;
    if ((phase === 'tell' || phase === 'open') && pv.attackPhase !== 'idle' && pv.attackPhase !== 'cooldown')
      attacks++;
    const edge = config.road.edges[me.road.edge];
    // A stable outer line keeps clear of the starting pack and the rival's swap. Read only the
    // road and riders' public positions; no private committed direction or readiness injection.
    line ??= (edge?.dMax ?? 4) - 0.9;
    const kappa = config.road.kappaAt(me.road.edge, me.road.s) * me.road.dir;
    const gap = me.progress - pv.progress;
    const want = phase === 'open' ? Infinity : Math.max(10, pv.speed + (-10 - gap) * 1.2);
    const input = quantizeInput({
      steer: Math.max(
        -1,
        Math.min(
          1,
          0.35 * (line - me.road.d) * me.road.dir - 2.5 * me.road.yaw + (kappa * me.speed * me.speed) / 22,
        ),
      ),
      throttle: me.speed < want ? 1 : 0.35,
      brake: me.speed > want + 2 ? 0.6 : 0,
      flags: 0,
    });
    inputs.push(input);
    sim.step([input]);
    collisions += sim
      .events()
      .filter(
        (e) =>
          (e.actor === playerId || e.target === playerId) &&
          ['hit', 'kick', 'takedown', 'tumble', 'bump'].includes(e.type),
      ).length;
  }
  const replay = createSim(config);
  for (const input of inputs) replay.step([input]);
  return {
    built,
    initial,
    phases,
    inputs,
    tell,
    firstTell,
    act,
    open,
    ended,
    openSpeed,
    endSpeed,
    openGap,
    endGap,
    attacks,
    collisions,
    offRoad,
    ticks: sim.tick,
    hash: sim.hash(),
    replayHash: replay.hash(),
  };
}
describe('the authored Downtown Pivot encounter', () => {
  it('resolves the canonical event/rival, authored route and effective career ladder bikes', () => {
    const { config, length, level } = careerRace(def, node, profile, 1, { tuning: ISOLATED });
    expect(node.event).toBe('region-sf:sf-boss-pivot');
    expect(config.event.contentId).toBe(node.event);
    expect(config.event.kind).toBe(plan.kind);
    expect(plan.kind).toBe('grudge-match');
    expect(plan.rules.rival).toBe('region-sf:pivot');
    expect(config.riders.find((r) => r.contentId === plan.rules.rival)?.controller).toMatchObject({
      kind: 'ai',
      personality: { signature: REG.riders[plan.rules.rival!]!.personality.signature },
    });
    expect(length.route).toBe(plan.lengths.find((l) => l.id === length.id)?.route);
    expect(config.route.routeId).toBe(length.route.split(':').at(-1));
    expect(REG.routes[length.route]?.network).toBe(authoredRoute.network);
    expect(config.riders.find((r) => r.controller.kind === 'player')?.bike.contentId).toBe(
      tierBike(def, node)?.key,
    );
    expect(config.event.paceMps).toBe(level?.paceMps);
    expect(config.event.level?.signatureGapScale).toBe(level?.signatureGapScale);
    for (const rider of config.riders.filter((r) => r.controller.kind === 'ai' && r.faction !== 'law'))
      expect(rider.bike.contentId).toBe(level?.rivalBike);
  });
  it('approaches cleanly, observes the finite tactic and gains position in its actual sag', () => {
    const found = firstSeed(
      'authored Pivot clean sag pass',
      SEEDS,
      run,
      (r) =>
        r.firstTell >= 240 &&
        r.firstTell < 600 &&
        r.ended > r.open &&
        r.endGap > 0 &&
        r.openGap < 0 &&
        r.collisions === 0 &&
        r.offRoad === 0,
    );
    process.stdout.write(
      `[pivot-search] ${JSON.stringify(
        found.tried.map(({ seed, result: r }) => ({
          seed,
          ticks: r.ticks,
          phases: r.phases,
          collisions: r.collisions,
          offRoad: r.offRoad,
          gap: [r.openGap, r.endGap],
          speed: [r.openSpeed, r.endSpeed],
          hash: [r.hash, r.replayHash],
        })),
      )}\n`,
    );
    expect(found.result, found.summary).not.toBeNull();
    if (!found.result) throw new Error(found.summary);
    const r = found.result;
    process.stdout.write(`[pivot-grid] ${JSON.stringify(r.initial)}\n`);
    process.stdout.write(
      `[pivot] event ${node.event}; route ${r.built.length.route}; player bike ${profile.bikes.current}; ` +
        `pace ${r.built.config.event.paceMps}; gap scale ${r.built.level?.signatureGapScale}; seeds 1–8; limit ${LIMIT}; ` +
        `seed ${found.seed}; phases ${JSON.stringify(r.phases)}; attacks ${r.attacks}; ` +
        `input ticks ${r.inputs.length}; hashes ${r.hash}/${r.replayHash}\n`,
    );
    expect(r.act - r.tell).toBe(48);
    expect(r.open - r.act).toBe(45);
    expect(r.ended - r.open).toBe(120);
    expect(r.endSpeed).toBeLessThan(r.openSpeed - 1);
    expect(r.endGap).toBeGreaterThan(r.openGap + 1);
    expect(r.attacks).toBe(0);
    expect(r.inputs.every((i) => i.flags === 0)).toBe(true);
    expect(r.hash).toBe(r.replayHash);
  });
});
