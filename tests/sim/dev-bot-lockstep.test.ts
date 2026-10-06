/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessRace, type AppHandle, type HeadlessRace, type TickDriver } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type {
  EntitySnapshot,
  LaneInfo,
  RouteQueries,
  SimEvent,
  SimInput,
  SimSnapshot,
} from '../../src/sim/api';
import { blankActions, botInput, installTestHandle, type TestHandle } from '../../src/dev';

// Playtest 4 run B's live check (punch item 11): Bridge City seed 3 rode edges 0 to 9 in one run and
// 0,1,2,1,2,3,13,10,11,12,14,9 in another, with only the frame pacing different. A browser runner
// calls the handle between frames, so a call lands on whatever tick the pacing reached: the live
// check's quick race switched the bot on in the menu, started the race, waited for tick > 5 and
// switched it on again, and that second call built a new bot mid-race. The new bot's fight clock
// (ENGAGE_LIMIT_TICKS from when it first sees its rival) then ran from that tick, so its first
// different input came at tick 841 and the route split later. Here a fake app steps a real headless
// free-play race exactly as app/index.ts's step does (the tick driver writes the actions from the
// current snapshot, the sim steps, the step listener runs), and the runner calls the handle only
// between frames, as page.evaluate does.

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const BRIDGE_CITY = {
  eventId: 'region-pnw:pnw-fogline-run',
  route: 'region-pnw:osm-bridge-city-run',
  freePlay: true,
} as const;
/** The race's own end is the stop; this is only a safety cap (Bridge City takes about 8,000 to 10,000 ticks). */
const MAX_TICKS = 60 * 200;

interface FakeApp {
  app: AppHandle;
  /** One drawn frame: `steps` loop steps, as the loop runs them under lockstep or in real time. */
  frame(steps: number): void;
  /** A race started from the menu's Race button: the app's own start, not the handle's startRace. */
  menuRace(): void;
  tick(): number;
  over(): boolean;
}

function fakeApp(): FakeApp {
  let seed = 1;
  let race: HeadlessRace | null = null;
  let curr: SimSnapshot | null = null;
  let driver: TickDriver | null = null;
  let listener: ((s: SimSnapshot, e: readonly SimEvent[]) => void) | null = null;
  let inputs: SimInput[][] = [];
  const start = () => {
    race = createHeadlessRace({ seed, ...BRIDGE_CITY }, { registry: ALL });
    curr = race.sim.snapshot();
    inputs = [];
  };
  const over = () => {
    if (!race || !curr) return true;
    return race.sim.isOver() || !!curr.entities[race.playerId]?.finished;
  };
  const step = () => {
    if (!race || !curr || over()) return;
    // app/index.ts: input.sample runs the driver on `curr`, then the sim steps on its command.
    const a = blankActions();
    if (driver) driver(curr, a);
    const cmd = botInput(a);
    inputs.push([cmd]);
    race.sim.step([cmd]);
    curr = race.sim.snapshot();
    listener?.(curr, race.sim.events());
  };
  const app = {
    build: { id: 'test', channel: 'dev' },
    state: () => (race ? 'race' : 'menu'),
    snapshot: () => curr,
    recentEvents: () => [],
    playerId: () => race?.playerId ?? 0,
    setTickDriver: (d: TickDriver | null) => {
      driver = d;
    },
    onStep: (l: typeof listener) => {
      listener = l;
    },
    setSeed: (s: number) => {
      seed = s;
    },
    startRace: start,
    roadQueries: () => race?.route ?? null,
    getReplayAndSettings: () => ({ replay: { inputs } }),
    setLockstep: () => undefined,
    rendererStats: () => ({}),
  } as unknown as AppHandle;
  return {
    app,
    frame: (steps) => {
      for (let i = 0; i < steps; i++) step();
    },
    menuRace: start,
    tick: () => curr?.tick ?? 0,
    over,
  };
}

interface Ride {
  inputs: SimInput[];
  edges: number[];
  ticks: number;
}

/** Rides the race on to its end at `pace` ticks a frame. */
function rideOn(fake: FakeApp, g: TestHandle, pace: number, maxTicks = MAX_TICKS): Ride {
  while (!fake.over() && fake.tick() < maxTicks) fake.frame(pace);
  return { inputs: g.inputs(), edges: g.checks().playerEdges, ticks: fake.tick() };
}

/**
 * The live check's quick race (its driver's `quickRace`, then `hookRun`): the seed and the bot on,
 * Race from the menu, wait in real time for tick > 5, the bot on again, then fast-forward. Frames
 * are `waitPace` ticks while it waits and `ridePace` after: the only difference between two rides.
 */
function quickRace(fake: FakeApp, g: TestHandle, seed: number, waitPace: number, ridePace: number): Ride {
  g.setSeed(seed);
  g.setBot(true);
  fake.menuRace();
  while (fake.tick() <= 5) fake.frame(waitPace);
  g.setBot(true);
  return rideOn(fake, g, ridePace);
}

function tab(): { fake: FakeApp; g: TestHandle } {
  const fake = fakeApp();
  return { fake, g: installTestHandle(fake.app) };
}

describe('dev/handle: the bot rides one seed the same way whatever the frame pacing', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('document', { addEventListener: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Bridge City seed 3: the same inputs and edges when the bot is switched on again at tick 6 or at tick 15', () => {
    // 6 ticks a frame (a fast runner), then fast-forward at 6; 15 a frame (a slow one), then 120.
    const a = tab();
    const fast = quickRace(a.fake, a.g, 3, 6, 6);
    const b = tab();
    const slow = quickRace(b.fake, b.g, 3, 15, 120);
    expect(fast.edges.length).toBeGreaterThanOrEqual(10);
    expect(fast.inputs).toHaveLength(fast.ticks);
    expect(slow.edges).toEqual(fast.edges);
    expect(slow.ticks).toBe(fast.ticks);
    expect(slow.inputs).toEqual(fast.inputs);

    // A second race from the menu in the same tab, with the bot left on: it starts from that
    // race's tick 0 like the first, not from what the bot remembered of a race left after 900 ticks.
    const c = tab();
    c.g.setSeed(3);
    c.g.setBot(true);
    c.fake.menuRace();
    c.fake.frame(900);
    c.fake.menuRace();
    const again = rideOn(c.fake, c.g, 30);
    expect(again.inputs).toEqual(fast.inputs);
  }, 180_000);

  it('decides once per sim tick: a countdown samples the driver on the same snapshot over and over, and gets one decision', () => {
    // A rival alongside in kick reach (dev/bot's kick fixture): the first look presses the kick.
    const rider = (id: number, s: number, d: number) =>
      ({
        id,
        kind: 'rider',
        mode: 'Road',
        faction: 'rider',
        road: { edge: 0, s, d, h: 0, dir: 1, yaw: 0 },
        speed: 30,
        health: 100,
        grounded: true,
      }) as EntitySnapshot;
    const grid = { tick: 0, entities: [rider(0, 100, 1.7), rider(1, 100.3, 0.6)] } as unknown as SimSnapshot;
    const lanes: LaneInfo[] = [
      { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
      { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
    ];
    const route = { lanesAt: () => lanes, kappaAt: () => 0 } as unknown as RouteQueries;
    let driver: TickDriver | null = null;
    const app = {
      playerId: () => 0,
      roadQueries: () => route,
      setTickDriver: (d: TickDriver | null) => {
        driver = d;
      },
      onStep: () => undefined,
      setLockstep: () => undefined,
    } as unknown as AppHandle;
    const g = installTestHandle(app);
    g.setBot(true);
    const looks = [0, 1, 2].map(() => {
      const a = blankActions();
      driver?.(grid, a);
      return a;
    });
    expect(looks[0]?.attack).toBe(true);
    expect(looks[1]).toEqual(looks[0]);
    expect(looks[2]).toEqual(looks[0]);
  });

  it('negative control: a different seed rides different inputs, so the comparison can fail', () => {
    const ride = (seed: number) => {
      const t = tab();
      t.g.setSeed(seed);
      t.g.setBot(true);
      t.fake.menuRace();
      return rideOn(t.fake, t.g, 6, 1200);
    };
    const three = ride(3);
    const four = ride(4);
    expect(four.inputs).toHaveLength(three.inputs.length);
    expect(four.inputs).not.toEqual(three.inputs);
  }, 60_000);
});
