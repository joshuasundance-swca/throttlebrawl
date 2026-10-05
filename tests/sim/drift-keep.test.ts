// Playtest 4 (the maintainer, 2026-10-05: "it's too easy to lose a drift. I think crashing should
// lose it but maybe not just wobbling or bumping"): ONLY a crash loses a drift chain and its unbanked
// cash. A wobble, a bump or side contact with traffic, a rival, a wall or a prop, and a hit that only
// staggers the rider keep it. A knock still ends the slide itself (the slide's physics are as they
// were); the chain stays open for the next drift inside the normal chain window.
//
// src/sim/riders/drift.test.ts pins the rule on injected events. This file ties it to the real
// causes, in the real systems, by sim ticks: the riders phase with the tumble (a wall touch that is
// a wobble or a crash; a rival's bump), plus traffic (a car's side brush) and combat (a punch that
// staggers). One scripted rider, a drift on a straight (it starts anywhere, P4-8): brake and bars
// held from the start, so the slide swings right and meets the wall ~1.1 s in. Each case says what
// it examined, and the checks that say "kept" run beside the one that says "lost".
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../src/core';
import { COMBAT_TUNING, combatSystem } from '../../src/sim/combat';
import { PUNCH } from '../../src/sim/combat/harness.test-util';
import { riderState, ridersSystem } from '../../src/sim/riders';
import { driftMoves } from '../../src/sim/riders/drift';
import { input, testConfig } from '../../src/sim/riders/testing';
import { placeVehicle, trafficState, trafficSystem } from '../../src/sim/traffic';
import { toCorridor } from '../../src/sim/traffic/corridor';
import { tumbleSystem } from '../../src/sim/tumble';
import { chainLossShown, createDriftMeter, driftOutcome } from '../../src/ui/moves-meter';
import type { SimConfig, SimEvent, SimTrafficTypeDef } from '../../src/sim/types';
import { InputFlag } from '../../src/sim/types';
import {
  addMover,
  createWorld,
  stepWorld,
  worldHash,
  type Mover,
  type SimSystem,
  type World,
} from '../../src/sim/world';

const CAR: SimTrafficTypeDef = {
  contentId: 'base:car',
  category: 'car',
  lengthM: 4.6,
  widthM: 1.8,
  cruiseMps: 24.6,
  hazard: 'normal',
};
const STRAIGHT = [{ id: 'a', lengthM: 3000, kappa: 0 }];
const STYLE = {
  perNearMissCash: 0,
  perAirtimeCash: 0,
  perOncomingSecondCash: 0,
  perTakedownCash: 0,
  takedownComboScale: 0,
  perStealCash: 0,
  perDriftSecondCash: 30,
};
/** The chain window, ticks (`riders.driftChainS`, 4 s). */
const WINDOW_TICKS = 240;
/** The tick the rival or the car arrives; the wall comes ~46 ticks later. */
const INCIDENT_TICK = 30;

interface Ctx {
  world: World;
  config: SimConfig;
  /** The tick about to be stepped, from 0. */
  t: number;
  player: Mover;
  rival: Mover | undefined;
}

interface Spec {
  systems: SimSystem[];
  tuning?: Record<string, number>;
  rival?: boolean;
  /** Called before each tick's step: places the rival or the car, sets the rival's input. */
  incident?: (c: Ctx) => void;
  ticks?: number;
}

interface Played {
  world: World;
  player: Mover;
  events: SimEvent[];
  /** After each tick: the mode, the HUD's drift numbers and the world hash. */
  track: { mode: string; moves: ReturnType<typeof driftMoves>; hash: number }[];
}

const NOTHING = { driftS: 0, driftChain: 0, driftCash: 0, driftSide: 0 };

/** Rides the scripted drift for `ticks`, the incident called each tick. */
function play(spec: Spec): Played {
  const base = testConfig({
    edges: STRAIGHT,
    tuning: { ...tuningDefaults(COMBAT_TUNING), ...(spec.tuning ?? {}) },
    rivals: spec.rival ? 1 : 0,
  });
  const config: SimConfig = {
    ...base,
    trafficTypes: [CAR],
    weapons: [PUNCH],
    event: { ...base.event, style: STYLE },
  };
  const world = createWorld(config);
  const rival = spec.rival ? addMover(world, 'rider', { edge: 0, s: 400, d: 0, dir: 1 }, 0) : undefined;
  const player = addMover(world, 'rider', { edge: 0, s: 100, d: -2, dir: 1 }, spec.rival ? 1 : 0);
  player.speed = 36;
  for (const s of spec.systems) s.init(world, config);
  const events: SimEvent[] = [];
  const track: Played['track'] = [];
  for (let t = 0; t < (spec.ticks ?? 420); t++) {
    spec.incident?.({ world, config, t, player, rival });
    events.push(...stepWorld(world, config, spec.systems, [input(0, 1, 0.8)]));
    track.push({ mode: player.mode, moves: driftMoves(world, player.id), hash: worldHash(world) });
  }
  return { world, player, events, track };
}

const ofType = (events: readonly SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type);
const slideEnds = (events: readonly SimEvent[]) =>
  ofType(events, 'driftEnd').filter((e) => e.data['bank'] !== true);
const banks = (events: readonly SimEvent[]) =>
  ofType(events, 'driftEnd').filter((e) => e.data['bank'] === true);

/** The rider at the wall: a drift on a straight meets it ~1.1 s in at 6.4 m/s into it. */
const WALL: Spec = { systems: [ridersSystem, tumbleSystem] };

/** A rival a little ahead on the inside and slower: the slide rides into him (a bump). */
const RIVAL_BUMP: Spec = {
  systems: [ridersSystem, tumbleSystem],
  rival: true,
  ticks: 300,
  incident: ({ world, t, player, rival }) => {
    if (!rival) return;
    if (t === INCIDENT_TICK) {
      rival.pos.s = player.pos.s + 2;
      rival.pos.d = player.pos.d + 1;
      rival.speed = player.speed - 4;
    }
    if (t >= INCIDENT_TICK) world.inputs[rival.id] = input(0.5);
  },
};

describe('drift keep: the same wall touch, a wobble or a crash', () => {
  // The slide's touch on the wall is 6.4 m/s. The crash speed (`riders.crashImpactMps`, 6 by
  // default) is the only thing that differs: under it the touch crashes, over it, it wobbles.
  const crashed = play({ ...WALL, tuning: { 'riders.crashImpactMps': 4 } });
  const wobbled = play({ ...WALL, tuning: { 'riders.crashImpactMps': 12 } });

  it('a crash: the rider goes down and the chain is empty that tick, stays empty through the run-back and the remount', () => {
    const crash = ofType(crashed.events, 'crash').filter((e) => e.actor === crashed.player.id);
    expect(crash).toHaveLength(1);
    expect(crash[0]?.data['cause']).toBe('barrier');
    const at = crash[0]?.tick ?? -1;
    const before = crashed.track[at]?.moves;
    expect(before?.driftChain, 'a chain was up when he crashed').toBe(1);
    expect(before?.driftCash, 'with cash on it').toBeGreaterThan(0);
    // The tick after the crash he is down (tumbling) and the chain is already gone: not at the remount.
    expect(crashed.track[at + 1]?.mode).toBe('Tumble');
    expect(crashed.track[at + 1]?.moves).toEqual(NOTHING);
    const lost = slideEnds(crashed.events);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.tick).toBe(at + 1);
    expect(Number(lost[0]?.data['lost'])).toBeGreaterThan(0);
    expect(lost[0]?.data['kept']).toBeUndefined();
    // Down, on foot, then back on the bike: the chain never comes back and nothing ever banks.
    const modes = new Set(crashed.track.map((p) => p.mode));
    expect([...modes].sort()).toEqual(['OnFoot', 'Road', 'Tumble']);
    const remount = crashed.track.findIndex((p, i) => i > at && p.mode === 'Road');
    expect(remount).toBeGreaterThan(at + 1);
    expect(
      crashed.track.slice(at + 1).every((p) => p.moves.driftChain === 0 && p.moves.driftCash === 0),
    ).toBe(true);
    expect(banks(crashed.events)).toEqual([]);
    console.log(
      `[examined] crash at tick ${at}: chain ${before?.driftChain} cash ${before?.driftCash} before; ` +
        `tick ${at + 1} ${crashed.track[at + 1]?.mode} chain ${crashed.track[at + 1]?.moves.driftChain}; ` +
        `remount at tick ${remount} (${crashed.track[remount]?.mode}), chain ${crashed.track[remount]?.moves.driftChain}; ` +
        `driftEnd ${JSON.stringify(lost[0]?.data)}`,
    );
  });

  it('a wobble: the slide ends on the wall, the chain stays open with its cash, and it banks when the window lapses', () => {
    const wobble = ofType(wobbled.events, 'wobble').filter(
      (e) => e.actor === wobbled.player.id && e.data['cause'] === 'barrier',
    );
    expect(wobble.length).toBeGreaterThan(0);
    expect(ofType(wobbled.events, 'crash')).toEqual([]);
    const at = wobble[0]?.tick ?? -1;
    const before = wobbled.track[at]?.moves;
    expect(before?.driftChain).toBe(1);
    expect(before?.driftCash).toBeGreaterThan(0);
    const slide = slideEnds(wobbled.events);
    expect(slide).toHaveLength(1);
    // The slide ends within a tick of the wobble, as it always did; its cash is kept, not lost.
    expect(Math.abs((slide[0]?.tick ?? -9) - at)).toBeLessThanOrEqual(1);
    expect(slide[0]?.data['clean']).toBe(false);
    expect(slide[0]?.data['lost']).toBeUndefined();
    const kept = Number(slide[0]?.data['kept']);
    expect(kept).toBeGreaterThan(0);
    const after = wobbled.track[(slide[0]?.tick ?? 0) + 1];
    expect(after?.mode).toBe('Road');
    expect(after?.moves.driftChain).toBe(1);
    expect(after?.moves.driftSide).toBe(0);
    expect(after?.moves.driftCash).toBe(Math.round(kept));
    // Nothing new drifts (the slide left him under the drift's speed floor), so the window lapses and
    // the chain banks what it kept, once, a window after the slide ended.
    const bank = banks(wobbled.events);
    expect(bank).toHaveLength(1);
    expect(bank[0]?.data['chain']).toBe(1);
    expect(Number(bank[0]?.data['points'])).toBeCloseTo(kept, 9);
    expect(bank[0]?.tick).toBeGreaterThanOrEqual((slide[0]?.tick ?? 0) + WINDOW_TICKS - 2);
    expect(bank[0]?.tick).toBeLessThanOrEqual((slide[0]?.tick ?? 0) + WINDOW_TICKS);
    console.log(
      `[examined] wall wobble at tick ${at} (${JSON.stringify(wobble[0]?.data)}): chain ${before?.driftChain} cash ` +
        `${before?.driftCash} before, slide ended at ${slide[0]?.tick} keeping ${kept}, bank at ${bank[0]?.tick} ` +
        `of ${bank[0]?.data['points']}`,
    );
  });
});

describe('drift keep: bumps and a stagger', () => {
  it("a rival bump (the riders phase's contact wobble) ends the slide, keeps the chain, and the next drift is link 2", () => {
    const played = play(RIVAL_BUMP);
    const bump = ofType(played.events, 'wobble').filter(
      (e) => e.actor === played.player.id && e.data['cause'] === 'rider',
    );
    expect(bump).toHaveLength(1);
    expect(ofType(played.events, 'crash').filter((e) => e.actor === played.player.id)).toEqual([]);
    const at = bump[0]?.tick ?? -1;
    const slide = slideEnds(played.events);
    expect(Math.abs((slide[0]?.tick ?? -9) - at)).toBeLessThanOrEqual(1);
    expect(slide[0]?.data['lost']).toBeUndefined();
    const kept = Number(slide[0]?.data['kept']);
    expect(kept).toBeGreaterThan(0);
    expect(played.track[at + 2]?.moves.driftChain).toBe(1);
    expect(played.track[at + 2]?.moves.driftCash).toBe(Math.round(kept));
    // Still braking and on the bars, he drifts again inside the window: link 2 of the same chain.
    const starts = ofType(played.events, 'driftStart');
    expect(starts.map((e) => e.data['chain'])).toEqual([1, 2]);
    expect((starts[1]?.tick ?? 0) - (slide[0]?.tick ?? 0)).toBeLessThan(WINDOW_TICKS);
    // The chain pays out once, with both links' cash: the second slide ended unclean (it ran out of
    // speed), which banks at once, and it carries the first slide's kept cash too.
    const paid = ofType(played.events, 'driftEnd').filter((e) => Number(e.data['points']) > 0);
    expect(paid).toHaveLength(1);
    expect(paid[0]?.data['chain']).toBe(2);
    expect(Number(paid[0]?.data['points'])).toBeGreaterThan(kept);
    console.log(
      `[examined] rival bump at tick ${at}: kept ${kept}; starts ${starts.map((e) => `${e.tick}:chain ${String(e.data['chain'])}`).join(', ')}; ` +
        `driftEnds ${ofType(played.events, 'driftEnd')
          .map((e) => `${e.tick}:${JSON.stringify(e.data)}`)
          .join(' | ')}`,
    );
  });

  it("a car's side brush (traffic's wobble) ends the slide and keeps the chain, which banks when the window lapses", () => {
    const played = play({
      systems: [ridersSystem, trafficSystem, tumbleSystem],
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
      incident: ({ world, config, t, player }) => {
        if (t !== INCIDENT_TICK) return;
        // A car alongside, a metre ahead, at the rider's speed, in the next lane over.
        const here = toCorridor(trafficState(world).corridor, player.pos);
        placeVehicle(world, config, {
          type: 0,
          u: (here?.u ?? 0) + 1,
          dir: 1,
          v0: player.speed,
          speed: player.speed,
        });
      },
    });
    const brush = ofType(played.events, 'wobble').filter(
      (e) => e.actor === played.player.id && e.data['cause'] === 'traffic',
    );
    expect(brush).toHaveLength(1);
    expect(brush[0]?.data['hit']).toBe('side');
    expect(ofType(played.events, 'crash')).toEqual([]);
    const at = brush[0]?.tick ?? -1;
    const slide = slideEnds(played.events);
    expect(Math.abs((slide[0]?.tick ?? -9) - at)).toBeLessThanOrEqual(1);
    expect(slide[0]?.data['lost']).toBeUndefined();
    const kept = Number(slide[0]?.data['kept']);
    expect(kept).toBeGreaterThan(0);
    expect(played.track[at + 2]?.moves.driftChain).toBe(1);
    expect(played.track[at + 2]?.moves.driftCash).toBe(Math.round(kept));
    const bank = banks(played.events);
    expect(bank).toHaveLength(1);
    expect(Number(bank[0]?.data['points'])).toBeCloseTo(kept, 9);
    console.log(
      `[examined] traffic brush at tick ${at} (${JSON.stringify(brush[0]?.data)}): kept ${kept}, banked ` +
        `${bank[0]?.data['points']} at tick ${bank[0]?.tick}`,
    );
  });

  it("a punch that staggers (combat's hit) ends the slide and keeps the chain", () => {
    const played = play({
      systems: [ridersSystem, combatSystem, tumbleSystem],
      rival: true,
      ticks: 200,
      incident: ({ world, t, player, rival }) => {
        if (!rival) return;
        if (t === INCIDENT_TICK) {
          // Alongside on his right, out of bumping range, and swinging at him.
          rival.pos.s = player.pos.s;
          rival.pos.d = player.pos.d + 1.6;
          rival.speed = player.speed;
        }
        if (t >= INCIDENT_TICK)
          world.inputs[rival.id] = {
            steer: 0,
            throttle: 120,
            brake: 0,
            flags: InputFlag.attack | InputFlag.attackSideLeft,
          };
      },
    });
    const hits = ofType(played.events, 'hit').filter((e) => e.target === played.player.id);
    expect(hits).toHaveLength(1);
    // The hit is the only thing that knocked him: no bump, no wall, no crash before the slide ended.
    const at = hits[0]?.tick ?? -1;
    const slide = slideEnds(played.events);
    expect(slide[0]?.tick).toBeGreaterThanOrEqual(at);
    expect(slide[0]?.tick).toBeLessThanOrEqual(at + 2);
    const knocks = played.events.filter(
      (e) =>
        e.actor === played.player.id &&
        (e.type === 'wobble' || e.type === 'crash') &&
        e.tick <= (slide[0]?.tick ?? 0),
    );
    expect(knocks.map((e) => e.type)).toEqual([]);
    expect(slide[0]?.data['lost']).toBeUndefined();
    const kept = Number(slide[0]?.data['kept']);
    expect(kept).toBeGreaterThan(0);
    const after = played.track[(slide[0]?.tick ?? 0) + 1];
    expect(after?.moves.driftSide).toBe(0);
    expect(after?.moves.driftChain).toBe(1);
    expect(after?.moves.driftCash).toBeGreaterThanOrEqual(Math.round(kept));
    console.log(
      `[examined] punch hit at tick ${at} (${JSON.stringify(hits[0]?.data).slice(0, 120)}): slide ended at ` +
        `${slide[0]?.tick} keeping ${kept}; chain after ${after?.moves.driftChain}, cash ${after?.moves.driftCash}`,
    );
  });
});

describe('drift keep: the ticker says DRIFT LOST only on a crash', () => {
  /** What the strip decides each tick of a played ride, from the sim's own numbers. */
  function strip(p: Played): { lost: number[]; banked: number[] } {
    const meter = createDriftMeter();
    const lost: number[] = [];
    const banked: number[] = [];
    p.track.forEach((point, t) => {
      const paid = p.events.some(
        (e) => e.tick === t && e.type === 'driftEnd' && Number(e.data['points']) > 0,
      );
      const step = meter.update({ wheelieS: 0, wheelieBand: null, ...point.moves });
      const outcome = driftOutcome(
        step,
        paid ? [{ kind: 'drift' }] : [],
        chainLossShown({ mode: point.mode }),
      );
      if (outcome === 'lost') lost.push(t);
      if (outcome === 'banked') banked.push(t);
    });
    return { lost, banked };
  }

  it('a crash shows it once, as he goes down; a wall wobble, a bump, a brush and a punch never do', () => {
    const down = play({ ...WALL, tuning: { 'riders.crashImpactMps': 4 } });
    const crashAt = ofType(down.events, 'crash')[0]?.tick ?? -1;
    expect(crashAt).toBeGreaterThan(0);
    const crash = strip(down);
    expect(crash.lost).toEqual([crashAt + 1]);
    expect(crash.banked).toEqual([]);
    const wobble = strip(play({ ...WALL, tuning: { 'riders.crashImpactMps': 12 } }));
    expect(wobble.lost).toEqual([]);
    expect(wobble.banked).toHaveLength(1); // the kept chain banks its cash in the end
    const bump = strip(play(RIVAL_BUMP));
    expect(bump.lost).toEqual([]);
    expect(bump.banked).toHaveLength(1);
    console.log(
      `[examined] the strip: crash at ${crashAt}, lost at ${crash.lost.join(',')}; wall wobble lost ` +
        `[${wobble.lost.join(',')}] banked at ${wobble.banked.join(',')}; rival bump lost ` +
        `[${bump.lost.join(',')}] banked at ${bump.banked.join(',')}`,
    );
  });
});

describe('drift keep: the replay hash stays deterministic', () => {
  const cases: [string, Spec][] = [
    ['a wall crash', { ...WALL, tuning: { 'riders.crashImpactMps': 4 } }],
    ['a wall wobble', { ...WALL, tuning: { 'riders.crashImpactMps': 12 } }],
    ['a rival bump', RIVAL_BUMP],
  ];

  it('the same inputs give the same world hash on every tick, for a crash, a wobble and a bump', () => {
    const lines: string[] = [];
    for (const [label, spec] of cases) {
      const a = play(spec);
      const b = play(spec);
      expect(a.track.length).toBeGreaterThan(150);
      expect(
        a.track.map((p) => p.hash),
        label,
      ).toEqual(b.track.map((p) => p.hash));
      lines.push(`${label}: ${a.track.length} ticks, last hash ${a.track[a.track.length - 1]?.hash}`);
    }
    console.log(`[examined] per-tick world hashes, two runs each: ${lines.join(' | ')}`);
  });

  it('and the hash sees the chain: the same world hashes differently with the chain emptied', () => {
    const wobble = play({ ...(cases[1]?.[1] as Spec), ticks: 120 });
    const st = riderState(wobble.world);
    const id = wobble.player.id;
    expect(st.driftChain[id]).toBe(1); // a chain is open after the wall wobble
    const withChain = worldHash(wobble.world);
    st.driftChain[id] = 0;
    st.driftCash[id] = 0;
    st.driftWindow[id] = 0;
    expect(worldHash(wobble.world)).not.toBe(withChain);
  });
});
