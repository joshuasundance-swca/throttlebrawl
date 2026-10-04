/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, type Profile } from '../save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef, type CareerNode } from './index';
import { createRaceLog, type ObjectiveSpec, type RaceStatus, type RaceTally } from './race-log';
import {
  REPAIR_CAP_SHARE,
  REPAIR_MIN_CASH,
  REPAIR_PRICE_SHARE,
  REPAIR_WRECKS_BILLED,
  REPLAY_PAY_SCALE,
  bikePrice,
  repairBill,
  seasonPurseScale,
  settleRace,
} from './settle';
import { askObjective, askCashAt, currentGig, pickAsk, showOf } from './show';

// The economy (playtest 3, T7.2; docs/product-spec.md, Cash and Failure states; scratch/pt3
// progression.md section 5: "smaller purses, pricier bikes and repairs after crashes"): a crash
// bills the bike's repair, a replay of a won node pays half its purse, the producer's ask and the
// side gig pay more up the tiers, and a drift event counts drift cash only. Every expectation here
// is derived from the rule (the shop's own price, the constants the rule names), never from a
// copied dollar figure, so a content retune does not break a test that guards a rule.

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const DEFS = careerDefs(REG);
const KEYS = careerOf(DEFS, 'florida-keys') as CareerDef;
const fresh = (): Profile => startCareer(DEFS, { ...DEFAULT_PROFILE });

/** The first node of the Keys with a place prize to win, and its plan. */
const NODE = KEYS.nodes[0] as CareerNode;
const PLAN = eventPlan(REG, NODE.event);

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
const won = (objectives: RaceStatus['objectives'] = []): RaceStatus => ({
  state: 'won',
  endNow: false,
  objectives,
  headline: '',
});
const settle = (
  profile: Profile,
  t: Partial<RaceTally>,
  opts: { status?: RaceStatus; node?: CareerNode | null; plan?: typeof PLAN } = {},
) =>
  settleRace(profile, {
    reg: REG,
    def: KEYS,
    node: opts.node === undefined ? NODE : opts.node,
    plan: opts.plan ?? PLAN,
    status: opts.status ?? won(),
    tally: tally(t),
    build: 'test',
    at: '2026-10-04T00:00:00.000Z',
  });

/** The price a bike is sold at, read straight from the career files (not through the code under test). */
const shopPrice = (bike: string): number => {
  const prices = DEFS.flatMap((d) => d.shop.filter((s) => s.bike === bike).map((s) => s.priceCash));
  return prices.length ? Math.min(...prices) : 0;
};
const PRICED = (() => {
  const bike = DEFS.flatMap((d) => d.shop)
    .filter((s) => s.priceCash > 0)
    .sort((a, b) => b.priceCash - a.priceCash)[0];
  if (!bike) throw new Error('no priced bike in any shop');
  return bike;
})();
const withBike = (bike: string): Profile => {
  const p = fresh();
  return { ...p, bikes: { ...p.bikes, owned: [...new Set([...p.bikes.owned, bike])].sort(), current: bike } };
};

describe('repairs after a crash', () => {
  it('a wreck bills a share of the bike price, at least the minimum, and the ledger says Repairs xN', () => {
    const bike = PRICED.bike;
    const price = shopPrice(bike);
    const each = Math.max(REPAIR_MIN_CASH, Math.round(REPAIR_PRICE_SHARE * price));
    // A rich race, so the cap does not bite.
    const big = tally({ wrecks: 3, styleCash: 100000, style: { nearMiss: { count: 1, cash: 100000 } } });
    const r = settle(withBike(bike), big).report;
    const line = r.lines.find((l) => l.label.startsWith('Repairs'));
    expect(line).toEqual({ label: 'Repairs ×3', cash: -3 * each });
    expect(r.repairs).toBe(3 * each);
    console.log(`[examined] ${bike} at $${price}: ${each} a wreck, billed ${r.repairs} for 3`);
  });

  it('a bike with no shop price (the starting bike) still bills the minimum per wreck', () => {
    const start = KEYS.startingBike;
    expect(shopPrice(start)).toBe(0);
    const rich = tally({ wrecks: 2, styleCash: 100000, style: { nearMiss: { count: 1, cash: 100000 } } });
    expect(settle(withBike(start), rich).report.repairs).toBe(2 * REPAIR_MIN_CASH);
  });

  it('only the first few wrecks are billed', () => {
    expect(repairBill(REPAIR_WRECKS_BILLED + 4, 1000, 1e9)).toEqual(
      repairBill(REPAIR_WRECKS_BILLED, 1000, 1e9),
    );
    expect(repairBill(REPAIR_WRECKS_BILLED, 1000, 1e9).wrecks).toBe(REPAIR_WRECKS_BILLED);
  });

  it('the bill never passes its share of what the race paid, and a race that paid nothing bills nothing', () => {
    const paid = 400;
    const bill = repairBill(5, 5000, paid);
    expect(bill.cash).toBe(Math.floor(REPAIR_CAP_SHARE * paid));
    expect(repairBill(3, 5000, 0).cash).toBe(0);
    expect(repairBill(0, 5000, 10000).cash).toBe(0);
  });

  it('a settled race bills repairs against its pay, and the cash after never goes below zero', () => {
    const p0 = withBike(PRICED.bike);
    const poor = { ...p0, cash: 0 };
    const s = settle(poor, { wrecks: 5, place: 5 });
    const paid = s.report.lines.filter((l) => l.cash > 0).reduce((a, l) => a + l.cash, 0);
    expect(s.report.repairs).toBeLessThanOrEqual(Math.floor(REPAIR_CAP_SHARE * paid));
    expect(s.report.cashAfter).toBeGreaterThanOrEqual(0);
    expect(s.report.cashAfter).toBe(paid - s.report.repairs);
  });

  it('a quit pays nothing and bills nothing', () => {
    const r = settleRace(withBike(PRICED.bike), {
      reg: REG,
      def: KEYS,
      node: NODE,
      plan: PLAN,
      status: won(),
      tally: tally({ wrecks: 4 }),
      quit: true,
      build: 'test',
      at: 'now',
    }).report;
    expect(r.repairs).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('a race without wrecks has no repairs line and the report says 0', () => {
    const r = settle(fresh(), { wrecks: 0 }).report;
    expect(r.repairs).toBe(0);
    expect(r.lines.some((l) => l.label.startsWith('Repairs'))).toBe(false);
  });

  it('bikePrice is the lowest price any shop asks, and 0 for a bike no shop sells', () => {
    expect(bikePrice(REG, KEYS, PRICED.bike)).toBe(shopPrice(PRICED.bike));
    expect(bikePrice(REG, KEYS, 'base:no-such-bike')).toBe(0);
  });
});

describe('the tally counts the player wrecks only', () => {
  const rider = (id: number, mode: EntitySnapshot['mode'] = 'Road'): EntitySnapshot =>
    ({
      id,
      kind: 'rider',
      faction: 'racer',
      contentId: `base:rider-${id}`,
      mode,
      progress: 10,
      road: { edge: 0, s: 10 },
      finished: false,
      targetId: -1,
    }) as unknown as EntitySnapshot;
  const snap = (modes: EntitySnapshot['mode'][]): SimSnapshot =>
    ({
      timeScale: 1,
      entities: modes.map((m, i) => rider(i, m)),
      race: { over: false, finishOrder: [], routeLength: 1000 },
    }) as unknown as SimSnapshot;
  const crash = (actor: number, data: Record<string, unknown> = {}): SimEvent =>
    ({ type: 'crash', actor, target: -1, data }) as unknown as SimEvent;
  const log = () =>
    createRaceLog({
      playerId: 0,
      rules: { kind: 'classic-race' },
      objectives: [],
      routeId: 'run',
      roadIds: ['road-a'],
    });

  it("counts the player's crash, not a rival's", () => {
    const l = log();
    l.note([crash(1), crash(2)], snap(['Road', 'Road', 'Road']));
    expect(l.tally().wrecks ?? 0).toBe(0);
    l.note([crash(0)], snap(['Tumble', 'Road', 'Road']));
    expect(l.tally().wrecks).toBe(1);
  });

  it('a crash while already down is the same wreck, and a tumble contact is not a new one', () => {
    const l = log();
    l.note([crash(0)], snap(['Tumble', 'Road']));
    l.note([crash(0), crash(0, { contact: 'tumble' })], snap(['Tumble', 'Road']));
    l.note([], snap(['Road', 'Road']));
    expect(l.tally().wrecks).toBe(1);
    // Back on the bike and down again: a second wreck.
    l.note([crash(0)], snap(['Tumble', 'Road']));
    expect(l.tally().wrecks).toBe(2);
  });
});

describe('replays pay half', () => {
  const place = (r: ReturnType<typeof settle>) => r.report.lines.find((l) => / place/.test(l.label));

  it('a won node pays half its place prize on a replay, rounded to the dollar', () => {
    const first = settle(fresh(), { place: 1 });
    const prize = place(first)?.cash ?? 0;
    expect(prize).toBeGreaterThan(0);
    expect(first.report.map?.firstWin).toBe(true);
    const again = settle(first.profile, { place: 1 });
    expect(place(again)?.cash).toBe(Math.round(prize * REPLAY_PAY_SCALE));
    expect(again.report.replay).toBe(true);
    expect(first.report.replay).toBe(false);
  });

  it('a required bonus pays half, an optional bonus and style pay in full', () => {
    const objectives = [
      { id: 'req', kind: 'beat-rival', required: true, rewardCash: 1001, met: true, label: 'REQ' },
      { id: 'opt', kind: 'style-cash', required: false, rewardCash: 301, met: true, label: 'OPT' },
    ] as RaceStatus['objectives'];
    const style = { nearMiss: { count: 2, cash: 77 } };
    const first = settle(fresh(), { style, styleCash: 77 }, { status: won(objectives) });
    const again = settle(first.profile, { style, styleCash: 77 }, { status: won(objectives) });
    const cash = (r: ReturnType<typeof settle>, label: string) =>
      r.report.lines.find((l) => l.label.toLowerCase().includes(label))?.cash;
    expect(cash(first, 'req')).toBe(1001);
    expect(cash(again, 'req')).toBe(Math.round(1001 * REPLAY_PAY_SCALE));
    expect(cash(again, 'opt')).toBe(301);
    expect(cash(again, 'near misses')).toBe(77);
  });

  it('a node not yet won, and a free-play race of an event never won, pay in full', () => {
    const lost = settle(fresh(), { place: 1 }, { status: { ...won(), state: 'lost' } });
    expect(lost.report.replay).toBe(false);
    const free = settle(fresh(), { place: 1 }, { node: null });
    expect(place(free)?.cash).toBe(place(settle(fresh(), { place: 1 }))?.cash);
  });

  it('a different node of the same region is not a replay', () => {
    const first = settle(fresh(), {});
    const other = KEYS.nodes.find((n) => n.id !== NODE.id);
    expect(other).toBeDefined();
    const second = settle(
      first.profile,
      {},
      { node: other as CareerNode, plan: eventPlan(REG, (other as CareerNode).event) },
    );
    expect(second.report.replay).toBe(false);
  });
});

describe('the season scales the purse', () => {
  it('Season 1 is 1, and the purse only ever grows with the season', () => {
    expect(seasonPurseScale(1)).toBe(1);
    expect(seasonPurseScale(undefined)).toBe(1);
    expect(seasonPurseScale(2)).toBeGreaterThan(1);
    expect(seasonPurseScale(3)).toBeGreaterThanOrEqual(seasonPurseScale(2));
    expect(seasonPurseScale(50)).toBe(seasonPurseScale(3));
  });

  it('a later season pays a bigger place prize, and style is not scaled', () => {
    const style = { nearMiss: { count: 1, cash: 50 } };
    const s1 = settle({ ...fresh(), season: 1 }, { style, styleCash: 50 });
    const s2 = settle({ ...fresh(), season: 2 }, { style, styleCash: 50 });
    const prize = (r: ReturnType<typeof settle>) =>
      r.report.lines.find((l) => / place/.test(l.label))?.cash ?? 0;
    expect(prize(s2)).toBe(Math.round(prize(s1) * seasonPurseScale(2)));
    expect(s2.report.lines.find((l) => l.label === 'Near misses')?.cash).toBe(50);
  });
});

describe('a style-cash objective can count one kind of style only', () => {
  const spec = (params: Record<string, unknown>): ObjectiveSpec => ({
    id: 'sc',
    kind: 'style-cash',
    required: true,
    rewardCash: 0,
    params,
  });
  const style = (kind: string, points: number): SimEvent =>
    ({ type: 'style', actor: 0, target: -1, data: { kind, points } }) as unknown as SimEvent;
  const snap = {
    timeScale: 1,
    entities: [
      {
        id: 0,
        kind: 'rider',
        faction: 'racer',
        contentId: 'base:player',
        mode: 'Road',
        progress: 10,
        road: { edge: 0, s: 10 },
        finished: false,
        targetId: -1,
      },
    ],
    race: { over: false, finishOrder: [], routeLength: 1000 },
  } as unknown as SimSnapshot;
  const run = (params: Record<string, unknown>) => {
    const l = createRaceLog({
      playerId: 0,
      rules: { kind: 'classic-race' },
      objectives: [spec(params)],
      routeId: 'run',
      roadIds: ['road-a'],
    });
    l.note([style('nearMiss', 400), style('drift', 120), style('drift', 30)], snap);
    return l.status().objectives[0];
  };

  it('with kinds ["drift"] only drift cash counts, and the label says DRIFT', () => {
    const o = run({ cash: 500, kinds: ['drift'] });
    expect(o?.label).toBe('DRIFT $150/$500');
    expect(o?.met).toBeNull();
    expect(run({ cash: 150, kinds: ['drift'] })?.met).toBe(true);
  });

  it('without kinds every kind counts, as before', () => {
    const o = run({ cash: 500 });
    expect(o?.label).toBe('STYLE $500/$500');
    expect(o?.met).toBe(true);
  });

  it('a bad kinds list (empty, not a list, not strings) counts everything', () => {
    for (const kinds of [[], 'drift', [3, null]])
      expect(run({ cash: 500, kinds })?.label).toBe('STYLE $500/$500');
  });

  it('several kinds count together and the label stays STYLE', () => {
    const o = run({ cash: 1000, kinds: ['drift', 'nearMiss'] });
    expect(o?.label).toBe('STYLE $550/$1000');
  });
});

describe('the producer ask and the side gig pay more up the tiers', () => {
  it('askCashAt scales the file cash by the global tier, in steps of $50, ties down', () => {
    expect(askCashAt(250, 1)).toBe(250);
    expect(askCashAt(250, 5)).toBe(350);
    expect(askCashAt(250, 12)).toBe(500);
    for (const g of [1, 2, 3, 7, 12]) expect(askCashAt(200, g) % 50).toBe(0);
    // Never less than the file says, and never decreasing up the tiers.
    let last = 0;
    for (let g = 1; g <= 12; g++) {
      const v = askCashAt(300, g);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(askCashAt(300, 0)).toBe(300);
  });

  it('a region later in the career asks for the same job at a higher pay than an earlier one', () => {
    const base = showOf(REG, KEYS);
    expect(base.tierBase).toBe(0);
    const later = DEFS.filter((d) => d.chapter > KEYS.chapter);
    expect(later.length).toBeGreaterThan(0);
    for (const d of later) expect(showOf(REG, d).tierBase).toBeGreaterThan(0);
  });

  it('the ask pays the scaled cash through its objective, and its pay grows with the node tier', () => {
    const show = showOf(REG, KEYS);
    const raw = (REG.careers[KEYS.key] as unknown as { show: { asks: { id: string; cash: number }[] } }).show
      .asks;
    const plan = { ...PLAN, tier: 1 };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const low = pickAsk(show, { ...plan, tier: 1 }, seed);
      const high = pickAsk(show, { ...plan, tier: KEYS.tiers.length }, seed);
      if (!low || !high || low.id !== high.id) continue;
      const file = raw.find((a) => a.id === low.id)?.cash ?? 0;
      expect(low.cash).toBe(askCashAt(file, 1));
      expect(high.cash).toBe(askCashAt(file, KEYS.tiers.length));
      expect(high.cash).toBeGreaterThanOrEqual(low.cash);
      expect(askObjective(high).rewardCash).toBe(high.cash);
      return;
    }
    throw new Error('no seed picked the same ask at both tiers');
  });

  it('the side gig pays by how far the region has come', () => {
    const show = showOf(REG, KEYS);
    const raw = (REG.careers[KEYS.key] as unknown as { show: { gigs: { id: string; cash: number }[] } }).show
      .gigs;
    const p0 = fresh();
    const far = {
      ...p0,
      regions: {
        ...p0.regions,
        [KEYS.regionId]: { ...(p0.regions[KEYS.regionId] as object), tier: KEYS.tiers.length },
      },
    } as Profile;
    const g0 = currentGig(show, p0, KEYS.regionId);
    const g1 = currentGig(show, far, KEYS.regionId);
    expect(g0 && g1).toBeTruthy();
    const file = raw.find((g) => g.id === g0?.id)?.cash ?? -1;
    expect(g0?.cash).toBe(askCashAt(file, 1));
    expect(g1?.cash).toBe(askCashAt(raw.find((g) => g.id === g1?.id)?.cash ?? -1, KEYS.tiers.length));
  });
});
