import { describe, expect, it } from 'vitest';
import { resultView, teaserView } from '../../src/app/career-flow';
import {
  applyWin,
  careerDefs,
  careerView,
  createRaceLog,
  eventPlan,
  progressOf,
  regionOpen,
  settleRace,
  startCareer,
} from '../../src/career';
import { DEFAULT_PROFILE } from '../../src/save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../src/sim/api';
import { REG } from './career-harness';

const defs = careerDefs(REG);
const selectedDef = defs.find((d) =>
  d.nodes.some((n) => n.id === d.boss && eventPlan(REG, n.event).rules.rule === 'timber'),
);
if (!selectedDef) throw new Error('No Timber regional boss');
const def = selectedDef;
const selectedNode = def.nodes.find((n) => n.id === def.boss);
if (!selectedNode) throw new Error('No Timber boss node');
const node = selectedNode;
const plan = eventPlan(REG, node.event);
const selectedRival = plan.rules.rival;
if (!selectedRival) throw new Error('No named Timber rival');
const rival = selectedRival;
const required = plan.objectives.find((o) => o.required && o.kind === 'beat-rival');
const count = Number(required?.params['orKnockdowns']);
if (!(count > 0)) throw new Error('No environmental alternative');
const selectedNext = defs.find((d) => d.regionKey === def.ending.next);
if (!selectedNext) throw new Error('No next chapter');
const next = selectedNext;
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
        ? rival
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

describe('the authored Timber regional boss', () => {
  it('counts exactly the authored number of player-attributed traffic/scenery falls', () => {
    const r = race();
    for (let i = 0; i < count - 1; i++) r.step([r.fall(i % 2 ? 'scenery' : 'traffic')]);
    expect(r.log.status().state).toBe('running');
    r.step([r.fall('scenery')]);
    expect(r.log.status()).toMatchObject({ state: 'won', endNow: true });
    expect(r.log.tally().finished).toBe(false);
  });
  it('rejects health-only falls, the wrong victim and NPC attribution, with a positive control', () => {
    const r = race();
    for (let i = 0; i < count; i++)
      r.step([r.fall('health'), r.fall('traffic', ME, NPC), r.fall('scenery', NPC)]);
    expect(r.log.status().state).toBe('running');
    for (let i = 0; i < count; i++) r.step([r.fall('traffic')]);
    expect(r.log.status().state).toBe('won');
  });
  it('allows a clean finish ahead and loses when the named boss finishes first', () => {
    const win = race();
    win.finish(ME);
    expect(win.log.status().state).toBe('won');
    const loss = race();
    loss.finish(BOSS);
    expect(loss.log.status()).toMatchObject({ state: 'lost', endNow: true });
  });
  it('a bust on the decisive tick wins no map, chapter, bike or teaser', () => {
    const r = race();
    for (let i = 0; i < count - 1; i++) r.step([r.fall('traffic')]);
    r.step([r.fall('scenery'), { type: 'bust', actor: COP, target: ME, data: { fineCash: 100 } }]);
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
    expect(regionOpen(defs, after.profile, next)).toBe(false);
  });
  it('a loss leaves the next chapter shut; a win grants its rewards and teaser once', () => {
    const before = ready();
    expect(regionOpen(defs, before, next)).toBe(false);
    const loss = race();
    loss.finish(BOSS);
    expect(loss.settle(before).report).toMatchObject({ map: null, unlocked: [], teaser: null });
    const win = race();
    win.finish(ME);
    const first = win.settle(before);
    expect(first.report.map?.finale).toBe(true);
    expect(regionOpen(defs, first.profile, next)).toBe(true);
    expect(teaserView(defs, first.report)?.next?.name).toBe(next.regionName);
    expect(first.report.unlocked).toEqual(
      def.unlocks
        .filter(
          (u) => u.kind === 'boss-beaten' && REG.bikes[u.grant] && !before.bikes.owned.includes(u.grant),
        )
        .map((u) => u.grant),
    );
    const replay = win.settle(first.profile);
    expect(replay.report).toMatchObject({ replay: true, unlocked: [], teaser: null });
    expect(replay.profile.bikes.owned).toEqual(first.profile.bikes.owned);
  });
  it('names the region boss and chapter stake before and after victory', () => {
    const profile = ready();
    const card = careerView(REG, defs, profile, def.regionId)
      .tiers.flatMap((t) => t.nodes)
      .find((c) => c.id === node.id);
    expect(card?.kindLabel).toBe(`Region boss · ${REG.riders[rival]?.name}`);
    expect(card?.objective).toContain(`Win to open ${next.regionName}.`);
    const r = race();
    r.finish(ME);
    const settled = r.settle(profile);
    const view = resultView(
      REG,
      def,
      plan,
      r.log.status(),
      settled.report,
      1,
      r.log.tally().racers,
      settled.profile,
      defs,
    );
    expect(view.title).toBe(`${REG.riders[rival]?.name.toUpperCase()} BEATEN`);
    expect(view.news).toContain(`${next.regionName} is open.`);
  });
});
