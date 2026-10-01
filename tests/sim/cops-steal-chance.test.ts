/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The cops polish round (2026-10-01), after the integration skeptic's F1 and F2:
// - F1: only the Keys cop was armed, and the taser never shipped. Now every region's cop starts
//   with a weapon you can snatch (M4 cops-3: "a baton and taser you can steal"): Sgt. Pruitt the
//   baton, Deputy Lindqvist (Pacific Northwest) the taser, Officer Meter (San Francisco) the baton.
// - F2: steal chances were rare in a real race (1 steal window in 5 seeds). Moving in alongside,
//   the cop dropped back out of his reach whenever the player touched the brakes, so he hardly
//   ever swung. Now he keeps up beside a player who dabs them (sim/cops' move-in braking room).
//
// "A player who tries" is the dev bot plus three things a player after the cop's weapon does:
// - lets him catch up: rides a little slower than he does while he is behind (and at most 70 % of
//   his top speed once he is within 50 m), so he comes alongside;
// - keeps their hands free near him (no punches or kicks within 12 m);
// - presses attack REACTION_TICKS after his wind-up shows (his arm and the glint go up as it
//   starts), a plain human reaction.
// The races load the way the game loads them: every carried pack, release content only (no
// drafts), built with the app's own buildSimConfig and stream cache.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig, type SimSnapshot } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

const REGIONS = [
  { name: 'Florida Keys', event: 'm1-skeleton-sprint', cop: 'base:sgt-pruitt', weapon: 'base:baton' },
  {
    name: 'Pacific Northwest',
    event: 'region-pnw:pnw-fogline-run',
    cop: 'region-pnw:deputy-lindqvist',
    weapon: 'base:taser',
  },
  {
    name: 'San Francisco',
    event: 'region-sf:sf-hill-sprint',
    cop: 'region-sf:officer-meter',
    weapon: 'base:baton',
  },
] as const;

/** Seeded races per region. */
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
/** 250 ms from the wind-up showing to the press: a plain human reaction. [default] */
const REACTION_TICKS = 15;
const MAX_TICKS = 60 * 60 * 6;
/** The share of a region's seeded races in which a player who tries steals the cop's weapon. */
const MIN_STEAL_SHARE = 0.5;

function raceConfig(event: string, seed: number): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event), { seed, eventId: event });
}

interface StealRun {
  seed: number;
  /** Cop wind-ups with his weapon (each one a steal chance), and steals off him. */
  windups: number;
  steals: number;
  firstStealS: number | null;
  /** Steals made with a road weapon in hand (the thief dropped it: `data.dropped`). */
  fullHandSteals: number;
  busted: boolean;
  finished: boolean;
}

/**
 * `armed`: the player keeps trying with a road weapon in hand (the W-O polish run: a steal works
 * with full hands, dropping what you hold), until his first steal off the cop.
 */
function tryToSteal(event: string, seed: number, armed = false): StealRun {
  const config = raceConfig(event, seed);
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const copIds = config.riders.flatMap((r, i) => (r.faction === 'law' ? [i] : []));
  const bot = createBot();
  const run: StealRun = {
    seed,
    windups: 0,
    steals: 0,
    firstStealS: null,
    fullHandSteals: 0,
    busted: false,
    finished: false,
  };
  let snap: SimSnapshot = sim.snapshot();
  let pressAt = -1;
  const winding = new Set<number>();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    const me = snap.entities[playerId];
    if (me && (!me.heldWeapon || (armed && run.steals === 0))) {
      for (const id of copIds) {
        const cop = snap.entities[id];
        if (!cop || cop.mode !== 'Road' || !cop.heldWeapon) continue;
        const ahead = me.progress - cop.progress;
        if (Math.abs(ahead) < 12) {
          a.attack = false;
          a.kick = false;
        }
        if (cop.speed > 1 && ahead > -3) {
          const top = config.riders[id]?.bike.topSpeedMps ?? 30;
          const want = ahead > 50 ? Math.max(cop.speed - 8, 12) : top * 0.7;
          if (me.speed > want) a.throttle = 0;
          if (ahead > 50 && me.speed > want + 4) a.brake = Math.max(a.brake, 0.3);
        }
      }
      // A fresh press: released the tick before.
      if (sim.tick === pressAt - 1) a.attack = false;
      if (sim.tick === pressAt) {
        a.attack = true;
        pressAt = -1;
      }
    }
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const id of copIds) {
      const cop = snap.entities[id];
      const up = cop?.attackPhase === 'windup' && !!cop.heldWeapon;
      if (up && !winding.has(id)) {
        run.windups++;
        if (pressAt < 0) pressAt = sim.tick + REACTION_TICKS;
      }
      if (up) winding.add(id);
      else winding.delete(id);
    }
    for (const e of sim.events()) {
      const offCop = copIds.includes(e.target ?? -1);
      if (e.type === 'weaponGrab' && e.actor === playerId && e.data['source'] === 'steal' && offCop) {
        run.steals++;
        run.firstStealS ??= sim.tick / 60;
        if (e.data['dropped']) run.fullHandSteals++;
      }
      if (e.type === 'bust' && e.target === playerId) run.busted = true;
    }
    if (snap.race.finishOrder.includes(playerId)) run.finished = true;
  }
  return run;
}

describe("the law's weapons in a real race (release content, every region)", () => {
  it('each region has a cop who starts the race holding his weapon, the taser included', () => {
    for (const r of REGIONS) {
      const config = raceConfig(r.event, 1);
      const cops = config.riders.filter((d) => d.faction === 'law');
      expect(
        cops.map((d) => d.contentId),
        r.name,
      ).toEqual([r.cop]);
      expect(cops[0]?.startingWeapon, r.name).toBe(r.weapon);
      const sim = createSim(config);
      sim.step([toSimInput(emptyActions())]);
      const cop = sim.snapshot().entities[config.riders.findIndex((d) => d.contentId === r.cop)];
      expect(cop?.heldWeapon, r.name).toBe(r.weapon);
      // The cops' weapons never lie on the road: the only way to one is off a cop.
      const w = config.weapons.find((x) => x.contentId === r.weapon);
      expect(w?.roadsideWeight, r.name).toBe(0);
      expect(w?.steal, r.name).not.toBeNull();
    }
  });

  for (const r of REGIONS) {
    it(`${r.name}: a player who tries steals the cop's ${r.weapon.replace('base:', '')} in most races`, () => {
      const runs = SEEDS.map((seed) => tryToSteal(r.event, seed));
      const stole = runs.filter((x) => x.steals > 0);
      process.stdout.write(
        `[cops-steal] ${r.name}: a player who tries stole the ${r.weapon} in ${stole.length} of ${runs.length} races ` +
          `(${runs.reduce((n, x) => n + x.windups, 0)} wind-ups, ${runs.reduce((n, x) => n + x.steals, 0)} steals); ` +
          `busted ${runs.filter((x) => x.busted).length}, finished ${runs.filter((x) => x.finished).length}; ` +
          `per seed ${runs.map((x) => `${x.seed}:${x.windups}/${x.steals}${x.firstStealS === null ? '' : `@${x.firstStealS.toFixed(0)}s`}`).join(' ')}\n`,
      );
      expect(stole.length).toBeGreaterThanOrEqual(Math.ceil(runs.length * MIN_STEAL_SHARE));
    });
  }

  it('with a road weapon in hand, a player who tries still steals the cop’s weapon (he drops his own)', () => {
    const lines: string[] = [];
    let fullHands = 0;
    for (const r of REGIONS) {
      const runs = SEEDS.map((seed) => tryToSteal(r.event, seed, true));
      const stole = runs.filter((x) => x.steals > 0);
      const full = runs.reduce((n, x) => n + x.fullHandSteals, 0);
      fullHands += full;
      lines.push(
        `${r.name}: stole in ${stole.length} of ${runs.length} races, ${full} of them with a road weapon in hand ` +
          `(seeds ${
            runs
              .filter((x) => x.fullHandSteals > 0)
              .map((x) => x.seed)
              .join(', ') || 'none'
          })`,
      );
      expect(stole.length, r.name).toBeGreaterThanOrEqual(Math.ceil(runs.length * MIN_STEAL_SHARE));
    }
    for (const line of lines) process.stdout.write(`[cops-steal armed] ${line}\n`);
    // Seeded, so the same races every run: full-handed steals happen in a normal race.
    expect(fullHands).toBeGreaterThan(0);
  });
}, 900_000);
