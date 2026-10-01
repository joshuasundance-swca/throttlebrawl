// The test handle (docs/architecture.md, "Testing seams"): `window.__game`, only when the test
// flag is set before the page loads. Read-only views of the game, the bot switch and the seed; no
// write access to sim state. It also keeps the per-tick checks the browser race asserts on:
// every mover finite with a known mode and a valid road position, the player's edges in order,
// event counts, the player's landed hits and what the bot did.
import type { AppHandle } from '../../app';
import type { SimEvent, SimInput, SimSnapshot } from '../../sim/api';
import { createBot, type BotController, type BotStats } from '../bot';
import { createPerfProbe, type PerfReport } from '../perf';
import { debugFileText, parseDebugFile, reportText } from '../report';
import { botAttackRun, type AttackRun } from './attacks';
import { moverProblem } from './checks';

export { MOVER_MODES, moverProblem } from './checks';
export { botAttackRun } from './attacks';
export type { AttackRun, AttackRunOptions } from './attacks';

export interface RaceChecks {
  ticks: number;
  /** Player edges in the order first entered (repeats collapsed). */
  playerEdges: number[];
  /** Ticks where some mover had a non-finite field, an unknown mode or an invalid road position. */
  invalidTicks: number;
  firstInvalid: string | null;
  /** Every event type seen this race, with its count. */
  events: Record<string, number>;
  /** `hit` events whose actor is the player: attacks that connected. */
  playerHits: number;
  /** `takedown` events whose actor is the player: rivals it fought down. */
  playerTakedowns: number;
  /** The bot's own counters (zeros when the bot is off). */
  bot: BotStats;
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
  /** The perf probe's numbers: frame and sim step percentiles, draw calls, triangles, heap. */
  perf(): PerfReport;
  contentHashes(): { sim: string; full: string };
  /**
   * The player slot's recorded SimInputs this race, one per stepped tick, from `from` on (default
   * 0). The input lane's browser specs read it to prove the touch and keyboard paths.
   */
  inputs(from?: number): SimInput[];
  /** The "copy debug report" summary, as it would be copied now. */
  reportText(): string;
  /** The debug file's text, as "save debug file" would write it now. */
  debugFileText(): string;
  /** Reads a debug file's replay and replays it against a fresh sim of this build (dev-3's check). */
  checkDebugFile(text: string): ReturnType<AppHandle['checkReplay']> & { summary: string };
  /**
   * Headless bot races in the page, one per seed, each up to the bot's first landed hit (the
   * browser race's multi-seed "an attack connects" check). Content as this build loads it.
   */
  botAttackRuns(seeds: readonly number[]): AttackRun[];
  /** The same headless runs, each up to the bot's first takedown (M2 exit criterion 9). */
  botTakedownRuns(seeds: readonly number[]): AttackRun[];
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

function freshChecks(bot: BotController | null): RaceChecks {
  return {
    ticks: 0,
    playerEdges: [],
    invalidTicks: 0,
    firstInvalid: null,
    events: {},
    playerHits: 0,
    playerTakedowns: 0,
    bot: bot?.stats() ?? {
      attackPresses: 0,
      skipTicks: 0,
      shortcutTicks: 0,
      shortcutSeenTicks: 0,
      shortcutApproachTicks: 0,
      trafficDodges: 0,
      engagements: 0,
      kickPresses: 0,
      dangerKicks: 0,
    },
  };
}

export function installTestHandle(app: AppHandle): TestHandle {
  let botOn = false;
  let bot: BotController | null = null;
  let checks = freshChecks(null);
  const probe = createPerfProbe(app);

  app.onStep((snap, events) => {
    checks.ticks++;
    const playerId = app.playerId();
    for (const e of events) {
      checks.events[e.type] = (checks.events[e.type] ?? 0) + 1;
      if (e.type === 'hit' && e.actor === playerId) checks.playerHits++;
      if (e.type === 'takedown' && e.actor === playerId) checks.playerTakedowns++;
    }
    const route = app.roadQueries();
    for (const m of snap.entities) {
      const problem = route ? moverProblem(m, route) : 'no route';
      if (problem) {
        checks.invalidTicks++;
        checks.firstInvalid ??= `tick ${snap.tick} entity ${m.id} (${m.kind}, ${m.mode}): ${problem}`;
        break;
      }
    }
    const me = snap.entities[playerId];
    if (me && checks.playerEdges[checks.playerEdges.length - 1] !== me.road.edge)
      checks.playerEdges.push(me.road.edge);
    if (bot) checks.bot = bot.stats();
  });

  const installDriver = () => {
    bot = botOn ? createBot() : null;
    const driver = bot;
    app.setTickDriver(
      driver
        ? (snap, actions) => {
            const route = app.roadQueries();
            if (route) driver.drive(snap, app.playerId(), route, actions);
          }
        : null,
    );
  };

  const handle: TestHandle = {
    state: () => app.state(),
    snapshot: () => app.snapshot(),
    events: () => app.recentEvents(),
    playerId: () => app.playerId(),
    setBot(on) {
      botOn = on;
      installDriver();
    },
    setSeed: (seed) => app.setSeed(seed),
    tap: () => app.tap(),
    startRace() {
      // A fresh bot per race, so its counters and memory start clean.
      if (botOn) installDriver();
      checks = freshChecks(bot);
      app.startRace();
    },
    checks: () => checks,
    rendererStats: () => app.rendererStats(),
    frameStats: () => app.frameStats(),
    perf: () => probe.report(),
    contentHashes: () => app.contentHashes(),
    inputs(from = 0) {
      // The replay arrives untyped along the callback (dev/ does not import replay/).
      const rec = app.getReplayAndSettings().replay as { inputs?: readonly (readonly SimInput[])[] } | null;
      const out: SimInput[] = [];
      for (const slots of rec?.inputs?.slice(from) ?? []) if (slots[0]) out.push({ ...slots[0] });
      return out;
    },
    reportText: () => reportText(app),
    debugFileText: () => debugFileText(app),
    checkDebugFile(text) {
      const { summary, replay } = parseDebugFile(text);
      return { ...app.checkReplay(replay), summary };
    },
    botAttackRuns: (seeds) =>
      seeds.map((seed) => botAttackRun(seed, { includeDrafts: app.build.channel !== 'prod' })),
    botTakedownRuns: (seeds) =>
      seeds.map((seed) =>
        botAttackRun(seed, { includeDrafts: app.build.channel !== 'prod', until: 'takedown' }),
      ),
  };
  window.__game = handle;
  return handle;
}
