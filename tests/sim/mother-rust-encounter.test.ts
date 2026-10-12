/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, startCareer } from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { createSim, quantizeInput, type EntitySnapshot, type SimInput } from '../../src/sim/api';
import { firstSeed, ISOLATED, seedRange } from './batch';
import { careerRace, onTierBike, REG, tierBike } from './career-harness';

const defs = careerDefs(REG);
const def = defs.find((d) =>
  d.nodes.some((n) => n.id === d.boss && n.event === 'base:keys-boss-mother-rust'),
);
if (!def) throw new Error('Missing canonical Mother Rust career finale');
const node = def.nodes.find((n) => n.id === def.boss);
if (!node) throw new Error('Missing finale node');
const plan = eventPlan(REG, node.event);
const rivalKey = plan.rules.rival;
if (!rivalKey || REG.riders[rivalKey]?.personality?.signature !== 'ram')
  throw new Error('Missing authored ram rival');
const profile = onTierBike(REG, def, node, startCareer(defs, { ...DEFAULT_PROFILE }));
const LIMIT = 4800;

function probe(seed: number) {
  const built = careerRace(def!, node!, profile, seed, { tuning: ISOLATED });
  const { config } = built,
    sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const rivalId = config.riders.findIndex((r) => r.contentId === rivalKey);
  const initial = sim
    .snapshot()
    .entities.filter((e) => e.kind === 'rider')
    .map((e) => ({ id: e.id, contentId: e.contentId, progress: e.progress, speed: e.speed, d: e.road.d }));
  const inputs: SimInput[] = [];
  const phases: {
    phase: string;
    tick: number;
    target: number;
    speed: number;
    playerSpeed: number;
    gap: number;
    d: number;
    playerD: number;
  }[] = [];
  let previous = '',
    tell = -1,
    act = -1,
    open = -1,
    ended = -1,
    resumed = -1;
  let playerTarget = false,
    line: number | null = null,
    dodge: number | null = null,
    actLine = 0;
  let openSpeed = 0,
    endSpeed = 0,
    openGap = 0,
    endGap = 0,
    minSpeed = Infinity;
  let attacks = 0,
    collisions = 0,
    offRoad = 0,
    committedTravel = 0,
    playerDodge = 0;
  while (sim.tick < LIMIT && !sim.isOver()) {
    const snap = sim.snapshot(),
      me = snap.entities[playerId] as EntitySnapshot,
      rust = snap.entities[rivalId] as EntitySnapshot;
    const phase = rust.signature?.phase ?? '';
    if (phase !== previous) {
      phases.push({
        phase,
        tick: sim.tick,
        target: rust.signature?.targetId ?? -1,
        speed: rust.speed,
        playerSpeed: me.speed,
        gap: me.progress - rust.progress,
        d: rust.road.d,
        playerD: me.road.d,
      });
      if (phase === 'tell' && tell < 0 && rust.signature?.targetId === playerId) {
        tell = sim.tick;
        playerTarget = true;
        line = me.road.d;
      }
      if (phase === 'act' && tell >= 0 && act < 0 && rust.signature?.targetId === playerId) {
        act = sim.tick;
        actLine = me.road.d;
        const edge = config.road.edges[me.road.edge];
        dodge = Math.max(
          (edge?.dMin ?? -4) + 0.9,
          Math.min((edge?.dMax ?? 4) - 0.9, actLine + (actLine > rust.road.d ? 1 : -1) * 2.4),
        );
      }
      if (phase === 'open' && act >= 0 && open < 0 && rust.signature?.targetId === playerId) {
        open = sim.tick;
        openSpeed = rust.speed;
        openGap = me.progress - rust.progress;
      }
      if (phase === '' && open >= 0 && ended < 0) {
        ended = sim.tick;
        endSpeed = rust.speed;
        endGap = me.progress - rust.progress;
      }
      previous = phase;
    }
    if (act >= 0 && open < 0) {
      playerDodge = Math.max(playerDodge, Math.abs(me.road.d - actLine));
      // Real lateral movement toward the line occupied at commitment, despite the player's
      // ongoing lateral input. The isolated unit scene separately asserts the private fixed line.
      const atAct = phases.find((p) => p.tick === act);
      if (atAct)
        committedTravel = Math.max(committedTravel, (rust.road.d - atAct.d) * Math.sign(actLine - atAct.d));
    }
    if (open >= 0 && ended < 0) {
      minSpeed = Math.min(minSpeed, rust.speed);
      if (rust.mode !== 'Road' || me.mode !== 'Road') offRoad++;
      if (!['idle', 'cooldown'].includes(rust.attackPhase)) attacks++;
    }
    if (ended >= 0 && rust.throttle > 0.1 && rust.speed > endSpeed + 0.2) {
      resumed = sim.tick;
      break;
    }
    const edge = config.road.edges[me.road.edge];
    // Approach alongside from behind on a distinct line using real inputs only. Freeze that
    // preparation line, dodge laterally only once the player's targeted act starts, then pass.
    if (tell < 0)
      line = Math.max((edge?.dMin ?? -4) + 0.9, Math.min((edge?.dMax ?? 4) - 0.9, rust.road.d - 1.8));
    const wantLine = dodge ?? line ?? 1;
    const gap = me.progress - rust.progress;
    const wantSpeed = open >= 0 ? Infinity : Math.max(10, rust.speed + (-1.2 - gap) * 1.2);
    const kappa = config.road.kappaAt(me.road.edge, me.road.s) * me.road.dir;
    const input = quantizeInput({
      steer: Math.max(
        -1,
        Math.min(
          1,
          (wantLine - me.road.d) * me.road.dir * 0.35 -
            me.road.yaw * 2.5 +
            (kappa * me.speed * me.speed) / 22,
        ),
      ),
      throttle: me.speed < wantSpeed ? 1 : 0.35,
      brake: me.speed > wantSpeed + 2 ? 0.6 : 0,
      flags: 0,
    });
    inputs.push(input);
    sim.step([input]);
    if (tell >= 0)
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
    tell,
    act,
    open,
    ended,
    resumed,
    playerTarget,
    openSpeed,
    endSpeed,
    minSpeed: Number.isFinite(minSpeed) ? minSpeed : null,
    openGap,
    endGap,
    committedTravel,
    playerDodge,
    collisions,
    attacks,
    offRoad,
    ticks: sim.tick,
    hash: sim.hash(),
    replayHash: replay.hash(),
  };
}

describe('the authored Mother Rust Drawbridge encounter', () => {
  it('resolves the canonical content, route and effective career bike ladder', () => {
    const { config, length, level } = careerRace(def, node, profile, 1, { tuning: ISOLATED });
    expect(config.event.contentId).toBe(node.event);
    expect(config.event.kind).toBe(plan.kind);
    expect(plan.kind).toBe('grudge-match');
    expect(rivalKey).toBe('base:mother-rust');
    expect(config.riders.find((r) => r.contentId === rivalKey)?.controller).toMatchObject({
      kind: 'ai',
      personality: { signature: 'ram' },
    });
    expect(length.route).toBe(plan.lengths.find((l) => l.id === length.id)?.route);
    expect(config.route.routeId).toBe(length.route.split(':').at(-1));
    expect(config.riders.find((r) => r.controller.kind === 'player')?.bike.contentId).toBe(
      tierBike(def, node)?.key,
    );
    expect(config.event.paceMps).toBe(level?.paceMps);
    expect(config.event.level?.signatureGapScale).toBe(level?.signatureGapScale);
  });
  it('qualifies a player-targeted late dodge and real recovery within the bounded search', () => {
    const found = firstSeed(
      'authored Mother Rust player ram recovery',
      seedRange(1, 16),
      probe,
      (r) =>
        r.playerTarget &&
        r.act >= 0 &&
        r.ended > r.open &&
        r.resumed > r.ended &&
        r.endSpeed < r.openSpeed - 1 &&
        r.endGap > Math.max(0, r.openGap + 1) &&
        r.playerDodge > 0.4 &&
        r.committedTravel > 0.2 &&
        r.collisions === 0 &&
        r.offRoad === 0,
    );
    process.stdout.write(
      `[mother-rust-search] ${JSON.stringify(found.tried.map(({ seed, result: r }) => ({ seed, ...r, built: undefined, initial: undefined })))}\n`,
    );
    expect(found.result, found.summary).not.toBeNull();
    if (!found.result) throw new Error(found.summary);
    const r = found.result;
    process.stdout.write(`[mother-rust-grid] ${JSON.stringify(r.initial)}\n`);
    process.stdout.write(
      `[mother-rust-content] ${JSON.stringify({ event: node.event, route: r.built.length.route, playerBike: profile.bikes.current, pace: r.built.config.event.paceMps, gapScale: r.built.level?.signatureGapScale })}\n`,
    );
    expect(r.act - r.tell).toBe(48);
    expect(r.open - r.act).toBeGreaterThan(0);
    expect(r.open - r.act).toBeLessThanOrEqual(36);
    expect(r.ended - r.open).toBe(90);
    expect(r.attacks).toBe(0);
    expect(r.hash).toBe(r.replayHash);
  });
});
