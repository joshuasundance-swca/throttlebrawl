/// <reference types="vite/client" />
// Old Growth encounter, Automated acceptance 1–3. The career builds the authored boss grid on
// its effective ladder bike; a deterministic approach and late dodge use only public snapshots.
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, startCareer } from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import { createSim, quantizeInput, type EntitySnapshot, type SimInput } from '../../src/sim/api';
import { firstSeed, ISOLATED, seedRange } from './batch';
import { careerRace, onTierBike, REG, tierBike } from './career-harness';

const DEFS = careerDefs(REG);
const pnw = DEFS.find((d) =>
  d.nodes.some((n) => n.id === d.boss && eventPlan(REG, n.event).rules.rule === 'timber'),
);
if (!pnw) throw new Error('the shipped career must have a Timber boss');
const boss = pnw.nodes.find((n) => n.id === pnw.boss);
if (!boss) throw new Error('the Timber career must retain its boss node');
const def = pnw;
const node = boss;
const profile = onTierBike(REG, def, node, startCareer(DEFS, { ...DEFAULT_PROFILE }));
const LIMIT = 1800;

function run(seed: number) {
  const built = careerRace(def, node, profile, seed, { tuning: ISOLATED });
  const { config, plan } = built;
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const rivalId = config.riders.findIndex((r) => r.contentId === plan.rules.rival);
  const inputs: SimInput[] = [];
  const phases: {
    phase: string;
    tick: number;
    target: number;
    d: number;
    gap: number;
    speed: number;
    left: number;
    mode: string;
    playerMode: string;
  }[] = [];
  let committedD = 0;
  let dodging = false;
  let actedOnPlayer = false;
  let openedByDodge = false;
  let firstTell = -1;
  let lastPhase = '';
  let actTick = -1;
  let openTick = -1;
  let drift = 0;
  let dEscape = 0;
  let openAttackTicks = 0;
  let dodgeOffRoadTicks = 0;
  let input: SimInput;
  while (sim.tick < LIMIT && !sim.isOver()) {
    const snap = sim.snapshot();
    const me = snap.entities[playerId] as EntitySnapshot;
    const og = snap.entities[rivalId] as EntitySnapshot;
    const phase = og.signature?.phase ?? '';
    if (phase !== lastPhase) {
      phases.push({
        phase,
        tick: sim.tick,
        target: og.signature?.targetId ?? -1,
        d: og.road.d,
        gap: me.progress - og.progress,
        speed: og.speed,
        left: og.signature?.left ?? 0,
        mode: og.mode,
        playerMode: me.mode,
      });
      if (phase === 'tell' && firstTell < 0) firstTell = sim.tick;
      if (phase === 'act' && og.signature?.targetId === playerId) {
        actedOnPlayer = true;
        dodging = true;
        actTick = sim.tick;
        committedD = me.road.d;
      }
      if (phase === 'open' && lastPhase === 'act' && dodging) {
        openTick = sim.tick;
        openedByDodge =
          me.mode === 'Road' &&
          og.mode === 'Road' &&
          me.road.edge === og.road.edge &&
          Math.abs(me.road.d - og.road.d) > 2.5 &&
          me.progress - og.progress > 1.2;
        dEscape = Math.abs(me.road.d - og.road.d);
      }
      lastPhase = phase;
    }
    if (dodging && phase === 'act') drift = Math.max(drift, Math.abs(og.road.d - committedD));
    if (dodging && (phase === 'act' || phase === 'open') && me.mode !== 'Road') dodgeOffRoadTicks++;
    if (phase === 'open' && dodging && og.attackPhase !== 'idle') openAttackTicks++;
    if (openTick >= 0 && phase === '') break;
    const edge = config.road.edges[me.road.edge];
    const line = dodging
      ? Math.max((edge?.dMin ?? -4) + 0.8, Math.min((edge?.dMax ?? 4) - 0.8, committedD - 3.5))
      : og.road.d;
    const kappa = config.road.kappaAt(me.road.edge, me.road.s) * me.road.dir;
    const want = Math.max(10, og.speed + (20 - (me.progress - og.progress)) * 1.2);
    input = quantizeInput({
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
  }
  const hash = sim.hash();
  const replay = createSim(config);
  for (const input of inputs) replay.step([input]);
  return {
    built,
    playerId,
    rivalId,
    firstTell,
    actTick,
    openTick,
    actedOnPlayer,
    openedByDodge,
    drift,
    dEscape,
    openAttackTicks,
    dodgeOffRoadTicks,
    phases,
    ticks: sim.tick,
    hash,
    replayHash: replay.hash(),
  };
}

describe('the authored Timber career encounter', () => {
  it('retains the named rule, route and effective career ladder bike', () => {
    const { config, plan, length, level } = careerRace(def, node, profile, 1, { tuning: ISOLATED });
    expect(plan.rules.rule).toBe('timber');
    expect(config.event.grudgeRule).toEqual({ rule: plan.rules.rule, rival: plan.rules.rival });
    expect(config.riders.find((r) => r.contentId === plan.rules.rival)?.controller).toMatchObject({
      kind: 'ai',
      personality: { signature: 'timber' },
    });
    expect(length.route).toBe(plan.lengths.find((l) => l.id === length.id)?.route);
    expect(config.route.routeId).toBe(length.route.split(':').at(-1));
    expect(config.riders.find((r) => r.controller.kind === 'player')?.bike.contentId).toBe(
      tierBike(def, node)?.key,
    );
    expect(config.event.paceMps).toBe(level?.paceMps);
    expect(config.event.level?.signatureGapScale).toBe(level?.signatureGapScale);
  });

  it('approaches naturally, shows a charge and defeats it with a late physical sidestep', () => {
    const found = firstSeed(
      'authored Timber late dodge',
      seedRange(1, 8),
      run,
      (r) => r.firstTell < 600 && r.actedOnPlayer && r.openedByDodge,
    );
    expect(found.result, found.summary).not.toBeNull();
    if (!found.result) throw new Error(found.summary);
    const r = found.result;
    process.stdout.write(
      `[old-growth-search] ${JSON.stringify(
        found.tried.map(({ seed, result }) => ({
          seed,
          ticks: result.ticks,
          firstTell: result.firstTell,
          actedOnPlayer: result.actedOnPlayer,
          openedByDodge: result.openedByDodge,
        })),
      )}; stepped ${found.tried.reduce((sum, { result }) => sum + result.ticks, 0)} ticks plus their replays\n`,
    );
    process.stdout.write(
      `[old-growth] event ${node.event}; route ${r.built.length.route}; player bike ${profile.bikes.current}; ` +
        `pace ${r.built.config.event.paceMps}; gap scale ${r.built.level?.signatureGapScale}; limit ${LIMIT}; ` +
        `seed ${found.seed}; ticks ${r.ticks}; phases ${JSON.stringify(r.phases)}; line drift ${r.drift}; escape ${r.dEscape}; ` +
        `open attack ticks ${r.openAttackTicks}; dodge off-road ticks ${r.dodgeOffRoadTicks}; hashes ${r.hash}/${r.replayHash}\n`,
    );
    expect(r.firstTell).toBeGreaterThanOrEqual(240);
    expect(r.actTick).toBeGreaterThan(r.firstTell);
    expect(r.actTick - r.firstTell).toBe(48);
    expect(r.openTick - r.actTick).toBeGreaterThan(0);
    expect(r.openTick - r.actTick).toBeLessThan(90);
    expect(r.drift).toBeLessThan(1);
    expect(r.dEscape).toBeGreaterThan(2.5);
    expect(r.openAttackTicks).toBe(0);
    expect(r.dodgeOffRoadTicks).toBe(0);
    expect(r.ticks - r.openTick).toBe(90);
    const recoveryStart = r.phases.find((p) => p.phase === 'open' && p.tick === r.openTick)?.speed;
    expect(recoveryStart).toBeDefined();
    expect(r.phases.at(-1)?.speed ?? Infinity).toBeLessThan(recoveryStart ?? -1);
    expect(r.hash).toBe(r.replayHash);
  });
});
