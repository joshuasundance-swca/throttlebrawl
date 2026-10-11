import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { quantizeInput, type SimConfig } from '../../src/sim/api';
import { COP_CHASING, COP_DONE, COP_PARKED, copsState, copsSystem } from '../../src/sim/cops';
import { createSimWithWorld } from '../../src/sim/create';
import { pursuitTargetOf } from '../../src/sim/cops/pursuit';
import { addMover, createWorld, worldHash } from '../../src/sim/world';
import { firstSeed, ISOLATED, seedRange } from './batch';

function race(seed: number) {
  const { config: resolved, playerId } = createHeadlessRace({
    seed,
    tuning: {
      ...ISOLATED,
      'cops.spawnChance': 1,
      'cops.spawnDelayS': 5,
      'cops.sirenLeadS': 2,
      'ai.aggressionScale': 0,
    },
  });
  const config: SimConfig = {
    ...resolved,
    event: {
      ...resolved.event,
      cops: { mode: 'every-race', baseCount: 1, tierScale: 0, chaosSummon: false, randomness: 0 },
    },
    riders: resolved.riders.map((rider) => {
      if (rider.controller.kind !== 'cop') return rider;
      const { startingWeapon: _weapon, ...unarmed } = rider;
      return unarmed;
    }),
  };
  const { sim, world } = createSimWithWorld(config);
  const copId = copsState(world).cops[0];
  if (copId === undefined) throw new Error('the shipped race must field a cop');
  const input = quantizeInput({ steer: 0, throttle: 0.6, brake: 0, flags: 0 });
  return { sim, world, config, playerId, copId, input };
}

function chasingRace(seed: number) {
  const run = race(seed);
  let lead = false;
  while (run.sim.tick < 10 * 60 && !run.sim.isOver()) {
    run.sim.step([run.input]);
    const st = copsState(run.world);
    const cop = run.sim.snapshot().entities[run.copId];
    if (st.phase[run.copId] === COP_PARKED && st.sirenOn[run.copId] === 1) {
      expect(cop?.speed).toBe(0);
      expect(cop?.pursuitTargetId).toBe(-1);
      lead = true;
    }
    if (st.phase[run.copId] === COP_CHASING && (cop?.speed ?? 0) > 0) break;
  }
  return { ...run, lead };
}

describe('police pursuit is separate from the combat snapshot target', () => {
  it('observes an idle unarmed cop pursuing the player before finish, after a parked siren lead', () => {
    const found = firstSeed(
      'idle unarmed police pursuit',
      seedRange(1, 8),
      chasingRace,
      ({ world, copId, playerId }) =>
        copsState(world).phase[copId] === COP_CHASING && copsState(world).target[copId] === playerId,
    );
    expect(found.result).not.toBeNull();
    if (!found.result) throw new Error(found.summary);
    const { sim, copId, playerId, lead } = found.result;
    const snap = sim.snapshot();
    expect(lead).toBe(true);
    expect(snap.entities[playerId]?.finished).toBe(false);
    expect(snap.entities[playerId]?.distanceToFinish).toBeGreaterThan(0);
    expect(snap.entities[copId]).toMatchObject({
      heldWeapon: null,
      attackPhase: 'idle',
      targetId: -1,
      pursuitTargetId: playerId,
    });
    for (const entity of snap.entities.filter((e) => e.faction !== 'law'))
      expect(entity.pursuitTargetId).toBe(-1);
  });

  it('reports no pursuit for parked or ended phases, missing targets, finished targets or busted targets', () => {
    const run = race(1);
    const st = copsState(run.world);
    st.target[run.copId] = run.playerId;
    for (const phase of [COP_PARKED, COP_DONE]) {
      st.phase[run.copId] = phase;
      expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
    }
    st.phase[run.copId] = COP_CHASING;
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(run.playerId);
    st.target[run.copId] = -1;
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
    st.target[run.copId] = run.world.movers.length;
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
    const vehicle = addMover(run.world, 'vehicle', { ...run.world.movers[run.playerId]!.pos });
    st.target[run.copId] = vehicle.id;
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
    st.target[run.copId] = run.playerId;
    st.busted.push(run.playerId);
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
    st.busted.length = 0;
    const player = run.world.movers[run.playerId];
    if (!player) throw new Error('missing player');
    player.pos = { ...run.config.route.finish, dir: run.config.route.start.dir, d: 0 };
    expect(run.config.route.distanceToFinish(player.pos.edge, player.pos.s)).toBeLessThanOrEqual(0);
    expect(run.sim.snapshot().entities[run.copId]?.pursuitTargetId).toBe(-1);
  });

  it('reports the actual NPC chaos target, which is not a player pursuit', () => {
    const run = race(1);
    const cop = run.world.movers[run.copId];
    const npc = run.world.movers.find((m) => run.config.riders[m.riderIndex]?.controller.kind === 'ai');
    if (!cop || !npc) throw new Error('missing cop or rival');
    copsState(run.world).phase[run.copId] = COP_CHASING;
    npc.pos = { ...cop.pos };
    run.world.events = [{ tick: run.world.tick, type: 'hit', actor: npc.id, target: run.playerId, data: {} }];
    copsSystem.step(run.world, run.config);
    expect(copsState(run.world).target[run.copId]).toBe(npc.id);
    const snapshot = run.sim.snapshot().entities[run.copId];
    expect(snapshot?.pursuitTargetId).toBe(npc.id);
    expect(snapshot?.pursuitTargetId).not.toBe(run.playerId);
    expect(snapshot?.targetId).toBe(-1);
    // Even a stale pursuit entry on a non-law rider cannot turn him into a pursuing cop.
    copsState(run.world).phase[npc.id] = COP_CHASING;
    copsState(run.world).target[npc.id] = run.playerId;
    expect(run.sim.snapshot().entities[npc.id]?.pursuitTargetId).toBe(-1);
  });

  it('retains pursuit intent while a cop is down and will remount, without inventing a combat target', () => {
    const run = race(1);
    const st = copsState(run.world);
    st.phase[run.copId] = COP_CHASING;
    st.target[run.copId] = run.playerId;
    const cop = run.world.movers[run.copId];
    if (!cop) throw new Error('missing cop');
    for (const mode of ['Tumble', 'OnFoot'] as const) {
      cop.mode = mode;
      expect(run.sim.snapshot().entities[run.copId]).toMatchObject({
        mode,
        attackPhase: 'idle',
        targetId: -1,
        pursuitTargetId: run.playerId,
      });
    }
  });

  it('repeated snapshot reads preserve state, randomness and deterministic same-seed stepping', () => {
    const a = race(1);
    const b = race(1);
    let chasing = false;
    for (let tick = 0; tick < 6 * 60; tick++) {
      a.sim.step([a.input]);
      b.sim.step([b.input]);
      const hash = a.sim.hash();
      const first = a.sim.snapshot();
      expect(a.sim.snapshot()).toEqual(first);
      expect(a.sim.hash()).toBe(hash);
      expect(b.sim.hash()).toBe(hash);
      expect(b.sim.snapshot()).toEqual(first);
      if (copsState(a.world).phase[a.copId] === COP_CHASING) {
        chasing = true;
        expect(first.entities[a.copId]?.pursuitTargetId).toBe(a.playerId);
      }
    }
    expect(chasing).toBe(true);
  });

  it('the pursuit view does not initialize missing cops state', () => {
    const { config } = race(1);
    const world = createWorld(config);
    const hash = worldHash(world);
    expect(pursuitTargetOf(world, config, 0)).toBe(-1);
    expect(world.systems).toEqual({});
    expect(worldHash(world)).toBe(hash);
  });
});
