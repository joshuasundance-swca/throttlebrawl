// The test handle (docs/architecture.md, "Testing seams"): `window.__game`, only when the test
// flag is set before the page loads. Read-only views of the game, the bot switch and the seed; no
// write access to sim state. It also keeps the per-tick checks the browser race asserts on:
// every mover finite with a valid road position, and the player's edges in order.
import type { AppHandle } from '../../app';
import type { SimEvent, SimInput, SimSnapshot } from '../../sim/api';
import { createStubBot } from '../bot';

export interface RaceChecks {
  ticks: number;
  /** Player edges in the order first entered (repeats collapsed). */
  playerEdges: number[];
  /** Ticks where some mover had a non-finite field or an invalid road position. */
  invalidTicks: number;
  firstInvalid: string | null;
  events: Record<string, number>;
}

export interface TestHandle {
  state(): string;
  snapshot(): SimSnapshot | null;
  events(): readonly SimEvent[];
  playerId(): number;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  tap(): void;
  startRace(): void;
  checks(): RaceChecks;
  rendererStats(): ReturnType<AppHandle['rendererStats']>;
  frameStats(): ReturnType<AppHandle['frameStats']>;
  contentHashes(): { sim: string; full: string };
  /**
   * The player slot's recorded SimInputs this race, one per stepped tick, from `from` on (default
   * 0). The input lane's browser specs read it to prove the touch and keyboard paths.
   */
  inputs(from?: number): SimInput[];
}

declare global {
  interface Window {
    /** Set by Playwright's init script before the page loads. */
    __GAME_TEST__?: boolean;
    __game?: TestHandle;
  }
}

export function testFlagSet(): boolean {
  return window.__GAME_TEST__ === true;
}

export function installTestHandle(app: AppHandle): TestHandle {
  const bot = createStubBot();
  let checks: RaceChecks = { ticks: 0, playerEdges: [], invalidTicks: 0, firstInvalid: null, events: {} };

  app.onStep((snap, events) => {
    checks.ticks++;
    for (const e of events) checks.events[e.type] = (checks.events[e.type] ?? 0) + 1;
    const route = app.roadQueries();
    for (const m of snap.entities) {
      const values = [m.x, m.y, m.z, m.heading, m.speed, m.road.s, m.road.d, m.road.h, m.road.yaw];
      const length = route ? route.edgeLength(m.road.edge) : NaN;
      const valid =
        values.every(Number.isFinite) && Number.isInteger(m.road.edge) && m.road.s >= 0 && m.road.s <= length;
      if (!valid) {
        checks.invalidTicks++;
        checks.firstInvalid ??= `tick ${snap.tick} entity ${m.id}: ${JSON.stringify(m.road)}`;
        break;
      }
    }
    const me = snap.entities[app.playerId()];
    if (me && checks.playerEdges[checks.playerEdges.length - 1] !== me.road.edge)
      checks.playerEdges.push(me.road.edge);
  });

  const handle: TestHandle = {
    state: () => app.state(),
    snapshot: () => app.snapshot(),
    events: () => app.recentEvents(),
    playerId: () => app.playerId(),
    setBot(on) {
      app.setTickDriver(
        on
          ? (snap, actions) => {
              const me = snap.entities[app.playerId()];
              const route = app.roadQueries();
              if (me && route) bot.drive(me, route, actions);
            }
          : null,
      );
    },
    setSeed: (seed) => app.setSeed(seed),
    tap: () => app.tap(),
    startRace() {
      checks = { ticks: 0, playerEdges: [], invalidTicks: 0, firstInvalid: null, events: {} };
      app.startRace();
    },
    checks: () => checks,
    rendererStats: () => app.rendererStats(),
    frameStats: () => app.frameStats(),
    contentHashes: () => app.contentHashes(),
    inputs(from = 0) {
      // The replay arrives untyped along the callback (dev/ does not import replay/).
      const rec = app.getReplayAndSettings().replay as { inputs?: readonly (readonly SimInput[])[] } | null;
      const out: SimInput[] = [];
      for (const slots of rec?.inputs?.slice(from) ?? []) if (slots[0]) out.push({ ...slots[0] });
      return out;
    },
  };
  window.__game = handle;
  return handle;
}
