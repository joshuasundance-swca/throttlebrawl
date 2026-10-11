import { describe, expect, it } from 'vitest';
import { resultView, teaserView } from '../../src/app/career-flow';
import {
  applyWin,
  careerDefs,
  careerView,
  createRaceLog,
  eventPlan,
  objectiveText,
  progressOf,
  settleRace,
  startCareer,
} from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../src/sim/api';
import { REG } from './career-harness';

const defs = careerDefs(REG);
const selected = defs.find((d) =>
  d.nodes.some((n) => n.id === d.boss && n.event === 'region-sf:sf-boss-pivot'),
);
if (!selected) throw new Error('No canonical Pivot finale');
const def = selected;
const boss = def.nodes.find((n) => n.id === def.boss);
if (!boss) throw new Error('No finale node');
const node = boss,
  plan = eventPlan(REG, node.event);
const rival = plan.rules.rival;
if (!rival) throw new Error('No named rival');
const authoredRival = REG.riders[rival];
if (!authoredRival?.name || authoredRival.personality?.signature !== 'pivot')
  throw new Error('No named Pivot signature rider');
const rivalName = authoredRival.name;
const count = Number(
  plan.objectives.find((o) => o.required && o.kind === 'beat-rival')?.params['orKnockdowns'],
);
if (!(count > 0)) throw new Error('No alternative falls victory');
const awardEntries = def.unlocks
  .filter((u) => u.kind === 'boss-beaten' && REG.bikes[u.grant])
  .map((u) => {
    const bike = REG.bikes[u.grant];
    if (!bike?.name) throw new Error(`No authored bike award name for ${u.grant}`);
    return { key: u.grant, name: bike.name };
  });
const awards = awardEntries.map((award) => award.key);
const ME = 1,
  BOSS = 0,
  NPC = 2,
  COP = 3;
function ready() {
  let profile = startCareer(defs, { ...DEFAULT_PROFILE });
  for (const d of defs) {
    if (d === def) break;
    for (const n of d.nodes)
      profile = {
        ...profile,
        regions: {
          ...profile.regions,
          [d.regionId]: applyWin(d, progressOf(d, profile.regions), n).progress,
        },
      };
  }
  for (const n of def.nodes.filter((n) => n.id !== node.id))
    profile = {
      ...profile,
      regions: {
        ...profile.regions,
        [def.regionId]: applyWin(def, progressOf(def, profile.regions), n).progress,
      },
    };
  return profile;
}
function race() {
  const log = createRaceLog({
    playerId: ME,
    rules: plan.rules,
    objectives: plan.objectives,
    routeId: 'boss-test',
    roadIds: [],
    secrets: [],
  });
  let tick = 0;
  const order: number[] = [];
  const entity = (id: number): EntitySnapshot => ({
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId:
      id === BOSS
        ? rival!
        : id === ME
          ? 'base:player'
          : id === COP
            ? 'base:sgt-pruitt'
            : (plan.field.find((r) => r !== rival) ?? 'base:player'),
    name: '',
    faction: id === COP ? 'law' : 'rider',
    slot: id === ME ? 0 : -1,
    throttle: 1,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 1000,
    place: order.indexOf(id) + 1,
    finished: order.includes(id),
  });
  const step = (events: Omit<SimEvent, 'tick'>[] = []) => {
    tick++;
    const snap: SimSnapshot = {
      tick,
      timeScale: 1,
      entities: [BOSS, ME, NPC, COP].map(entity),
      race: { over: false, routeLength: 2000, finishOrder: [...order] },
    };
    log.note(
      events.map((e) => ({ ...e, tick })),
      snap,
    );
  };
  const fall = (kind: string, actor = ME, target = BOSS) => ({
    type: 'takedown' as const,
    actor,
    target,
    data: { kind },
  });
  const finish = (actor: number) => {
    order.push(actor);
    step([{ type: 'finish', actor, data: { place: order.length, classified: false } }]);
  };
  const settle = (profile = ready()) =>
    settleRace(profile, {
      reg: REG,
      def,
      node,
      plan,
      status: log.status(),
      tally: log.tally(),
      build: 'test',
      at: 'test',
    });
  step();
  return { log, step, fall, finish, settle };
}
describe('the authored Pivot finale scoring and final payoff', () => {
  it.each(['health', 'traffic', 'scenery'])('counts the authored threshold including %s falls', (kind) => {
    expect(count).toBe(3); // This encounter's approved three-fall contract, derived from its objective.
    const r = race();
    for (let i = 0; i < count - 1; i++) r.step([r.fall(kind)]);
    expect(r.log.status().state).toBe('running');
    r.step([r.fall(kind)]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
    expect(r.log.tally().finished).toBe(false);
  });
  it('rejects other victims and NPC attribution, with a positive health-fall control', () => {
    const r = race();
    for (let i = 0; i < count; i++) r.step([r.fall('health', ME, NPC), r.fall('health', NPC)]);
    expect(r.log.status().state).toBe('running');
    for (let i = 0; i < count; i++) r.step([r.fall('health')]);
    expect(r.log.status().state).toBe('won');
  });
  it('allows a clean finish ahead, loses to rival first, and leaves completion closed on loss', () => {
    const win = race();
    win.finish(ME);
    expect(win.log.status().state).toBe('won');
    const loss = race();
    loss.finish(BOSS);
    expect(loss.log.status()).toMatchObject({ state: 'lost', endNow: true });
    const before = ready(),
      lost = loss.settle(before);
    expect(lost.report).toMatchObject({ map: null, unlocked: [], teaser: null });
    expect(progressOf(def, lost.profile.regions).finaleBeaten).toBe(false);
    expect(lost.profile.bikes.owned).toEqual(before.bikes.owned);
    expect(teaserView(defs, lost.report)).toBeNull();
  });
  it.each(['before', 'same'] as const)('a bust %s the decisive tick cannot complete the career', (when) => {
    const r = race();
    for (let i = 0; i < count - 1; i++) r.step([r.fall('health')]);
    const bust = { type: 'bust' as const, actor: COP, target: ME, data: { fineCash: 100 } };
    if (when === 'before') r.step([bust]);
    r.step([r.fall('health'), ...(when === 'same' ? [bust] : [])]);
    expect(r.log.status().state).toBe('lost');
    const before = ready(),
      after = r.settle(before);
    expect(after.report).toMatchObject({
      won: false,
      outcome: 'busted',
      map: null,
      unlocked: [],
      teaser: null,
    });
    expect(after.profile.bikes.owned).toEqual(before.bikes.owned);
    expect(progressOf(def, after.profile.regions).finaleBeaten).toBe(false);
    expect(
      resultView(REG, def, plan, r.log.status(), after.report, 0, r.log.tally().racers, after.profile, defs)
        .title,
    ).toBe('BUSTED');
  });
  it('grants all authored ending lines, free play and the actual award once, without a new region', () => {
    const before = ready(),
      win = race();
    win.finish(ME);
    const first = win.settle(before);
    expect(first.report.map?.finale).toBe(true);
    expect(first.report.teaser).toEqual({ lines: def.ending.lines, next: null, freePlayAfter: true });
    expect(teaserView(defs, first.report)).toEqual({ lines: def.ending.lines, next: null });
    expect(def.ending.lines.length).toBeGreaterThan(0);
    expect(awards.length).toBeGreaterThan(0);
    expect(first.report.unlocked).toEqual(awards.filter((key) => !before.bikes.owned.includes(key)));
    for (const key of awards) expect(first.profile.bikes.owned).toContain(key);
    const replay = win.settle(first.profile);
    expect(replay.report).toMatchObject({ replay: true, unlocked: [], teaser: null });
    expect(replay.profile.bikes.owned).toEqual(first.profile.bikes.owned);
    expect(replay.profile.oncePerCareer).toEqual(first.profile.oncePerCareer);
  });
  it('names Pivot, both victory routes and the real final payoff on cards and results', () => {
    const profile = ready();
    const card = careerView(REG, defs, profile, def.regionId)
      .tiers.flatMap((t) => t.nodes)
      .find((c) => c.id === node.id);
    expect(card?.kindLabel).toBe(`Region boss · ${rivalName}`);
    expect(card?.objective).toContain(objectiveText(REG, plan));
    expect(card?.objective).toContain('Win for free play');
    for (const award of awardEntries) expect(card?.objective).toContain(award.name);
    const r = race();
    r.finish(ME);
    const first = r.settle(profile);
    const view = resultView(
      REG,
      def,
      plan,
      r.log.status(),
      first.report,
      1,
      r.log.tally().racers,
      first.profile,
      defs,
    );
    expect(view.title).toBe(`${rivalName.toUpperCase()} BEATEN`);
    expect(view.objectives.find((o) => o.required)?.label).toBe(objectiveText(REG, plan));
    expect(view.news).toContain('Free play is open.');
    for (const award of awardEntries) expect(view.news.some((s) => s.includes(award.name))).toBe(true);
    const replayCard = careerView(REG, defs, first.profile, def.regionId)
      .tiers.flatMap((t) => t.nodes)
      .find((c) => c.id === node.id);
    expect(replayCard?.objective).toContain('Free play is open.');
    expect(replayCard?.objective).not.toContain('Win for free play');
  });
});
