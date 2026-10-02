// riders-5 acceptance, style scoring (docs/milestones/M2.md, "riders-5 · Style, race lengths and
// difficulty"): a scripted near miss, a 0.6 s jump, a 2.5 s oncoming stretch, two takedowns 3 s
// apart and a steal each emit exactly one `style` event of the right kind; the second takedown
// scores more than the first; the oncoming lane on a dir −1 leg is the direction +1 one; and a jump
// inside slow motion is measured in world time, not ticks.
import { describe, expect, it } from 'vitest';
import type { SimConfig, SimEvent, SimStyleRewards, StyleRunSnapshot } from '../api';
import { testConfig } from '../riders/testing';
import type { SimRiderDef } from '../types';
import { addMover, createWorld, type Mover, type World } from '../world';
import { gridPosition, raceSystem, RACE_TUNING, styleRunOf } from './index';

const REWARDS: SimStyleRewards = {
  perNearMissCash: 25,
  perAirtimeCash: 40,
  perOncomingSecondCash: 10,
  perTakedownCash: 200,
  takedownComboScale: 0.5,
  perStealCash: 60,
};

function styledConfig(style: SimStyleRewards | null = REWARDS, rivals = 1): SimConfig {
  const base = testConfig({ rivals });
  const tuning: Record<string, number> = { ...base.tuning };
  for (const d of RACE_TUNING) tuning[d.id] = d.default;
  return { ...base, tuning, event: { ...base.event, ...(style ? { style } : {}) } };
}

/** The race system alone, riders placed by hand; events are injected as if earlier phases emitted them. */
function harness(config: SimConfig) {
  const world: World = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  raceSystem.init(world, config);
  const player = world.movers[config.riders.findIndex((r) => r.controller.kind === 'player')] as Mover;
  const rival = world.movers[0] as Mover;
  const styles: SimEvent[] = [];
  const step = (inject: Omit<SimEvent, 'tick'>[] = []): SimEvent[] => {
    world.events = inject.map((e) => ({ ...e, tick: world.tick }));
    raceSystem.step(world, config);
    world.tick++;
    const out = world.events.filter((e) => e.type === 'style');
    styles.push(...out);
    world.events = [];
    return out;
  };
  return { world, player, rival, styles, step };
}

/** Parks a rider riding at `speed` at lateral offset d, facing `dir`, well inside the straight. */
function ride(m: Mover, d: number, speed: number, dir: 1 | -1 = 1): void {
  m.pos = { edge: 0, s: 1500, d, dir };
  m.mode = 'Road';
  m.speed = speed;
}

const ev = (
  type: SimEvent['type'],
  actor: number,
  data: SimEvent['data'] = {},
  extra: Partial<SimEvent> = {},
) => ({
  type,
  actor,
  data,
  causeId: 900,
  ...extra,
});

describe('lane splitting pays more (W-R; interview, 2026-10-02: "lane splitting")', () => {
  it('a near miss that threads between two vehicles scores race.styleSplitScale times the cash', () => {
    const h = harness(styledConfig());
    ride(h.player, 3.4, 30);
    h.step();
    const one = h.step([ev('nearMiss', h.player.id, { clearanceM: 0.5, closingMps: 20 })]);
    const split = h.step([ev('nearMiss', h.player.id, { clearanceM: 0.4, closingMps: 20, split: true })]);
    expect(one[0]?.data['points']).toBe(25);
    expect(one[0]?.data['split']).toBeUndefined();
    expect(split[0]?.data).toMatchObject({ kind: 'nearMiss', points: 50, split: true });
    expect(RACE_TUNING.find((d) => d.id === 'race.styleSplitScale')?.default).toBe(2);
  });
});

describe('riders-5: style scoring', () => {
  it('a near miss scores one nearMiss style event, linked to it, and adds to the tally', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    h.step();
    const out = h.step([ev('nearMiss', h.player.id, { clearanceM: 0.5, closingMps: 20 }, { causeId: 77 })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.actor).toBe(h.player.id);
    expect(out[0]?.data['kind']).toBe('nearMiss');
    expect(out[0]?.data['points']).toBe(25);
    expect(out[0]?.causeId).toBe(77);
    expect(h.world.facts.styleTally[h.player.id]).toBe(25);
  });

  it('a 0.6 s jump scores one airtime event at the landing; a 0.4 s one scores nothing', () => {
    const jump = (airTicks: number) => {
      const h = harness(styledConfig());
      ride(h.player, 1.7, 30);
      h.step([ev('jump', h.player.id)]);
      h.player.mode = 'Airborne';
      for (let t = 1; t < airTicks; t++) h.step();
      h.player.mode = 'Road';
      h.step([ev('land', h.player.id, { quality: 'clean', airTicks })]);
      return h;
    };
    const long = jump(36);
    expect(long.styles.map((e) => e.data['kind'])).toEqual(['airtime']);
    expect(long.styles[0]?.data['points']).toBe(40);
    expect(jump(24).styles).toEqual([]);
  });

  it('a crash landing scores no airtime', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    h.step([ev('jump', h.player.id)]);
    for (let t = 1; t < 60; t++) h.step();
    h.step([ev('land', h.player.id, { quality: 'crash' })]);
    expect(h.styles).toEqual([]);
  });

  it('a jump inside slow motion is measured in world time, not raw ticks', () => {
    // 40 raw ticks at timeScale 0.3 is 0.2 s of world time: no airtime, though 40 ticks is 0.67 s.
    const slow = (rawTicks: number) => {
      const h = harness(styledConfig());
      ride(h.player, 1.7, 30);
      h.world.timeScale = 0.3;
      h.step([ev('jump', h.player.id)]);
      for (let t = 1; t < rawTicks; t++) h.step();
      h.step([ev('land', h.player.id, { quality: 'clean' })]);
      return h.styles.map((e) => e.data['kind']);
    };
    expect(slow(40)).toEqual([]);
    expect(slow(110)).toEqual(['airtime']); // 110 × 0.3 = 33 world ticks = 0.55 s
  });

  it('a 2.5 s oncoming stretch above half top speed scores once, by the second, when it ends', () => {
    const h = harness(styledConfig());
    ride(h.player, -1.7, 30); // dir +1 in the direction −1 lane
    for (let t = 0; t < 150; t++) expect(h.step()).toEqual([]);
    h.player.pos.d = 1.7; // back in its own lane
    const out = h.step();
    expect(out.map((e) => e.data['kind'])).toEqual(['oncoming']);
    expect(out[0]?.data['points']).toBe(25);
    expect(h.styles).toHaveLength(1);
  });

  it('an oncoming stretch still open at the finish line scores as the rider finishes', () => {
    const h = harness(styledConfig());
    ride(h.player, -1.7, 30);
    h.player.pos.s = 2800;
    for (let t = 0; t < 150; t++) h.step();
    h.player.pos.s = 2990; // past the finish at 2980
    const out = h.step();
    expect(out.map((e) => e.data['kind'])).toEqual(['oncoming']);
    expect(out[0]?.data['points']).toBe(25);
  });

  it('scores no oncoming stretch that is too short or too slow, nor riding in its own lane', () => {
    const run = (d: number, speed: number, ticks: number) => {
      const h = harness(styledConfig());
      ride(h.player, d, speed);
      for (let t = 0; t < ticks; t++) h.step();
      h.player.pos.d = 1.7;
      h.player.speed = 30;
      h.step();
      return h.styles;
    };
    expect(run(-1.7, 30, 90)).toEqual([]); // 1.5 s
    expect(run(-1.7, 15, 180)).toEqual([]); // under half of 38 m/s
    expect(run(1.7, 30, 300)).toEqual([]); // its own lane
  });

  it('on a leg ridden at dir −1 the oncoming lane is the direction +1 one, not its own', () => {
    const run = (d: number) => {
      const h = harness(styledConfig());
      ride(h.player, d, 30, -1);
      for (let t = 0; t < 150; t++) h.step();
      h.player.pos.d = -d;
      h.step();
      return h.styles.map((e) => e.data['kind']);
    };
    expect(run(1.7)).toEqual(['oncoming']); // lane R1, direction +1
    expect(run(-1.7)).toEqual([]); // lane L1, direction −1: its own
  });

  it('two takedowns 3 s apart each score once, and the second more than the first', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    const first = h.step([ev('takedown', h.player.id, { kind: 'traffic' }, { target: h.rival.id })]);
    for (let t = 1; t < 180; t++) h.step();
    const second = h.step([ev('takedown', h.player.id, { kind: 'scenery' }, { target: h.rival.id })]);
    expect(first.map((e) => e.data['kind'])).toEqual(['takedownCombo']);
    expect(second.map((e) => e.data['kind'])).toEqual(['takedownCombo']);
    expect(first[0]?.data['points']).toBe(100);
    expect(second[0]?.data['points']).toBe(200);
    expect(Number(second[0]?.data['points'])).toBeGreaterThan(Number(first[0]?.data['points']));
    expect(second[0]?.data['combo']).toBe(2);
  });

  it('a domino takedown (W-Q) scores in the combo and passes its chain length on', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    h.step([ev('takedown', h.player.id, { kind: 'traffic' }, { target: h.rival.id })]);
    const domino = h.step([
      ev('takedown', h.player.id, { kind: 'traffic', domino: 2 }, { target: h.rival.id }),
    ]);
    expect(domino[0]?.data).toMatchObject({ kind: 'takedownCombo', combo: 2, domino: 2, points: 200 });
  });

  it('takedowns more than 5 s of world time apart start a new combo', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    h.step([ev('takedown', h.player.id, { kind: 'traffic' }, { target: h.rival.id })]);
    for (let t = 1; t < 360; t++) h.step();
    const again = h.step([ev('takedown', h.player.id, { kind: 'traffic' }, { target: h.rival.id })]);
    expect(again[0]?.data['points']).toBe(100);
    expect(again[0]?.data['combo']).toBe(1);
  });

  it('a steal scores one weaponSteal event; a pickup off the road scores nothing', () => {
    const h = harness(styledConfig());
    ride(h.player, 1.7, 30);
    const road = h.step([ev('weaponGrab', h.player.id, { weapon: 'base:lead-pipe', source: 'road' })]);
    const steal = h.step([
      ev('weaponGrab', h.player.id, { weapon: 'base:lead-pipe', source: 'steal' }, { target: h.rival.id }),
    ]);
    expect(road).toEqual([]);
    expect(steal.map((e) => e.data['kind'])).toEqual(['weaponSteal']);
    expect(steal[0]?.data['points']).toBe(60);
    expect(h.world.facts.styleTally[h.player.id]).toBe(60);
  });

  it('rivals score too, into their own tally', () => {
    const h = harness(styledConfig());
    ride(h.rival, 1.7, 30);
    h.step([ev('nearMiss', h.rival.id)]);
    expect(h.world.facts.styleTally[h.rival.id]).toBe(25);
    expect(h.world.facts.styleTally[h.player.id] ?? 0).toBe(0);
  });

  it('scores nothing when the event sets no style cash', () => {
    const h = harness(styledConfig(null));
    ride(h.player, -1.7, 30);
    h.step([ev('nearMiss', h.player.id)]);
    h.step([ev('weaponGrab', h.player.id, { source: 'steal' })]);
    for (let t = 0; t < 200; t++) h.step();
    h.player.pos.d = 1.7;
    h.step();
    expect(h.styles).toEqual([]);
  });

  it('the law never scores style', () => {
    const base = styledConfig();
    const player = base.riders[base.riders.length - 1] as SimRiderDef;
    const cop: SimRiderDef = {
      ...player,
      contentId: 'base:cop',
      role: 'cop',
      faction: 'law',
      controller: { kind: 'cop' },
    };
    const h = harness({ ...base, riders: [...base.riders, cop] });
    const copId = h.world.movers.length - 1;
    h.step([ev('nearMiss', copId)]);
    expect(h.styles).toEqual([]);
  });

  it('the style tuning thresholds are sliders with M2.md’s starting values', () => {
    const byId = Object.fromEntries(RACE_TUNING.map((d) => [d.id, d.default]));
    expect(byId['race.styleAirtimeMinS']).toBe(0.5);
    expect(byId['race.styleOncomingMinS']).toBe(2);
    expect(byId['race.styleOncomingSpeedShare']).toBe(0.5);
    expect(byId['race.styleComboWindowS']).toBe(5);
  });

  it('a longer oncoming minimum (a non-default slider value) turns a 2.5 s stretch into nothing', () => {
    const config = styledConfig();
    const h = harness({ ...config, tuning: { ...config.tuning, 'race.styleOncomingMinS': 3 } });
    ride(h.player, -1.7, 30);
    for (let t = 0; t < 150; t++) h.step();
    h.player.pos.d = 1.7;
    h.step();
    expect(h.styles).toEqual([]);
  });
});

// Playtest 1c ([decided] 2026-09-30: "I'd like to also watch oncoming go up and up as you ride"):
// the run in progress, as the snapshot shows it, ends on exactly the cash the style event awards.
describe('playtest 1c: the live style run', () => {
  it('an oncoming stretch ticks up, and its last shown cash is the award, exactly', () => {
    const config = styledConfig();
    const h = harness(config);
    ride(h.player, -1.7, 30); // the oncoming lane, riding toward +s
    let last: StyleRunSnapshot | null = null;
    let rises = 0;
    for (let t = 0; t < 151; t++) {
      h.step();
      const run = styleRunOf(h.world, config, h.player.id);
      if (last && run && run.seconds > last.seconds && run.cash >= last.cash) rises++;
      last = run;
    }
    expect(last?.kind).toBe('oncoming');
    expect(last?.qualifies).toBe(true);
    expect(rises).toBe(150);
    ride(h.player, 1.7, 30); // back in our own lane: the stretch ends and scores
    const out = h.step();
    expect(out).toHaveLength(1);
    expect(out[0]?.data['kind']).toBe('oncoming');
    expect(out[0]?.data['points']).toBe(last?.cash);
    expect(styleRunOf(h.world, config, h.player.id)).toBeNull();
  });

  it('a stretch too short to count shows qualifies false, and awards nothing', () => {
    const config = styledConfig();
    const h = harness(config);
    ride(h.player, -1.7, 30);
    for (let t = 0; t < 60; t++) h.step();
    const run = styleRunOf(h.world, config, h.player.id);
    expect(run).toMatchObject({ kind: 'oncoming', qualifies: false });
    ride(h.player, 1.7, 30);
    expect(h.step()).toHaveLength(0);
  });

  it('airtime shows the jump’s seconds rising and its fixed cash, which a clean landing awards', () => {
    const config = styledConfig();
    const h = harness(config);
    ride(h.player, 1.7, 30);
    h.step([ev('jump', h.player.id)]);
    let run: StyleRunSnapshot | null = null;
    for (let t = 0; t < 40; t++) {
      h.step();
      run = styleRunOf(h.world, config, h.player.id);
    }
    expect(run).toMatchObject({ kind: 'airtime', cash: 40, qualifies: true });
    expect(run?.seconds).toBeCloseTo(40 / 60, 6);
    const out = h.step([ev('land', h.player.id, { quality: 'clean' })]);
    expect(out[0]?.data['points']).toBe(run?.cash);
    expect(styleRunOf(h.world, config, h.player.id)).toBeNull();
  });

  it('no run, and no style state created, before the race has stepped', () => {
    const config = styledConfig();
    const world = createWorld(config);
    expect(styleRunOf(world, config, 0)).toBeNull();
    expect('race.style' in world.systems).toBe(false);
  });
});
