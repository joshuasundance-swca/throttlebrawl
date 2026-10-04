// Playtest 3's moves contract (K0a; scratch spec moves.md §2 item 4): sim/race scores a clean
// wheelie by the second, a banked drift chain, and a hood launch's landed trick at
// race.styleHoodScale times. The events are injected as if sim/riders emitted them, so these hold
// whatever the wheelie and drift lanes build behind the stubs.
import { describe, expect, it } from 'vitest';
import type { SimConfig, SimEvent, SimStyleRewards } from '../api';
import { testConfig } from '../riders/testing';
import { addMover, createWorld, type Mover, type World } from '../world';
import { gridPosition, raceSystem, RACE_TUNING } from './index';

const REWARDS: SimStyleRewards = {
  perNearMissCash: 25,
  perAirtimeCash: 40,
  perOncomingSecondCash: 10,
  perTakedownCash: 200,
  takedownComboScale: 0.5,
  perStealCash: 60,
  perWheelieSecondCash: 20,
  perDriftSecondCash: 30,
};

function styledConfig(style: SimStyleRewards = REWARDS, tuning: Record<string, number> = {}): SimConfig {
  const base = testConfig({ rivals: 1 });
  const all: Record<string, number> = { ...base.tuning };
  for (const d of RACE_TUNING) all[d.id] = d.default;
  return { ...base, tuning: { ...all, ...tuning }, event: { ...base.event, style } };
}

function harness(config: SimConfig) {
  const world: World = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  raceSystem.init(world, config);
  const player = world.movers[config.riders.findIndex((r) => r.controller.kind === 'player')] as Mover;
  player.pos = { edge: 0, s: 1500, d: -1.5, dir: 1 };
  player.mode = 'Road';
  player.speed = 5;
  const step = (inject: Omit<SimEvent, 'tick'>[] = []): SimEvent[] => {
    world.events = inject.map((e) => ({ ...e, tick: world.tick }));
    raceSystem.step(world, config);
    world.tick++;
    const out = world.events.filter((e) => e.type === 'style');
    world.events = [];
    return out;
  };
  return { world, player, step };
}

const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}) => ({
  type,
  actor,
  data,
  causeId: 900,
});

describe('a clean wheelie scores by the second (playtest 3: "a way to do wheelies")', () => {
  it('pays the sweet band whole and the rest at half', () => {
    const h = harness(styledConfig());
    const sweet = h.step([
      ev('wheelieEnd', h.player.id, { seconds: 3, sweetS: 3, clean: true, loopOut: false }),
    ]);
    expect(sweet).toHaveLength(1);
    expect(sweet[0]?.data).toMatchObject({ kind: 'wheelie', points: 60, seconds: 3, sweetS: 3 });
    expect(sweet[0]?.causeId).toBe(900);
    // 20 × (1 + 0.5 × 1.5) = 35.
    const mixed = h.step([
      ev('wheelieEnd', h.player.id, { seconds: 2.5, sweetS: 1, clean: true, loopOut: false }),
    ]);
    expect(mixed[0]?.data['points']).toBe(35);
    expect(h.world.facts.styleTally[h.player.id]).toBe(95);
  });

  it('pays nothing for a dropped front, a loop-out or a wheelie under the minimum', () => {
    const h = harness(styledConfig());
    expect(
      h.step([ev('wheelieEnd', h.player.id, { seconds: 3, sweetS: 2, clean: false, loopOut: false })]),
    ).toEqual([]);
    expect(
      h.step([ev('wheelieEnd', h.player.id, { seconds: 3, sweetS: 2, clean: false, loopOut: true })]),
    ).toEqual([]);
    expect(
      h.step([ev('wheelieEnd', h.player.id, { seconds: 0.9, sweetS: 0.9, clean: true, loopOut: false })]),
    ).toEqual([]);
    expect(RACE_TUNING.find((d) => d.id === 'race.styleWheelieMinS')?.default).toBe(1);
  });

  it('a shorter minimum (a non-default slider value) turns a 0.9 s wheelie into cash', () => {
    const h = harness(styledConfig(REWARDS, { 'race.styleWheelieMinS': 0.5 }));
    const out = h.step([
      ev('wheelieEnd', h.player.id, { seconds: 0.9, sweetS: 0.9, clean: true, loopOut: false }),
    ]);
    expect(out[0]?.data['points']).toBe(18);
  });

  it('scores nothing when the event sets no wheelie cash (absent means 0)', () => {
    const { perWheelieSecondCash: _w, perDriftSecondCash: _d, ...old } = REWARDS;
    const h = harness(styledConfig(old));
    expect(
      h.step([ev('wheelieEnd', h.player.id, { seconds: 3, sweetS: 3, clean: true, loopOut: false })]),
    ).toEqual([]);
  });
});

describe('a banked drift chain scores its points (playtest 3: "a drift meter with style cash")', () => {
  it('scores the points the banking driftEnd carries, and nothing for an end that banks none', () => {
    const h = harness(styledConfig());
    const unbanked = h.step([
      ev('driftEnd', h.player.id, { seconds: 1.2, clean: true, chain: 1, points: 0, boostMps: 3 }),
    ]);
    expect(unbanked).toEqual([]);
    const banked = h.step([
      ev('driftEnd', h.player.id, { seconds: 1.4, clean: true, chain: 2, points: 140.4, boostMps: 3 }),
    ]);
    expect(banked).toHaveLength(1);
    expect(banked[0]?.data).toMatchObject({ kind: 'drift', points: 140, chain: 2 });
  });
});

describe('a hood launch lands a richer trick (playtest 3: "launch you up into a jump doing backflips")', () => {
  it('scores the landed trick × race.styleHoodScale when the landing carries data.hood', () => {
    const plain = harness(styledConfig());
    plain.step([ev('jump', plain.player.id, { speed: 30, vyMps: 10 })]);
    for (let i = 0; i < 60; i++) plain.step();
    const land = { quality: 'clean', trick: 'backflip', flips: 2 };
    const p = plain.step([ev('land', plain.player.id, land)]).find((e) => e.data['kind'] === 'trick');
    // perAirtimeCash 40 × race.styleTrickScale 2 × 2 turns = 160; × 1.5 off a hood = 240.
    expect(p?.data['points']).toBe(160);

    const hood = harness(styledConfig());
    hood.step([ev('jump', hood.player.id, { speed: 30, vyMps: 10, hood: true })]);
    for (let i = 0; i < 60; i++) hood.step();
    const t = hood
      .step([ev('land', hood.player.id, { ...land, hood: true })])
      .find((e) => e.data['kind'] === 'trick');
    expect(t?.data).toMatchObject({ points: 240, hood: true });
    expect(RACE_TUNING.find((d) => d.id === 'race.styleHoodScale')?.default).toBe(1.5);
  });

  it('a non-default hood scale changes the cash', () => {
    const h = harness(styledConfig(REWARDS, { 'race.styleHoodScale': 3 }));
    h.step([ev('jump', h.player.id, { speed: 30, vyMps: 10, hood: true })]);
    const t = h
      .step([ev('land', h.player.id, { quality: 'clean', trick: 'backflip', flips: 1, hood: true })])
      .find((e) => e.data['kind'] === 'trick');
    expect(t?.data['points']).toBe(240);
  });
});
