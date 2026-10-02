/// <reference types="vite/client" />
// The integration round (2026-10-01): the M4 head starts are REACHABLE in a real race, built the
// way the game builds it (createHeadlessRace runs the app's own buildSimConfig on the release
// content: no drafts). Before this round each lived only in hand-built configs:
// - the law (cops-3 + weapons-2): Sgt. Pruitt starts with the baton in his hand, swings it at the
//   rider he chases, a rider who presses attack inside its steal window takes it off him, and a
//   bust's fine reaches the results screen's text and the debug report's event line;
// - the cast (rivals-1): style quirks are on by default, so the weaver's road-wide swerve and the
//   heavy hitter's slow start show in a seeded race, and each style rides differently.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createOutcome, raceResult } from '../../src/app/results';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimEvent, SimSnapshot } from '../../src/sim/api';
import { resultText } from '../../src/ui/format';

const print = (line: string) => process.stdout.write(`[app-cast-and-law] ${line}\n`);
/**
 * Seeds tried until both a steal off the cop and a bust have happened (the search stops as soon as
 * both have). 40, not 16: with forgiving landings (playtest 2, 2026-10-02) the bot crashes less, so
 * it goes down near the cop less often; the first bust came at seed 27 when that landed.
 */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const MAX_TICKS = 60 * 60 * 5;

interface LawRun {
  seed: number;
  copHeldAtStart: string | null;
  copSwings: number;
  steal: SimEvent | null;
  bust: SimEvent | null;
  resultDetail: string | null;
}

/**
 * The dev bot rides; on top of it, a steal-timer: on the tick after a cop's `stealWindow` cue the
 * player presses attack (a fresh press: the tick before is held released). That is all a player
 * does to steal; whether the press lands inside the reach and window is the sim's call.
 */
function lawRace(seed: number): LawRun {
  const { sim, route, playerId, config } = createHeadlessRace({ seed });
  const copIds = config.riders.flatMap((r, i) => (r.faction === 'law' ? [i] : []));
  const bot = createBot();
  const outcome = createOutcome();
  let snap: SimSnapshot = sim.snapshot();
  let pressNext = false;
  let releaseNext = false;
  const run: LawRun = {
    seed,
    copHeldAtStart: null,
    copSwings: 0,
    steal: null,
    bust: null,
    resultDetail: null,
  };
  while (!sim.isOver() && sim.tick < MAX_TICKS && outcome.doneTick === null && !run.steal) {
    const a = emptyActions();
    bot.drive(snap, playerId, route, a);
    if (releaseNext) {
      a.attack = false;
      releaseNext = false;
    } else if (pressNext) {
      a.attack = true;
      pressNext = false;
    }
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    if (sim.tick === 1) run.copHeldAtStart = snap.entities[copIds[0] ?? -1]?.heldWeapon ?? null;
    const events = sim.events();
    outcome.note(events, playerId, sim.tick);
    for (const e of events) {
      if (e.type === 'stealWindow' && copIds.includes(e.actor)) {
        run.copSwings++;
        releaseNext = true;
        pressNext = true;
      }
      // A steal off the cop: the bot's attack presses can also snatch a rival's weapon (W-P found
      // seed 2 taking a rival's lead pipe), which is not this check's steal.
      const offCop = e.target !== undefined && copIds.includes(e.target);
      if (e.type === 'weaponGrab' && e.actor === playerId && e.data['source'] === 'steal' && offCop)
        run.steal = e;
      if (e.type === 'bust' && e.target === playerId) run.bust = e;
    }
  }
  if (outcome.bust) {
    const result = raceResult(snap, playerId, outcome, { id: 'race', byPlaceCash: [] });
    run.resultDetail = resultText(result).detail;
  }
  return run;
}

describe('the law in a real race (release content, the app config path)', () => {
  const runs: LawRun[] = [];
  const need = () => !runs.some((r) => r.steal) || !runs.some((r) => r.bust);
  for (const seed of SEEDS) {
    if (runs.length > 0 && !need()) break;
    runs.push(lawRace(seed));
  }
  for (const r of runs)
    print(
      `seed ${r.seed}: cop starts holding ${r.copHeldAtStart ?? 'nothing'}, ${r.copSwings} steal windows, ` +
        `steal ${r.steal ? `at t${r.steal.tick} (${String(r.steal.data['weapon'])})` : 'none'}, ` +
        `bust ${r.bust ? `at t${r.bust.tick} fine ${String(r.bust.data['fineCash'])}` : 'none'}`,
    );

  it('Sgt. Pruitt starts every race with the baton in his hand', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(r.copHeldAtStart).toBe('base:baton');
  });

  it('the cop swings the baton, and a timed press steals it off him', () => {
    expect(runs.reduce((n, r) => n + r.copSwings, 0)).toBeGreaterThan(0);
    const steal = runs.find((r) => r.steal)?.steal;
    expect(steal, `no steal off the cop in seeds ${runs.map((r) => r.seed).join(', ')}`).toBeTruthy();
    expect(steal?.data['weapon']).toBe('base:baton');
  });

  it("a bust's fine shows on the results screen and leads the debug report's event line", () => {
    const busted = runs.find((r) => r.bust);
    expect(busted, `no bust in seeds ${runs.map((r) => r.seed).join(', ')}`).toBeTruthy();
    const bust = busted?.bust;
    // Tier 1: the cop's own fine, unscaled. The report prints an event's first three data fields.
    expect(Object.keys(bust?.data ?? {}).slice(0, 3)).toEqual(['fineCash', 'tier', 'fineBaseCash']);
    expect(bust?.data['fineCash']).toBe(400);
    expect(bust?.data['tier']).toBe(1);
    expect(busted?.resultDetail).toContain('Fine: $400');
  });
}, 600_000);

/** Metres along the race inside which another rider makes a road weaver keep to its lane (sim/ai). */
const CLEAR_M = 10;

/**
 * Each rival over the first `ticks`: its lateral spread (standard deviation of `d`), its sideways
 * travel per second while no other rider is within CLEAR_M (the weaver swerves only when clear),
 * and the ground it covers in the first 12 s.
 */
function castRun(seed: number, quirks: number | null, ticks: number) {
  const { sim, route, playerId, config } = createHeadlessRace({
    seed,
    ...(quirks === null ? {} : { tuning: { 'ai.styleQuirks': quirks } }),
  });
  const bot = createBot();
  const ds = new Map<number, number[]>();
  const clear = new Map<number, { moved: number; ticks: number }>();
  let snap = sim.snapshot();
  const start = new Map(snap.entities.map((e) => [e.id, e.progress]));
  let at12s: Map<number, number> | null = null;
  while (sim.tick < ticks && !sim.isOver()) {
    const a = emptyActions();
    bot.drive(snap, playerId, route, a);
    const before = snap;
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    if (sim.tick === 12 * 60)
      at12s = new Map(snap.entities.map((e) => [e.id, e.progress - (start.get(e.id) ?? 0)]));
    const riders = snap.entities.filter((e) => e.kind === 'rider');
    for (const e of riders) {
      if (e.mode !== 'Road') continue;
      const list = ds.get(e.id) ?? [];
      list.push(e.road.d);
      ds.set(e.id, list);
      const prev = before.entities[e.id];
      const alone = !riders.some((o) => o.id !== e.id && Math.abs(o.progress - e.progress) < CLEAR_M);
      if (alone && prev && prev.mode === 'Road' && prev.road.edge === e.road.edge) {
        const c = clear.get(e.id) ?? { moved: 0, ticks: 0 };
        c.moved += Math.abs(e.road.d - prev.road.d);
        c.ticks++;
        clear.set(e.id, c);
      }
    }
  }
  const out: Record<string, { style: string; spreadM: number; clearSwayMps: number; first12sM: number }> = {};
  config.riders.forEach((r, id) => {
    if (r.controller.kind !== 'ai') return;
    const list = ds.get(id) ?? [];
    const mean = list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
    const sd = Math.sqrt(list.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, list.length));
    const c = clear.get(id) ?? { moved: 0, ticks: 0 };
    out[r.contentId] = {
      style: r.controller.style,
      spreadM: sd,
      clearSwayMps: (c.moved / Math.max(1, c.ticks)) * 60,
      first12sM: at12s?.get(id) ?? 0,
    };
  });
  return out;
}

describe('the cast in a real race: style quirks on by default', () => {
  const TICKS = 90 * 60;
  const seeds = [1, 2, 3];
  const on = seeds.map((s) => castRun(s, null, TICKS));
  const off = seeds.map((s) => castRun(s, 0, TICKS));
  const mean = (runs: typeof on, id: string, k: 'spreadM' | 'clearSwayMps' | 'first12sM') =>
    runs.reduce((s, r) => s + (r[id]?.[k] ?? 0), 0) / runs.length;
  for (const id of Object.keys(on[0] ?? {}))
    print(
      `${id} (${on[0]?.[id]?.style}): lateral spread ${mean(on, id, 'spreadM').toFixed(2)} m on, ` +
        `${mean(off, id, 'spreadM').toFixed(2)} m off; sway when clear ${mean(on, id, 'clearSwayMps').toFixed(2)} m/s on, ` +
        `${mean(off, id, 'clearSwayMps').toFixed(2)} m/s off; first 12 s ${mean(on, id, 'first12sM').toFixed(0)} m on, ` +
        `${mean(off, id, 'first12sM').toFixed(0)} m off`,
    );

  // The weaver swerves only while no rider is within 10 m, and traffic dodging sets everyone's
  // overall spread, so the swerve shows as sideways travel on a clear road, not as a wider spread.
  it("the weaver's swerve shows: Dial-Up sways the most on a clear road, more than with quirks off", () => {
    const weaver = mean(on, 'base:dial-up', 'clearSwayMps');
    expect(weaver).toBeGreaterThan(mean(off, 'base:dial-up', 'clearSwayMps') * 1.15);
    for (const id of Object.keys(on[0] ?? {}))
      if (id !== 'base:dial-up') expect(weaver).toBeGreaterThan(mean(on, id, 'clearSwayMps'));
  });

  it("the heavy hitter's slow start shows: Deacon covers less ground in the first 12 s", () => {
    expect(mean(on, 'base:deacon-vane', 'first12sM')).toBeLessThan(
      mean(off, 'base:deacon-vane', 'first12sM'),
    );
  });

  it('the four styles ride differently from each other with the quirks on', () => {
    const sig = (id: string) =>
      `${mean(on, id, 'spreadM').toFixed(2)}/${mean(on, id, 'clearSwayMps').toFixed(2)}/${mean(on, id, 'first12sM').toFixed(0)}`;
    const ids = Object.keys(on[0] ?? {});
    expect(ids).toHaveLength(4);
    expect(new Set(ids.map(sig)).size).toBe(4);
  });
}, 600_000);
