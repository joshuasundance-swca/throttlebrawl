/// <reference types="vite/client" />
// Signature moves in real races (interview, 2026-10-02: "Visible personalities"): seeded bot races
// from the real packs, every rival with the move its rider file names. The batch prints each
// rival's move, how often it starts and how long each phase shows, so the differences between
// rivals are on the record, and asserts that:
//   - the snapshot's `signature` field only ever shows a rider's own move (render can trust it);
//   - every timed move (selfie, wave, lag, pivot, ram, sweet talk, cut-in, timber) shows in the batch,
//     and the rivals' moves are told apart: at least eight different moves show;
//   - a race replays to the same hash and the same signature trace for its seed;
//   - with `ai.signatures` off, nothing shows.
// Four fields cover the eleven rivals: the base sprint's four regulars, the base locals (Mother
// Rust, Tammy, the Mayor) with Kevin, the Pacific Northwest race and the San Francisco race.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { basePackFiles, buildRegistry, registryFromGlob, type ContentRegistry } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, SIGNATURE_IDS, type SignatureId } from '../../src/sim/api';

const print = (line: string) => process.stdout.write(`[ai-signatures] ${line}\n`);

const ALL = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);

/** The base pack with the sprint's field swapped for the base locals plus Kevin. */
function localsRegistry(): ContentRegistry {
  const files = basePackFiles().map((f) => {
    const json = f.json as { type?: string; id?: string; field?: { riders?: string[] } };
    if (json.type !== 'event' || json.id !== 'm1-skeleton-sprint' || !json.field) return f;
    const riders = ['mother-rust', 'tammy-two-stroke', 'the-mayor', 'kevin-from-accounting'];
    return { ...f, json: { ...json, field: { ...json.field, riders } } };
  });
  return buildRegistry(files, { includeDrafts: true });
}

const FIELDS: { name: string; reg: ContentRegistry; eventId: string }[] = [
  { name: 'base regulars', reg: ALL, eventId: 'm1-skeleton-sprint' },
  { name: 'base locals', reg: localsRegistry(), eventId: 'm1-skeleton-sprint' },
  { name: 'pnw', reg: ALL, eventId: 'region-pnw:pnw-fogline-run' },
  { name: 'sf', reg: ALL, eventId: 'region-sf:sf-hill-sprint' },
];
const SEEDS = [1, 2];
const TICKS = 100 * 60;
const STREAMS = createStreamCache();

interface Tally {
  move: string;
  /** The moves the snapshot showed for this rider (should be only its own). */
  shown: Set<string>;
  starts: number;
  tellS: number;
  actS: number;
  openS: number;
}

function race(field: (typeof FIELDS)[number], seed: number, signatures = 1) {
  const config = buildSimConfig(field.reg, STREAMS.forEvent(field.reg, field.eventId), {
    seed,
    eventId: field.eventId,
    tuning: { 'ai.signatures': signatures },
  });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const tally = new Map<string, Tally>();
  config.riders.forEach((r) => {
    if (r.controller.kind !== 'ai') return;
    tally.set(r.contentId, {
      move: r.controller.personality?.signature ?? '',
      shown: new Set(),
      starts: 0,
      tellS: 0,
      actS: 0,
      openS: 0,
    });
  });
  let trace = 0;
  let snap = sim.snapshot();
  const was = new Map<number, string>();
  while (sim.tick < TICKS && !sim.isOver()) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const e of snap.entities) {
      if (e.kind !== 'rider') continue;
      const sig = e.signature ?? null;
      const t = tally.get(e.contentId);
      const now = sig ? `${sig.move}:${sig.phase}` : '';
      if (sig && t) {
        t.shown.add(sig.move);
        if (sig.phase === 'tell') t.tellS += 1 / 60;
        else if (sig.phase === 'act') t.actS += 1 / 60;
        else t.openS += 1 / 60;
        if (sig.phase === 'act' && was.get(e.id) !== now) t.starts++;
      }
      if (now !== (was.get(e.id) ?? '')) trace = (Math.imul(trace, 31) + now.length + sim.tick) | 0;
      was.set(e.id, now);
    }
  }
  return { tally, hash: sim.hash(), trace };
}

describe('signature moves in seeded real races', () => {
  const runs = FIELDS.flatMap((f) => SEEDS.map((seed) => ({ field: f.name, seed, ...race(f, seed) })));
  const byRival = new Map<string, Tally>();
  for (const r of runs) {
    for (const [id, t] of r.tally) {
      const sum = byRival.get(id) ?? {
        ...t,
        shown: new Set<string>(),
        starts: 0,
        tellS: 0,
        actS: 0,
        openS: 0,
      };
      for (const m of t.shown) sum.shown.add(m);
      sum.starts += t.starts;
      sum.tellS += t.tellS;
      sum.actS += t.actS;
      sum.openS += t.openS;
      byRival.set(id, sum);
    }
  }
  for (const [id, t] of byRival)
    print(
      `${id} (${t.move || 'no move'}): ${t.starts} moves in the batch; tell ${t.tellS.toFixed(1)} s, ` +
        `act ${t.actS.toFixed(1)} s, open ${t.openS.toFixed(1)} s`,
    );

  it('examines all eleven rivals with a move', () => {
    const moves = [...byRival.values()].map((t) => t.move).filter(Boolean);
    expect(new Set(moves).size).toBe(SIGNATURE_IDS.length);
  });

  it("the snapshot only ever shows a rider's own move", () => {
    for (const [id, t] of byRival) for (const m of t.shown) expect(`${id}:${m}`).toBe(`${id}:${t.move}`);
  });

  it('every timed move shows in the batch, and at least eight different moves show', () => {
    const timed: SignatureId[] = ['selfie', 'wave', 'lag', 'pivot', 'ram', 'sweet-talk', 'cut-in', 'timber'];
    const shown = new Set([...byRival.values()].flatMap((t) => [...t.shown]));
    for (const m of timed) expect(shown, m).toContain(m);
    expect(shown.size).toBeGreaterThanOrEqual(8);
  });

  it('a race replays to the same hash and the same signature trace', () => {
    const f = FIELDS[1];
    if (!f) throw new Error('fields');
    const a = race(f, 1);
    const b = runs.find((r) => r.field === f.name && r.seed === 1);
    expect(a.hash).toBe(b?.hash);
    expect(a.trace).toBe(b?.trace);
  });

  it('shows nothing with the switch off', () => {
    const f = FIELDS[0];
    if (!f) throw new Error('fields');
    const off = race(f, 1, 0);
    for (const t of off.tally.values()) expect(t.shown.size).toBe(0);
  });
}, 600_000);
