import { describe, expect, it } from 'vitest';
import type { ContentRegistry } from '../content';
import { DEFAULT_PROFILE, type Profile } from '../save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import {
  applyWin,
  buyBike,
  buyPaint,
  careerStarted,
  createOnboarding,
  currentPaintHex,
  firstRace,
  garageBikes,
  garagePaints,
  lockReason,
  mapTally,
  nodeState,
  paintBike,
  progressOf,
  rideBike,
  settleGrudges,
  settleRace,
  startCareer,
  suggestedNode,
  tierOpen,
  tierReached,
  withPromptsSeen,
  type CareerDef,
  type CareerNode,
  type EventPlan,
  type RaceStatus,
  type RaceTally,
} from './index';

// The career's rules on a small hand-made map (docs/milestones/M4.md, career-1: "unit tests cover
// each advance rule and each when.kind"; a Road Trip fine never takes cash below $0; a grudge built
// in one race is there for the next). The real maps are checked in tests/sim/career-*.test.ts.

const node = (id: string, tier: number, over: Partial<CareerNode> = {}): CareerNode => ({
  id,
  event: `base:ev-${id}`,
  length: null,
  tier,
  road: `road-${id}`,
  s: 10,
  requires: [],
  opens: [],
  claims: [],
  ...over,
});

const DEF: CareerDef = {
  key: 'base:test-circuit',
  pack: 'base',
  name: 'Test Circuit',
  regionKey: 'base:florida-keys',
  regionId: 'florida-keys',
  regionName: 'The Keys',
  chapter: 1,
  startingCash: 500,
  startingBike: 'base:rustbucket-400',
  tutorialNode: 'a',
  firstRun: 'race-first',
  tiers: [
    { id: 't1', name: 'Tourist Season', requiredWins: 2 },
    { id: 't2', name: 'Hurricane Season', requiredWins: 1 },
    { id: 't3', name: 'The Drawbridge', requiredWins: 0 },
  ],
  nodes: [
    node('a', 0, { opens: ['road-b', 'road-c'], claims: ['road-a2'] }),
    node('b', 0, { requires: ['a'] }),
    node('c', 0, { requires: ['a'] }),
    node('d', 1),
    node('e', 1, { requires: ['d'] }),
    node('boss', 2),
  ],
  boss: 'boss',
  secrets: [
    {
      id: 'cooler',
      kind: 'stash',
      name: 'A cooler of tips',
      road: 'road-a',
      s: 0,
      ref: '',
      cash: 400,
      atFraction: null,
    },
    {
      id: 'cut',
      kind: 'shortcut',
      name: 'The cut',
      road: 'road-a',
      s: 0,
      ref: 'run#cut',
      cash: 0,
      atFraction: null,
    },
  ],
  shop: [
    { bike: 'base:rustbucket-400', priceCash: 0, unlockTier: 0 },
    { bike: 'base:moped', priceCash: 900, unlockTier: 0 },
    { bike: 'base:streetfighter-750', priceCash: 6000, unlockTier: 1 },
  ],
  paints: [
    { id: 'flamingo-pink', name: 'Flamingo Pink', hex: '#f28fb1', priceCash: 300, unlockTier: 0 },
    { id: 'motel-teal', name: 'Motel Pool Teal', hex: '#2ab7a9', priceCash: 500, unlockTier: 1 },
  ],
  unlocks: [
    { grant: 'base:golf-cart', kind: 'boss-beaten', ref: 'boss' },
    { grant: 'base:moped', kind: 'event-won', ref: 'base:ev-c' },
  ],
  ending: {
    lines: ['THE DRAWBRIDGE GOES UP.', 'NEXT: THE RAIN.'],
    next: 'region-pnw:pacific-northwest',
    freePlayAfter: true,
  },
  startRoads: ['road-a'],
};

const bike = (name: string, cls: string, top: number, tags: string[] = []) => ({
  type: 'bike',
  id: name,
  name,
  class: cls,
  tags,
  handling: { topSpeedMps: top, accelMps2: 5, brakeMps2: 9, steerRateMps: 5, massKg: 180 },
  engineSound: { preset: 'single-thump' },
});
const REG = {
  bikes: {
    'base:rustbucket-400': bike('Rustbucket 400', 'rat', 44.7),
    'base:moped': bike('Rental Moped', 'moped', 22.4),
    'base:streetfighter-750': bike('Streetfighter 750', 'sport', 55.9),
    'base:golf-cart': bike('Golf Cart', 'golf-cart', 11.2, ['secret', 'joke']),
  },
  riders: {
    'base:kevin-from-accounting': {
      grudge: {
        gainPerHitTaken: 2,
        gainPerTakedownSuffered: 4,
        gainPerWeaponStolen: 3,
        decayPerRace: 0,
        max: 10,
      },
    },
  },
} as unknown as ContentRegistry;

const plan = (key: string, over: Partial<EventPlan> = {}): EventPlan => ({
  key,
  name: key,
  kind: 'classic-race',
  rules: { kind: 'classic-race' },
  objectives: [],
  tier: 1,
  finale: false,
  byPlaceCash: [1500, 900, 600, 300, 150],
  timeOfDay: 'golden-hour',
  lengths: [{ id: 'standard', route: 'base:run' }],
  field: [],
  ...over,
});

const status = (state: RaceStatus['state'], objectives: RaceStatus['objectives'] = []): RaceStatus => ({
  state,
  endNow: false,
  objectives,
  headline: '',
});

const tally = (over: Partial<RaceTally> = {}): RaceTally => ({
  finished: true,
  place: 1,
  racers: 5,
  busted: false,
  fineCash: 0,
  takedowns: 0,
  style: {},
  styleCash: 0,
  toRivals: {},
  branches: [],
  secrets: [],
  field: [],
  player: 'base:player',
  ...over,
});

const fresh = (): Profile => startCareer([DEF], { ...DEFAULT_PROFILE });
const winNode = (p: Profile, id: string, t: Partial<RaceTally> = {}) => {
  const n = DEF.nodes.find((x) => x.id === id);
  if (!n) throw new Error(id);
  return settleRace(p, {
    reg: REG,
    def: DEF,
    node: n,
    plan: plan(n.event),
    status: status('won'),
    tally: tally(t),
    build: 'test',
    at: 'now',
  });
};

describe('starting a career', () => {
  it('a fresh profile gets the starting cash and bike, and the map its start roads; race-first rides the tutorial', () => {
    expect(careerStarted(DEFAULT_PROFILE)).toBe(false);
    const p = fresh();
    expect(careerStarted(p)).toBe(true);
    expect(p.cash).toBe(500);
    expect(p.bikes).toEqual({ owned: ['base:rustbucket-400'], current: 'base:rustbucket-400', paint: {} });
    expect(p.regions['florida-keys']?.unlockedRoads).toEqual(['road-a']);
    expect(startCareer([DEF], p)).toBe(p); // a started career is left alone
    expect(firstRace([DEF])?.node.id).toBe('a');
  });
});

describe('the map: tiers, requirements, roads', () => {
  it('a node opens when its tier is open and its requirements are won', () => {
    let p = progressOf(DEF, fresh().regions);
    const state = (id: string) => nodeState(DEF, p, DEF.nodes.find((n) => n.id === id) as CareerNode);
    expect(['a', 'b', 'c', 'd', 'boss'].map(state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked']);
    expect(lockReason(DEF, p, DEF.nodes[1] as CareerNode, (id) => `the ${id} race`)).toBe(
      'Win the a race first.',
    );
    expect(lockReason(DEF, p, DEF.nodes[3] as CareerNode)).toBe('Win 2 more in Tourist Season.');
    p = applyWin(DEF, p, DEF.nodes[0] as CareerNode).progress;
    expect(['a', 'b', 'c', 'd'].map(state)).toEqual(['won', 'open', 'open', 'locked']);
    expect(tierOpen(DEF, p, 1)).toBe(false);
    // The tier gate: two wins in Tourist Season open Hurricane Season.
    const w = applyWin(DEF, p, DEF.nodes[1] as CareerNode);
    expect(w.tiersOpened).toEqual(['Hurricane Season']);
    p = w.progress;
    expect(p.tier).toBe(2);
    expect(state('d')).toBe('open');
    expect(state('e')).toBe('locked'); // needs d
    expect(state('boss')).toBe('locked');
    expect(tierReached(DEF, p)).toBe(2);
  });
  it('a win claims its road and the ones it names, and opens the ones it opens', () => {
    const w = applyWin(DEF, progressOf(DEF, fresh().regions), DEF.nodes[0] as CareerNode);
    expect(w.firstWin).toBe(true);
    expect(w.claimed).toEqual(['road-a', 'road-a2']);
    expect(w.opened).toEqual(['road-b', 'road-c']);
    expect(w.progress.claimedRoads).toEqual(['road-a', 'road-a2']);
    expect(w.progress.unlockedRoads).toEqual(['road-a', 'road-a2', 'road-b', 'road-c']);
    const again = applyWin(DEF, w.progress, DEF.nodes[0] as CareerNode);
    expect(again.firstWin).toBe(false);
    expect(again.claimed).toEqual([]);
  });
  it('the suggested node is the tutorial, then the lowest open tier, then the boss', () => {
    let p = fresh();
    expect(suggestedNode(DEF, progressOf(DEF, p.regions))?.id).toBe('a');
    for (const id of ['a', 'b', 'c', 'd', 'e']) p = winNode(p, id).profile;
    expect(suggestedNode(DEF, progressOf(DEF, p.regions))?.id).toBe('boss');
  });
});

describe('the boss, the teaser and free play', () => {
  it('beating the boss plays the teaser once, grants the joke ride, and opens every node to replay', () => {
    let p = fresh();
    for (const id of ['a', 'b', 'd']) p = winNode(p, id).profile;
    const pr = progressOf(DEF, p.regions);
    expect(nodeState(DEF, pr, DEF.nodes[2] as CareerNode)).toBe('open'); // c, never won
    expect(nodeState(DEF, pr, DEF.nodes[5] as CareerNode)).toBe('open'); // the boss
    const boss = winNode(p, 'boss');
    expect(boss.report.teaser).toEqual({
      lines: DEF.ending.lines,
      next: 'region-pnw:pacific-northwest',
      freePlayAfter: true,
    });
    expect(boss.report.unlocked).toEqual(['base:golf-cart']);
    expect(boss.profile.bikes.owned).toContain('base:golf-cart');
    const after = progressOf(DEF, boss.profile.regions);
    expect(after.finaleBeaten).toBe(true);
    // Free play: every node can be ridden, won or not.
    expect(DEF.nodes.map((n) => nodeState(DEF, after, n))).toEqual([
      'won',
      'won',
      'open',
      'won',
      'open',
      'won',
    ]);
    // The teaser plays once.
    expect(winNode(boss.profile, 'boss').report.teaser).toBeNull();
  });
  it('an event-won unlock grants its ride on that event', () => {
    let p = fresh();
    p = winNode(p, 'a').profile;
    expect(winNode(p, 'c').report.unlocked).toEqual(['base:moped']);
  });
});

describe('cash: places, takedowns, near misses, style, bonuses, and Road Trip fines', () => {
  it('a win pays its place, its style by kind and its bonuses, and finds a stash', () => {
    const p = fresh();
    const n = DEF.nodes[0] as CareerNode;
    const r = settleRace(p, {
      reg: REG,
      def: DEF,
      node: n,
      plan: plan(n.event),
      status: status('won', [
        {
          id: 'podium',
          kind: 'finish-place',
          required: false,
          rewardCash: 300,
          met: true,
          label: 'FINISH TOP 3',
        },
        {
          id: 'style',
          kind: 'style-cash',
          required: false,
          rewardCash: 200,
          met: false,
          label: 'STYLE $10/$300',
        },
      ]),
      tally: tally({
        place: 2,
        takedowns: 2,
        style: { takedownCombo: { count: 2, cash: 300 }, nearMiss: { count: 3, cash: 75 } },
        styleCash: 375,
        secrets: ['cooler'],
      }),
      build: 'b',
      at: 't',
    });
    expect(r.report.lines).toEqual([
      { label: '2nd place', cash: 900 },
      { label: 'Near misses ×3', cash: 75 },
      { label: 'Takedowns ×2', cash: 300 },
      { label: 'Bonus: finish top 3', cash: 300 },
      { label: 'Found: A cooler of tips', cash: 400 },
    ]);
    expect(r.profile.cash).toBe(500 + 900 + 75 + 300 + 300 + 400);
    expect(r.report.secretsFound.map((s) => s.id)).toEqual(['cooler']);
    expect(r.profile.history.at(-1)).toMatchObject({
      outcome: 'won',
      place: 2,
      cash: 1975,
      takedowns: 2,
      node: 'a',
    });
  });
  it('a bust pays no place and a fine, which never takes cash below $0 (Road Trip)', () => {
    const p = { ...fresh(), cash: 120 };
    const n = DEF.nodes[0] as CareerNode;
    const r = settleRace(p, {
      reg: REG,
      def: DEF,
      node: n,
      plan: plan(n.event),
      status: status('lost'),
      tally: tally({
        finished: false,
        place: 0,
        busted: true,
        fineCash: 600,
        style: { nearMiss: { count: 1, cash: 25 } },
        styleCash: 25,
      }),
      build: 'b',
      at: 't',
    });
    expect(r.report.outcome).toBe('busted');
    expect(r.report.fine).toBe(145);
    expect(r.profile.cash).toBe(0);
    expect(r.profile.history.at(-1)).toMatchObject({ outcome: 'busted', cash: -120 });
    expect(progressOf(DEF, r.profile.regions).won).toEqual([]);
  });
  it('a quit pays nothing and wins nothing', () => {
    const p = fresh();
    const n = DEF.nodes[0] as CareerNode;
    const r = settleRace(p, {
      reg: REG,
      def: DEF,
      node: n,
      plan: plan(n.event),
      status: status('won'),
      tally: tally({ styleCash: 500, style: { nearMiss: { count: 20, cash: 500 } } }),
      quit: true,
      build: 'b',
      at: 't',
    });
    expect(r.report).toMatchObject({ outcome: 'quit', won: false, lines: [] });
    expect(r.profile.cash).toBe(500);
  });
});

describe('grudges kept across races', () => {
  it('rise with what you did to a rival, by their rules; cool off when you leave them alone; clamp', () => {
    const t = tally({
      field: ['base:kevin-from-accounting', 'base:dial-up'],
      toRivals: { 'base:kevin-from-accounting': { hits: 1, takedowns: 1, steals: 1 } },
    });
    const g = settleGrudges(REG, { 'base:dial-up': { 'base:player': 3 } }, t, null);
    // Kevin: 2 + 4 + 3 = 9 (his own rules); Dial-Up, left alone: 3 - 1 (the default decay).
    expect(g.grudges).toEqual({
      'base:kevin-from-accounting': { 'base:player': 9 },
      'base:dial-up': { 'base:player': 2 },
    });
    const again = settleGrudges(REG, g.grudges, t, null);
    expect(again.grudges['base:kevin-from-accounting']).toEqual({ 'base:player': 10 }); // his max
    // A rival who did not ride keeps theirs.
    const away = settleGrudges(REG, g.grudges, tally({ field: [] }), null);
    expect(away.grudges).toEqual(g.grudges);
  });
  it('a grudge match moves its rival by the stakes: up when you win, down when you lose', () => {
    const t = tally({ field: ['base:kevin-from-accounting'] });
    const up = settleGrudges(REG, {}, t, { rival: 'base:kevin-from-accounting', delta: 2 });
    expect(up.changes).toEqual([{ rival: 'base:kevin-from-accounting', before: 0, after: 2 }]);
    const down = settleGrudges(REG, up.grudges, t, { rival: 'base:kevin-from-accounting', delta: -2 });
    expect(down.grudges).toEqual({});
  });
});

describe('the garage', () => {
  it('sells what the open tiers allow, hides secret rides until granted, and buys with cash', () => {
    let p = { ...fresh(), cash: 1000 };
    const view = () => Object.fromEntries(garageBikes(REG, [DEF], p).map((b) => [b.key, b.state]));
    expect(view()).toEqual({
      'base:rustbucket-400': 'owned',
      'base:moped': 'for-sale',
      'base:streetfighter-750': 'locked',
    });
    const locked = buyBike(REG, [DEF], p, 'base:streetfighter-750');
    expect(locked).toEqual({ ok: false, reason: 'Opens with Hurricane Season (The Keys).' });
    const bought = buyBike(REG, [DEF], p, 'base:moped');
    if (!bought.ok) throw new Error(bought.reason);
    p = bought.profile;
    expect(p.cash).toBe(100);
    expect(p.bikes.current).toBe('base:moped');
    expect(buyBike(REG, [DEF], p, 'base:moped').ok).toBe(false);
    const back = rideBike(p, 'base:rustbucket-400');
    expect(back.ok && back.profile.bikes.current).toBe('base:rustbucket-400');
    // The golf cart shows once the boss grants it.
    p = { ...p, bikes: { ...p.bikes, owned: [...p.bikes.owned, 'base:golf-cart'] } };
    expect(garageBikes(REG, [DEF], p).find((b) => b.key === 'base:golf-cart')).toMatchObject({
      state: 'owned',
      secret: true,
    });
  });
  it('paint: bought once, worn by the bike ridden, back to its own colours', () => {
    let p = { ...fresh(), cash: 400 };
    expect(garagePaints([DEF], p).map((x) => x.state)).toEqual(['for-sale', 'locked']);
    const r = buyPaint([DEF], p, 'flamingo-pink');
    if (!r.ok) throw new Error(r.reason);
    p = r.profile;
    expect(p.cash).toBe(100);
    expect(p.paintsOwned).toEqual(['flamingo-pink']);
    expect(currentPaintHex([DEF], p)).toBe('#f28fb1');
    expect(buyPaint([DEF], p, 'motel-teal').ok).toBe(false);
    const plain = paintBike(p, 'base:rustbucket-400', null);
    expect(plain.ok && currentPaintHex([DEF], plain.profile)).toBe(null);
  });
});

describe('learn by riding: prompts as they become relevant, once per career', () => {
  const ent = (id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot =>
    ({
      id,
      kind: 'rider',
      mode: 'Road',
      road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
      speed: 20,
      faction: 'rider',
      ...over,
    }) as EntitySnapshot;
  const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
    tick: 0,
    timeScale: 1,
    entities,
    race: { over: false, routeLength: 1000, finishOrder: [] },
  });
  const ev = (type: SimEvent['type'], over: Partial<SimEvent> = {}): SimEvent => ({
    tick: 0,
    type,
    actor: 0,
    data: {},
    ...over,
  });

  it('shows each prompt the first time its moment comes, and never again', () => {
    const o = createOnboarding([]);
    const far = snap([ent(0), ent(1, { road: { edge: 0, s: 160, d: 0, h: 0, dir: 1, yaw: 0 } })]);
    expect(o.note([], far, 0)).toBeNull();
    const close = snap([ent(0), ent(1, { road: { edge: 0, s: 102, d: 1, h: 0, dir: 1, yaw: 0 } })]);
    expect(o.note([], close, 0)?.id).toBe('fight');
    expect(o.note([], close, 0)).toBeNull();
    expect(o.note([ev('stealWindow', { actor: 1, target: 0 })], far, 0)?.id).toBe('steal');
    expect(o.note([ev('siren', { actor: 2, data: { on: true } })], far, 0)?.id).toBe('cop');
    expect(o.shown().sort()).toEqual(['cop', 'fight', 'steal']);
    expect(withPromptsSeen(['teaser:x'], o.shown())).toEqual([
      'prompt:cop',
      'prompt:fight',
      'prompt:steal',
      'teaser:x',
    ]);
  });
  it('a prompt seen in an earlier race is not shown again', () => {
    const o = createOnboarding(['prompt:fight']);
    const close = snap([ent(0), ent(1, { road: { edge: 0, s: 101, d: 0.5, h: 0, dir: 1, yaw: 0 } })]);
    expect(o.note([], close, 0)).toBeNull();
  });
});

describe('the map tally', () => {
  it('counts wins, claimed roads and secrets found', () => {
    const p = winNode(fresh(), 'a', { secrets: ['cut'] }).profile;
    expect(mapTally(DEF, progressOf(DEF, p.regions))).toEqual({
      won: 1,
      nodes: 6,
      claimed: 2,
      secretsFound: 1,
      secrets: 2,
      shortcutsFound: 1,
      shortcuts: 1,
    });
  });
});
