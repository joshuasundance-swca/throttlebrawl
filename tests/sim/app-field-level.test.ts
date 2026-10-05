/// <reference types="vite/client" />
// The career race's field level and a season's remix reach the race (playtest 3, round 1: "the
// field levels up every tier"; round 2: "Season 2+ with a harder field and remixed events"; round
// 3: "Season 2 on the finished save, plus a 'New career' button that keeps the old save as a backup
// code"). The oracle is the career's own numbers (`fieldLevel`, `remixPatch`): buildSimConfig must
// apply exactly what they say, and a race given neither must build the config it always built. Every
// expectation reads the packs and the career's output, so a retuned tier or a new event keeps them
// true.
import { describe, expect, it } from 'vitest';
import { createStreamCache } from '../../src/app';
import {
  buildSimConfig,
  copIds,
  eventLength,
  raceField,
  raceTimeOfDay,
  withEventPatch,
} from '../../src/app/config';
import { careerRaceSetup, restoreCareer, startNewCareer } from '../../src/app/career-flow';
import {
  applyEventPatch,
  careerDefs,
  eventPlan,
  fieldLevel,
  remixPatch,
  startCareer,
  startSeason,
  type CareerDef,
  type CareerNode,
} from '../../src/career';
import { lookup } from '../../src/content';
import type { EventPatch, FieldLevel } from '../../src/core';
import { decodeExportCode, DEFAULT_PROFILE, emptyRegion, type Profile } from '../../src/save';
import { createSim } from '../../src/sim/api';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);
const STREAMS = createStreamCache();
const SEED = 7;

/** A race's config the way the app builds a career race's. */
function build(node: CareerNode, extra: { fieldLevel?: FieldLevel; eventPatch?: EventPatch } = {}) {
  const event = lookup(REG.events, node.event);
  const length = eventLength(event, extra.eventPatch?.lengthId ?? node.length ?? undefined);
  return buildSimConfig(REG, STREAMS.forEvent(REG, node.event, length.id), {
    seed: SEED,
    eventId: node.event,
    length: length.id,
    ...extra,
  });
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The first career node (any region) whose event fields cops, and the first that fields none. */
const allNodes = DEFS.flatMap((def) => def.nodes.map((node) => ({ def, node })));
const withCops = allNodes.find(({ node }) => copIds(REG, node.event, 1).length > 0);
const regular = (def: CareerDef) => def.nodes.filter((n) => n.id !== def.boss);

/** A profile's maps with each list sorted: the save keeps sets, so their order is not the career's. */
const mapsOf = (p: Profile) =>
  Object.fromEntries(
    Object.entries(p.regions).map(([id, r]) => [
      id,
      Object.fromEntries(
        Object.entries(r).map(([k, v]: [string, unknown]) => [
          k,
          Array.isArray(v) ? [...(v as string[])].sort() : v,
        ]),
      ),
    ]),
  );

/** Season 1 with every region boss down: a finished save. */
function finished(): Profile {
  const p = startCareer(DEFS, { ...DEFAULT_PROFILE });
  return {
    ...p,
    cash: 40_000,
    history: [
      {
        event: DEFS[0]?.nodes[0]?.event ?? 'x',
        node: DEFS[0]?.nodes[0]?.id ?? null,
        region: DEFS[0]?.regionId ?? 'x',
        place: 1,
        outcome: 'won',
        cash: 900,
        takedowns: 0,
        build: 'test',
        at: '2026-10-01T00:00:00.000Z',
      },
    ],
    regions: Object.fromEntries(
      DEFS.map((d) => [
        d.regionId,
        { ...emptyRegion(), won: d.nodes.map((n) => n.id), finaleBeaten: true, tier: d.tiers.length },
      ]),
    ),
  };
}

describe('buildSimConfig without a field level or a patch', () => {
  it("builds the event file's own race: its pace, its riders' own bikes and numbers, no level", () => {
    for (const { node } of allNodes.slice(0, 6)) {
      const event = lookup(REG.events, node.event);
      const plain = build(node);
      expect('level' in plain.event, node.id).toBe(false);
      expect(plain.event.paceMps, node.id).toBe(event.field.paceMps ?? 30);
      expect(plain.event.kind, node.id).toBe(event.kind);
      for (const r of plain.riders.filter((x) => x.controller.kind === 'ai')) {
        const file = REG.riders[r.contentId];
        expect(r.healthMax, r.contentId).toBe(file?.stats?.healthMax ?? 100);
        expect(r.power, r.contentId).toBe(file?.stats?.power ?? 1);
      }
      expect(build(node), node.id).toEqual(plain);
    }
  });
});

describe('the field level', () => {
  // The highest-tier regular node of each region: the hardest field its career builds.
  const picks = DEFS.flatMap((def) => {
    const top = [...regular(def)].sort((a, b) => b.tier - a.tier)[0];
    return top ? [{ def, node: top }] : [];
  });

  it('there is a node to check in every region', () => {
    expect(picks.length).toBe(DEFS.length);
  });

  for (const { def, node } of picks) {
    describe(`${def.regionName}, ${node.id}`, () => {
      const level = fieldLevel(REG, DEFS, def, node, 1) as FieldLevel;
      const base = build(node);
      const leveled = build(node, { fieldLevel: level });
      const aiOf = (c: typeof base) => c.riders.filter((r) => r.controller.kind === 'ai');

      it('sets the event pace and the rival bike from the level, and leaves the player alone', () => {
        expect(leveled.event.paceMps).toBe(level.paceMps);
        const top = REG.bikes[level.rivalBike ?? '']?.handling.topSpeedMps ?? 0;
        expect(aiOf(leveled).length).toBeGreaterThan(0);
        for (const r of aiOf(leveled)) {
          expect(r.bike.contentId).toBe(level.rivalBike);
          expect(r.bike.topSpeedMps).toBe(Math.max(top, level.paceMps));
        }
        expect(leveled.riders.find((r) => r.controller.kind === 'player')).toEqual(
          base.riders.find((r) => r.controller.kind === 'player'),
        );
      });

      it("scales each rival's health and power, and nothing else about them", () => {
        const ai = aiOf(leveled);
        const was = aiOf(base);
        expect(ai.map((r) => r.contentId)).toEqual(was.map((r) => r.contentId));
        ai.forEach((r, i) => {
          const file = was[i];
          expect(r.healthMax).toBe(Math.round((file?.healthMax ?? 0) * level.healthScale));
          // The level's power rides apart from the rider's own, and a level of 1 adds nothing.
          expect(r.power).toBe(file?.power);
          if (round3(level.powerScale) === 1) expect('levelPower' in r).toBe(false);
          else expect(r.levelPower).toBe(round3(level.powerScale));
          expect(r.controller).toEqual(file?.controller);
          expect(r.toughness).toBe(file?.toughness);
        });
      });

      it('a level whose power scale is 1 builds each rival the way the file has it', () => {
        const neutral = build(node, { fieldLevel: { ...level, powerScale: 1 } });
        aiOf(neutral).forEach((r, i) => {
          expect('levelPower' in r).toBe(false);
          expect(r.power).toBe(aiOf(base)[i]?.power);
        });
      });

      it("carries the level's aggression and signature scales to the sim", () => {
        expect(leveled.event.level).toEqual({
          aggressionScale: level.aggressionScale,
          signatureGapScale: level.signatureGapScale,
        });
      });

      it('still builds a race the sim accepts and steps', () => {
        const sim = createSim(leveled);
        for (let i = 0; i < 60; i++) sim.step([{ steer: 0, throttle: 1, brake: 0, attack: false } as never]);
        expect(sim.tick).toBe(60);
      });
    });
  }

  it("the cops ride the level's bike, capped, and fine and cite at the level's scale", () => {
    expect(withCops, 'a career event that fields cops').toBeDefined();
    if (!withCops) return;
    const { def, node } = withCops;
    const level = fieldLevel(REG, DEFS, def, node, 1) as FieldLevel;
    const base = build(node);
    const leveled = build(node, { fieldLevel: level });
    const cops = leveled.riders.filter((r) => r.controller.kind === 'cop');
    const was = base.riders.filter((r) => r.controller.kind === 'cop');
    expect(cops.length).toBeGreaterThan(0);
    const top = REG.bikes[level.copBike ?? '']?.handling.topSpeedMps ?? 0;
    cops.forEach((c, i) => {
      const file = was[i];
      const scale = file?.law?.pursuitSpeedScale ?? 1;
      expect(c.bike.contentId).toBe(level.copBike);
      expect(c.bike.topSpeedMps).toBe(Math.min(top * scale, level.copTopCapMps ?? Infinity));
      expect(c.law?.fineCash).toBe(Math.round((file?.law?.fineCash ?? 0) * level.fineScale));
      // A citation habit's cash scales with the fine, so the banner and the ledger agree.
      const each = file?.law?.habit?.params['cashEach'];
      if (each !== undefined)
        expect(c.law?.habit?.params['cashEach']).toBe(Math.round(each * level.fineScale));
      // The rest of the law block is the file's.
      expect(c.law?.bustRadiusM).toBe(file?.law?.bustRadiusM);
    });
  });

  it('a later tier or season is never a weaker config: the pace does not fall', () => {
    for (const def of DEFS) {
      const nodes = regular(def);
      const paces = [...nodes]
        .sort((a, b) => a.tier - b.tier)
        .map((n) => build(n, { fieldLevel: fieldLevel(REG, DEFS, def, n, 1) as FieldLevel }).event.paceMps);
      paces.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(paces[i - 1] ?? 0));
    }
  });
});

describe("a season's patch", () => {
  const keys = DEFS[0] as CareerDef;
  const season2 = startSeason(DEFS, finished(), 123);
  const patches = keys.nodes.map((n) => ({
    node: n,
    patch: remixPatch(REG, DEFS, keys, n, 2, season2.seasonSeed, season2.grudges) as EventPatch,
  }));

  it('is there for every node in Season 2, and applies exactly as the career says it does', () => {
    expect(patches.every((p) => p.patch !== null)).toBe(true);
    for (const { node, patch } of patches) {
      const event = lookup(REG.events, node.event);
      expect(withEventPatch(event, patch), node.id).toEqual(applyEventPatch(event, patch));
    }
  });

  it('a patch of nothing is the event as it is', () => {
    const event = lookup(REG.events, (keys.nodes[0] as CareerNode).event);
    expect(withEventPatch(event, undefined)).toBe(event);
    expect(withEventPatch(event, null)).toBe(event);
  });

  it("sets the field in the patch's order, the kind, the prizes and the weird-event cap", () => {
    let swapped = 0;
    for (const { node, patch } of patches) {
      const event = lookup(REG.events, node.event);
      const config = build(node, { eventPatch: patch });
      const ai = config.riders.filter((r) => r.controller.kind === 'ai').map((r) => r.contentId);
      expect(ai, `${node.id} field`).toEqual(patch.riders ?? raceField(REG, node.event, SEED));
      expect(config.event.kind, `${node.id} kind`).toBe(patch.kind ?? event.kind);
      expect(config.event.byPlaceCash, `${node.id} prizes`).toEqual(
        patch.byPlaceCash ?? event.rewards.byPlaceCash,
      );
      if (patch.kind && patch.kind !== event.kind) swapped++;
      if (patch.maxModifiers !== undefined)
        expect(config.event.modifiersPerRace, `${node.id} modifiers`).toBe(patch.maxModifiers);
    }
    // The seed 123 remix swaps at least one kind on the Keys map: the check above ran on a swap.
    expect(swapped).toBeGreaterThan(0);
  });

  it("the time of day is the patch's, so the road events and the light read it", () => {
    for (const { node, patch } of patches) {
      const event = lookup(REG.events, node.event);
      const patched = withEventPatch(event, patch);
      expect(raceTimeOfDay(REG, node.event, SEED, false, patched)).toBe(patch.timeOfDay ?? event.timeOfDay);
    }
    // Without the patched event it reads the file's own, as it always did.
    const { node } = patches[0] as (typeof patches)[number];
    expect(raceTimeOfDay(REG, node.event, SEED)).toBe(String(lookup(REG.events, node.event).timeOfDay));
  });

  it("races the patch's length when it names one", () => {
    const longs = patches.filter((p) => p.patch.lengthId);
    for (const { node, patch } of longs)
      expect(build(node, { eventPatch: patch }).event.lengthId, node.id).toBe(patch.lengthId);
  });

  it("a grudge match keeps its rival's rule only when the patch leaves the rule in", () => {
    const grudge = allNodes.find(({ node }) => lookup(REG.events, node.event).kind === 'grudge-match');
    expect(grudge, 'a grudge match').toBeDefined();
    if (!grudge) return;
    const { node } = grudge;
    const event = lookup(REG.events, node.event);
    const rival = String(event.rules.rival);
    const { rule: _rule, ...rest } = event.rules;
    expect(_rule === undefined || typeof _rule === 'string').toBe(true);
    const without = build(node, { eventPatch: { rules: { ...rest, rival } } });
    expect(without.event.grudgeRule).toBeUndefined();
    const withRule = build(node, { eventPatch: { rules: { ...event.rules } } });
    expect(withRule.event.grudgeRule === undefined).toBe(event.rules.rule === undefined);
  });
});

describe("the career race's setup (what the app passes buildSimConfig)", () => {
  const keys = DEFS[0] as CareerDef;
  const node = keys.nodes.find((n) => n.id !== keys.boss) as CareerNode;

  it("Season 1: the node's own plan and length, no patch, and the field level at the node's tier", () => {
    const setup = careerRaceSetup(REG, DEFS, startCareer(DEFS, { ...DEFAULT_PROFILE }), keys, node);
    expect(setup.patch).toBeNull();
    expect(setup.fieldLevel).toEqual(fieldLevel(REG, DEFS, keys, node, 1));
    expect(setup.plan.name).toBeTruthy();
  });

  it('Season 2: the remix patch, the patched plan, and the harder field of the season', () => {
    const profile = startSeason(DEFS, finished(), 123);
    expect(profile.season).toBe(2);
    const setup = careerRaceSetup(REG, DEFS, profile, keys, node);
    expect(setup.patch).toEqual(remixPatch(REG, DEFS, keys, node, 2, profile.seasonSeed, profile.grudges));
    expect(setup.fieldLevel).toEqual(fieldLevel(REG, DEFS, keys, node, 2));
    const s1 = fieldLevel(REG, DEFS, keys, node, 1) as FieldLevel;
    expect(setup.fieldLevel?.paceMps).toBeGreaterThan(s1.paceMps);
    const file = eventPlan(REG, node.event);
    expect(setup.plan.timeOfDay).toBe(setup.patch?.timeOfDay ?? file.timeOfDay);
  });
});

describe('the Start Season and New career buttons', () => {
  it('Start Season keeps the garage and cash and resets the maps (the career says how)', () => {
    const before = finished();
    const after = startSeason(DEFS, before, 99);
    expect(after.season).toBe(2);
    expect(after.cash).toBe(before.cash);
    expect(after.bikes).toEqual(before.bikes);
    expect(DEFS.every((d) => after.regions[d.regionId]?.finaleBeaten === false)).toBe(true);
  });

  it('New career keeps the old save as a backup code that decodes to that career', async () => {
    const old = finished();
    const at = '2026-10-04T12:00:00.000Z';
    const next = await startNewCareer(DEFS, old, 'test-build', at);
    expect(next.kept).toBe(true);
    expect(next.profile.season).toBe(1);
    expect(next.profile.history).toEqual([]);
    expect(next.profile.careerBackups).toHaveLength(1);
    const backup = next.profile.careerBackups[0];
    expect(backup).toMatchObject({ at, season: old.season });
    const decoded = await decodeExportCode(backup?.code ?? '');
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok') return;
    expect(decoded.profile.cash).toBe(old.cash);
    expect(decoded.profile.history).toEqual(old.history);
    expect(mapsOf(decoded.profile)).toEqual(mapsOf(old));
    expect(decoded.profile.careerBackups).toEqual([]);
  });

  it('New career with no race run yet starts nothing over, so a stray tap never costs a backup', async () => {
    const fresh = startCareer(DEFS, { ...DEFAULT_PROFILE });
    const next = await startNewCareer(DEFS, fresh, 'test-build', 't');
    expect(next.kept).toBe(false);
    expect(next.profile).toBe(fresh);
  });

  it('restoring a backup brings the old career back and keeps the one it replaces as a backup', async () => {
    const old = finished();
    const first = await startNewCareer(DEFS, old, 'test-build', '2026-10-04T12:00:00.000Z');
    // Play one race in the new career, then restore the old one.
    const played: Profile = {
      ...first.profile,
      history: [...old.history],
      cash: first.profile.cash + 500,
    };
    const code = first.profile.careerBackups[0]?.code ?? '';
    const decoded = await decodeExportCode(code);
    if (decoded.kind !== 'ok') throw new Error('backup did not decode');
    const restored = await restoreCareer(DEFS, played, decoded.profile, 'test-build', 't2');
    expect(restored.cash).toBe(old.cash);
    expect(mapsOf(restored)).toEqual(mapsOf(old));
    // The career it replaced is a backup now, and the old backup is still there.
    expect(restored.careerBackups.length).toBeGreaterThanOrEqual(2);
    const kept = await Promise.all(restored.careerBackups.map((b) => decodeExportCode(b.code)));
    expect(kept.some((k) => k.kind === 'ok' && k.profile.cash === played.cash)).toBe(true);
  });

  it('restoring over a career with no race run keeps no backup of it', async () => {
    const old = finished();
    const first = await startNewCareer(DEFS, old, 'test-build', 't');
    const decoded = await decodeExportCode(first.profile.careerBackups[0]?.code ?? '');
    if (decoded.kind !== 'ok') throw new Error('backup did not decode');
    const restored = await restoreCareer(DEFS, first.profile, decoded.profile, 'test-build', 't2');
    expect(restored.careerBackups).toHaveLength(first.profile.careerBackups.length);
  });
});
