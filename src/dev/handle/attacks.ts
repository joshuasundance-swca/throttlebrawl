// Headless bot fights in the page (the browser bot race's "an attack connects" check). Whether the
// bot's punch lands in one seeded race is luck of the pack: a change anywhere in the sim (a shove,
// a bump) moves the riders and can flip one seed from a hit to a miss. So the browser race asks
// across several seeds, run here headless with the production bundle's sim, content and bot, each
// stopping at its first landed hit or at the race's end. The takedown runs (dev-4 part 2, M2 exit
// criterion 9) are the same race run on to the bot's first takedown instead.
import { createHeadlessRace } from '../../app';
import { blankActions, botInput, createBot } from '../bot';

export interface AttackRun {
  seed: number;
  /** Ticks stepped: the first landed hit's (or takedown's) tick, or the race's end. */
  ticks: number;
  /** `hit` events whose actor is the player (at most 1 when the run stops at the first hit). */
  hits: number;
  /** `takedown` events whose actor is the player (at most 1 when the run stops at the first). */
  takedowns: number;
  /** The first bot takedown's kind (`health`, `traffic` or `scenery`), or null. */
  takedownKind: string | null;
  attackPresses: number;
  /** `attackStart` events for the player: the sim answered a press. */
  attackStarts: number;
  over: boolean;
}

export interface AttackRunOptions {
  /** Load draft content too, as the dev and staging builds do. */
  includeDrafts?: boolean;
  /** Safety stop, ticks (default: the sim's 15-minute hard stop plus 10 s). */
  maxTicks?: number;
  /** Where the run stops: the bot's first landed hit (default) or its first takedown. */
  until?: 'hit' | 'takedown';
}

/** One seeded headless race with the bot in the player slot, up to its first landed hit (or takedown). */
export function botAttackRun(seed: number, opts: AttackRunOptions = {}): AttackRun {
  const { sim, route, playerId } = createHeadlessRace(
    { seed },
    { includeDrafts: opts.includeDrafts ?? false },
  );
  const maxTicks = opts.maxTicks ?? 15 * 60 * 60 + 600;
  const bot = createBot();
  const untilTakedown = opts.until === 'takedown';
  let hits = 0;
  let takedowns = 0;
  let takedownKind: string | null = null;
  let attackStarts = 0;
  let snap = sim.snapshot();
  const done = () => (untilTakedown ? takedowns > 0 : hits > 0);
  while (!done() && !sim.isOver() && sim.tick < maxTicks) {
    const a = blankActions();
    bot.drive(snap, playerId, route, a);
    sim.step([botInput(a)]);
    for (const e of sim.events()) {
      if (e.type === 'hit' && e.actor === playerId) hits++;
      if (e.type === 'attackStart' && e.actor === playerId) attackStarts++;
      if (e.type === 'takedown' && e.actor === playerId) {
        takedowns++;
        takedownKind ??= String(e.data['kind']);
      }
    }
    snap = sim.snapshot();
  }
  return {
    seed,
    ticks: sim.tick,
    hits,
    takedowns,
    takedownKind,
    attackPresses: bot.stats().attackPresses,
    attackStarts,
    over: sim.isOver(),
  };
}
