/// <reference types="vite/client" />
// Every region the menu offers, raced headlessly through the game's real path (playtest 1c item 6,
// 2026-09-30: "Pnw and sf first then others"; docs/content-packs.md, "Region packs at runtime"):
// the carried packs combine into one registry, the picker's choice names the event, and
// createHeadlessRace builds the race with the app's own buildSimConfig and stream cache. The bot
// rides each region's race to the line, and a recorded region race replays to identical hashes
// with its road rebuilt from the recording's header alone.
import { describe, expect, it } from 'vitest';
import {
  createHeadlessRace,
  createStreamCache,
  regionChoices,
  resumeFromRecording,
  roadsForHeader,
} from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  createInputRecorder,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
} from '../../src/replay';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const CHOICES = regionChoices(REG);
const MAX_TICKS = 60 * 60 * 6;
/** Seeds tried per region until the bot finishes (the dev bot never evades the cop, so a seed can end in a bust). */
const SEEDS = [1, 2, 3, 4];

function botRace(eventId: string, seed: number) {
  const { sim, route, playerId, config } = createHeadlessRace({ seed, eventId }, { registry: REG });
  const bot = createBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  const kinds = new Set<string>();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    const input = toSimInput(actions);
    const tick = sim.tick;
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    problem ??= me ? moverProblem(me, route) : 'no player';
    for (const e of snap.entities) if (e.kind !== 'rider') kinds.add(e.contentId);
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
  }
  recorder.finish(sim.tick - 1, sim.hash());
  return {
    config,
    finishTick,
    ticks: sim.tick,
    problem,
    kinds,
    rec: recorder.current(),
    lengthM: config.route.length,
  };
}

describe('app: every region races headlessly through the real loader', () => {
  it('offers every region the packs ship, once each, in chapter order', () => {
    // Read from the packs, so a new region pack is offered the day it lands without editing this
    // test (the Keys, the Pacific Northwest and San Francisco today).
    const ids = CHOICES.map((c) => c.id);
    process.stdout.write(`[app-regions] offered: ${ids.join(', ')}\n`);
    expect([...ids].sort()).toEqual(Object.keys(REG.regions).sort());
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const chapters = CHOICES.map((c) => c.chapter);
    expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
  });

  for (const choice of CHOICES) {
    it(`${choice.name}: the bot finishes the region's race, and it replays to identical hashes`, () => {
      const tries: string[] = [];
      let done: ReturnType<typeof botRace> | null = null;
      for (const seed of SEEDS) {
        const res = botRace(choice.eventId, seed);
        expect(res.problem, `${choice.name} seed ${seed}`).toBeNull();
        expect(res.config.event.contentId).toBe(choice.eventId);
        const s = res.finishTick / 60;
        tries.push(
          `seed ${seed}: ${res.finishTick < 0 ? `no finish by tick ${res.ticks}` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`}`,
        );
        if (res.finishTick > 0) {
          done = res;
          break;
        }
      }
      process.stdout.write(
        `[app-regions] ${choice.name} (${choice.eventId}, ${((done?.lengthM ?? 0) / 1000).toFixed(2)} km): ${tries.join('; ')}\n`,
      );
      expect(done, `the bot finishes ${choice.name} on one of seeds ${SEEDS.join(', ')}`).not.toBeNull();
      if (!done?.rec) return;
      // The region's own traffic is on the road (not only base's).
      if (choice.packId !== 'base')
        expect(
          [...done.kinds].some((k) => k.startsWith(`${choice.packId}:`)),
          'region traffic spawns',
        ).toBe(true);
      // The recording, saved as the debug file saves it, replays from its header alone: the road
      // and route come from the header's own event and route, through the stream cache.
      const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(done.rec))) as unknown);
      const resumed = resumeFromRecording(saved, roadsForHeader(REG, createStreamCache()));
      expect(resumed.desync).toBeNull();
      expect(resumed.checked).toBeGreaterThan(Math.floor(done.finishTick / HASH_EVERY_TICKS) - 1);
    }, 600_000);
  }
});
