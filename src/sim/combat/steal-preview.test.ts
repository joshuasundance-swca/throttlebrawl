// docs/milestones/steal-cue.md: next-press selection, without changing the steal rule.
import { describe, expect, it } from 'vitest';
import { createSimWithWorld } from '../create';
import { riderState } from '../riders';
import type { EntitySnapshot, SimInput } from '../types';
import { worldHash } from '../world';
import * as combat from './index';
import { F, flags, harnessConfig, makeHarness, PIPE, PUNCH, type Harness } from './harness.test-util';

const preview = (h: Harness, id = 1) => combat.stealPreview(h.world, h.config, id);
const stolen = (h: Harness) =>
  h.events.filter((e) => e.type === 'weaponGrab' && e.data['source'] === 'steal');

/** Stop after a real wind-up tick, before the thief's next press; all positions are stationary. */
function scene(age = 10, side = 1, scale = 1, thiefFlags: number = F.attack, holderFlags: number = F.attack) {
  let press = false;
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'rival', startingWeapon: PIPE.contentId },
      { s: 100, d: side * 1.2, role: 'player' },
    ],
    (tick, id) =>
      id === 0 && tick === 0 ? flags(holderFlags) : id === 1 && press ? flags(thiefFlags) : undefined,
    {},
    [PIPE],
  );
  h.world.timeScale = scale;
  h.run(1); // the press starts at elapsed 0
  h.run(Math.round(age / scale) - 1);
  return Object.assign(h, {
    press() {
      press = true;
      h.run(1);
    },
  });
}

function expectTransfer(h: ReturnType<typeof scene>, holder = 0) {
  expect(preview(h)).toBe(holder);
  const st = combat.combatState(h.world);
  const pickup = st.heldPickup[holder];
  const cause = st.cause[holder];
  h.press();
  expect(stolen(h)).toHaveLength(1);
  expect(stolen(h)[0]).toMatchObject({ actor: 1, target: holder, causeId: cause });
  expect(st.heldPickup[1]).toBe(pickup);
  expect(st.pickupHolder[pickup ?? -1]).toBe(1);
  expect(combat.combatView(h.world, holder).heldWeapon).toBeNull();
  expect(combat.combatView(h.world, 1).heldWeapon).toBe(PIPE.contentId);
}

describe('steal preview: the next combat pass, before attack advancement', () => {
  for (const scale of [1, 0.5]) {
    for (const side of [-1, 1]) {
      it(`both inclusive endpoints agree with a press, side ${side}, scale ${scale}`, () => {
        for (const age of [PIPE.steal!.startTick, PIPE.steal!.endTick]) {
          const h = scene(age, side, scale);
          expect(combat.combatState(h.world).elapsed[0]).toBeCloseTo(age - scale);
          expectTransfer(h);
          expect(stolen(h)[0]?.data['windupTick']).toBe(age);
        }
      });
    }
    it(`one scaled tick outside either endpoint is absent, scale ${scale}`, () => {
      const away = F.attack | F.attackSideLeft;
      expectTransfer(scene(PIPE.steal!.startTick, 1, scale, F.attack, away));
      for (const age of [PIPE.steal!.startTick - scale, PIPE.steal!.endTick + scale]) {
        // Swing away from the thief so the late negative is not confounded by a prior stagger.
        const h = scene(age, 1, scale, F.attack, away);
        expect(preview(h)).toBe(-1);
        h.press();
        expect(stolen(h)).toHaveLength(0);
        expect(h.events.some((e) => e.type === 'attackStart' && e.actor === 1)).toBe(true);
      }
    });
  }

  it('kick and opposite-side intent still steal the selected holder', () => {
    expectTransfer(scene(10, 1, 1, F.attack | F.kick | F.attackSideLeft));
    expectTransfer(scene(10, -1, 1, F.attack | F.attackSideRight));
  });

  it('a late press after the holder hits waits through stagger instead of promising an ordinary start', () => {
    const h = scene(PIPE.steal!.endTick + 1);
    expect(h.events.some((e) => e.type === 'hit' && e.actor === 0 && e.target === 1)).toBe(true);
    expect(combat.combatState(h.world).stagger[1]).toBeGreaterThan(0);
    expect(preview(h)).toBe(-1);
    h.press();
    expect(stolen(h)).toHaveLength(0);
    expect(h.events.some((e) => e.type === 'attackStart' && e.actor === 1)).toBe(false);
    expect(combat.combatState(h.world).pending[1]).toBe(true);
  });

  it('stagger ending in the pre-pass decrement is ready; stagger left after it is not', () => {
    for (const scale of [1, 0.5, 0]) {
      for (const left of [0, 0.01]) {
        const h = scene();
        h.world.timeScale = scale;
        combat.combatState(h.world).stagger[1] = scale + left;
        expect(preview(h)).toBe(left === 0 ? 0 : -1);
        h.press();
        expect(stolen(h)).toHaveLength(left === 0 ? 1 : 0);
      }
    }
  });

  it('uses frozen time, then the restored scale at the actual hit-stop exit', () => {
    expectTransfer(scene(PIPE.steal!.startTick, 1, 0.5));
    const h = scene(PIPE.steal!.startTick, 1, 0.5);
    const st = combat.combatState(h.world);
    st.hitStopTicks = 2;
    st.resumeTimeScale = 0.5;
    h.world.timeScale = 0;
    expect(preview(h)).toBe(-1); // elapsed is 6.5, frozen pass never reaches 7
    h.run(1);
    expect(h.world.timeScale).toBe(0);
    expect(preview(h)).toBe(-1);
    h.run(1);
    expect(st.hitStopTicks).toBe(0);
    expect(h.world.timeScale).toBe(0.5);
    expectTransfer(h);
  });
});

describe('steal preview: changed preconditions have positive transfer controls', () => {
  const negatives: [string, (h: ReturnType<typeof scene>) => void][] = [
    [
      'longitudinal reach',
      (h) => {
        h.world.movers[1]!.pos.s += PIPE.reachSM + 0.01;
      },
    ],
    [
      'lateral reach',
      (h) => {
        h.world.movers[1]!.pos.d = PIPE.reachDM + 0.01;
      },
    ],
    [
      'height reach',
      (h) => {
        h.world.movers[1]!.h = (h.world.params['combat.reachHeightM'] ?? 1) + 0.01;
      },
    ],
    [
      'thief down',
      (h) => {
        h.world.movers[1]!.mode = 'OnFoot';
      },
    ],
    [
      'thief unconscious',
      (h) => {
        riderState(h.world).health[1] = 0;
      },
    ],
    [
      'law thief',
      (h) => {
        h.config.riders[1]!.faction = 'law';
      },
    ],
    [
      'holder no longer riding',
      (h) => {
        h.world.movers[0]!.mode = 'Tumble';
      },
    ],
    [
      'holder kick with weapon held',
      (h) => {
        combat.combatState(h.world).weapon[0] = 'base:kick';
      },
    ],
    [
      'holder interrupted',
      (h) => {
        combat.combatState(h.world).phase[0] = 'idle';
      },
    ],
    [
      'held attack edge',
      (h) => {
        combat.combatState(h.world).prevFlags[1] = F.attack;
      },
    ],
  ];
  for (const [name, change] of negatives) {
    it(name, () => {
      expectTransfer(scene());
      const h = scene();
      expect(preview(h)).toBe(0);
      change(h);
      expect(preview(h)).toBe(-1);
      h.press();
      expect(stolen(h)).toHaveLength(0);
    });
  }

  for (const phase of ['windup', 'active', 'recovery'] as const) {
    it(`a thief in ${phase} cannot steal even when recovery ends this tick`, () => {
      expectTransfer(scene());
      const h = scene();
      const st = combat.combatState(h.world);
      st.phase[1] = phase;
      st.weapon[1] = PUNCH.contentId;
      st.elapsed[1] = phase === 'recovery' ? PUNCH.recoveryTicks - 1 : 0;
      expect(preview(h)).toBe(-1);
      h.press();
      expect(stolen(h)).toHaveLength(0);
      if (phase === 'recovery') {
        expect(h.events.some((e) => e.type === 'attackStart' && e.actor === 1)).toBe(true);
      }
    });
  }

  it('a real kick conversion removes the candidate', () => {
    expectTransfer(scene());
    let kick = false;
    const h = makeHarness(
      [
        { s: 100, d: 0, startingWeapon: PIPE.contentId },
        { s: 100, d: 1.2, role: 'player' },
      ],
      (tick, id) =>
        id === 0 ? (tick === 0 ? flags(F.attack) : kick ? flags(F.kick) : undefined) : undefined,
      {},
      [PIPE],
    );
    h.run(10);
    expect(preview(h)).toBe(0);
    kick = true;
    h.run(1);
    expect(combat.combatState(h.world).weapon[0]).toBe('base:kick');
    expect(preview(h)).toBe(-1);
  });

  it('release restores the fresh-edge preview without inventing a queued steal', () => {
    const h = scene();
    expectTransfer(scene());
    combat.combatState(h.world).prevFlags[1] = F.attack;
    expect(preview(h)).toBe(-1);
    h.run(1); // neutral input releases the held edge
    expectTransfer(h);
  });
});

describe('steal preview: holder selection and pure snapshots', () => {
  it('prefers a holder targeting the thief, then nearest, then existing iteration order', () => {
    for (const [targets, d, expected] of [
      [[1, -1], 0.6, 0],
      [[-1, -1], 0.6, 2],
      [[1, 1], 0.6, 2],
      [[-1, -1], 2.4, 0], // exact tie: original holder was visited first
    ] as const) {
      let press = false;
      const h = makeHarness(
        [
          { s: 100, d: 0, startingWeapon: PIPE.contentId },
          { s: 100, d: 1.2, role: 'player' },
          { s: 100, d, startingWeapon: PIPE.contentId },
        ],
        (tick, id) =>
          id !== 1 && tick === 0 ? flags(F.attack) : id === 1 && press ? flags(F.attack) : undefined,
        {},
        [PIPE],
      );
      h.run(10);
      const st = combat.combatState(h.world);
      st.targetId[0] = targets[0];
      st.targetId[2] = targets[1];
      const pickup = st.heldPickup[expected];
      expect(preview(h)).toBe(expected);
      press = true;
      h.run(1);
      expect(stolen(h)).toHaveLength(1);
      expect(stolen(h)[0]).toMatchObject({ actor: 1, target: expected });
      expect(st.heldPickup[1]).toBe(pickup);
    }
  });

  function realScene() {
    const config = harnessConfig(
      [
        { s: 300, d: 0, role: 'player' },
        { s: 300, d: 1.2, role: 'rival', startingWeapon: PIPE.contentId },
      ],
      {},
      [PIPE],
    );
    // Both riders are driven explicitly; role alone does not publish a player's preview.
    config.riders[1]!.controller = { kind: 'player', slot: 1 };
    config.playerSlots = 2;
    const out = createSimWithWorld(config);
    Object.assign(out.world.movers[0]!.pos, { s: 300, d: 0 });
    Object.assign(out.world.movers[1]!.pos, { s: 300, d: 1.2 });
    out.sim.step([flags(0), flags(F.attack)]);
    for (let i = 1; i < PIPE.steal!.startTick; i++) out.sim.step([flags(0), flags(0)]);
    return out;
  }

  it('repeated snapshots and queries preserve state, hashes, and later events', () => {
    const observed = realScene();
    const control = realScene();
    const before = structuredClone(combat.combatState(observed.world));
    const events = structuredClone(observed.sim.events());
    const hash = observed.sim.hash();
    const snap = observed.sim.snapshot();
    expect(snap.entities[0]?.stealId).toBe(1);
    const nonRiders = snap.entities.filter((e) => e.kind !== 'rider');
    expect(nonRiders.length).toBeGreaterThan(0);
    expect(nonRiders.every((e) => e.stealId === -1)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(observed.sim.snapshot()).toEqual(snap);
      expect(combat.stealPreview(observed.world, observed.sim.config, 0)).toBe(1);
      expect(observed.sim.hash()).toBe(hash);
    }
    expect(combat.combatState(observed.world)).toEqual(before);
    expect(observed.sim.events()).toEqual(events);
    const inputs: SimInput[] = [flags(F.attack), flags(0)];
    observed.sim.step(inputs);
    control.sim.step(inputs);
    expect(observed.sim.events().some((e) => e.type === 'weaponGrab' && e.data['source'] === 'steal')).toBe(
      true,
    );
    expect(observed.sim.events()).toEqual(control.sim.events());
    expect(observed.sim.hash()).toBe(control.sim.hash());
    expect(worldHash(observed.world)).toBe(observed.sim.hash());
  });

  it('non-player riders and other entity kinds are neutral; older snapshots may omit the field', () => {
    const { sim, world } = realScene();
    sim.config.riders[0]!.controller = { kind: 'ai', style: 'racer' };
    expect(sim.snapshot().entities[0]?.stealId).toBe(-1);
    world.movers[0]!.mode = 'OnFoot';
    expect(combat.stealPreview(world, sim.config, 0)).toBe(-1);
    const current = sim.snapshot().entities[0]!;
    const { stealId: _unused, ...old } = current;
    const compatible: EntitySnapshot = old;
    expect(compatible.stealId).toBeUndefined();
  });
});
