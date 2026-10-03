/// <reference types="vite/client" />
// Playtest 2 (2026-10-02, "I think I've only ever encountered cops once even though I've played a
// lot"; the COPS answer: "Mix of 2 and 1 (reliable but rich)"): every race in every region and on
// every route (each length and each real road) fields a patrol of one or two cops, and the bot
// meets a cop IN VIEW (within 60 m and not behind it: ahead or alongside, where the forward camera
// shows him) within the first 90 s, and a patrol cop lights up by then. Each race runs only until
// both (or 90 s), so the file stays cheap. The before-and-after numbers are in docs/milestones/M4.md
// (cops-3, "The patrol").
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, realRoutes, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const SEEDS = [1, 2, 3];
/** The maintainer's bar: met within the first 60 to 90 s. [default] 90. */
const MEET_BY_S = 90;
const SEEN_M = 60;

interface Meeting {
  patrol: number;
  seenS: number;
  /** Busted before 90 s (by the lot's cop, say): the race is over, so no patrol is reached. */
  busted: boolean;
}

function firstMeeting(eventId: string, seed: number, length?: string, route?: string): Meeting {
  const { sim, config, playerId } = createHeadlessRace(
    { seed, eventId, ...(length ? { length } : {}), ...(route ? { route } : {}) },
    { registry: REG },
  );
  const bot = createBot();
  const cops = config.riders.flatMap((d, i) => (d.faction === 'law' ? [i] : []));
  let patrol = 0;
  let busted = false;
  let snap = sim.snapshot();
  let seenS = Infinity;
  while (!sim.isOver() && sim.tick < MEET_BY_S * 60 && (seenS === Infinity || patrol === 0)) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    for (const e of sim.events()) {
      // Heat's roadblock (#338) takes its cops from the patrol too (sendRoadblock clears patrolAt),
      // so a patrol cop moved into a roadblock lights up as 'roadblock' instead (bundle 1: San
      // Francisco's seed 3 hit heat tier 3 at 27 s and both patrol cops went to the roadblock).
      if (e.type === 'siren' && (e.data['cause'] === 'patrol' || e.data['cause'] === 'roadblock')) patrol++;
      // Run W-T: Trooper Dalrymple at his bridge reads your speed on his radar, and lets you ride
      // by under the limit; his reading is the patrol met, siren or not.
      if (e.type === 'law' && e.data['kind'] === 'radar') patrol++;
      if (e.type === 'bust' && e.target === playerId) busted = true;
    }
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me) continue;
    const p = config.road.toWorld(me.road.edge, me.road.s, me.road.d, me.road.h);
    for (const id of cops) {
      const c = snap.entities[id];
      if (!c) continue;
      const q = config.road.toWorld(c.road.edge, c.road.s, c.road.d, c.road.h);
      const dist = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (seenS === Infinity && dist <= SEEN_M && c.progress >= me.progress - 4) seenS = sim.tick / 60;
    }
  }
  return { patrol, seenS, busted };
}

describe('playtest 2: a cop patrol in every race, met in view within 90 s', () => {
  for (const choice of regionChoices(REG)) {
    const event = lookup(REG.events, choice.eventId);
    const routes = [
      ...event.lengths.map((l) => ({ label: `${l.id} (${l.route})`, length: l.id, route: undefined })),
      ...realRoutes(REG, choice.eventId).map((r) => ({ label: r, length: undefined, route: r })),
    ];
    for (const r of routes) {
      it(`${choice.name}, ${r.label}: seeds ${SEEDS.join(', ')}`, () => {
        const met = SEEDS.map((seed) => firstMeeting(choice.eventId, seed, r.length, r.route));
        process.stdout.write(
          `cops patrol: ${choice.id} ${r.label}: first met in view at ${met.map((m) => `${m.seenS.toFixed(0)} s${m.busted ? ' (busted)' : ''}`).join(', ')}\n`,
        );
        for (const m of met) {
          expect(m.seenS).toBeLessThanOrEqual(MEET_BY_S);
          // A patrol cop lit up within 90 s too, unless a bust ended the race first.
          if (!m.busted) expect(m.patrol).toBeGreaterThanOrEqual(1);
        }
      });
    }
  }
});
