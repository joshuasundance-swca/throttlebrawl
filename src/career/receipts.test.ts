/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, MAX_RECEIPTS, type Profile, type Receipt } from '../save';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef } from './index';
import type { RaceTally } from './race-log';
import {
  fillReceipt,
  RECEIPT_NEAR_M,
  receiptBoards,
  receiptFacts,
  receiptRef,
  RECEIPTS_PER_RACE,
  receiptTemplates,
  type BoardSpot,
} from './receipts';
import { settleRace } from './settle';

// A world that keeps receipts (run W-T, the pitch deck's #14), from the real packs: what a career
// race leaves in the profile, and which roadside boards the next race in the region rewrites.

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const DEFS = careerDefs(REG);
const def = (region: string): CareerDef => {
  const d = careerOf(DEFS, region);
  if (!d) throw new Error(region);
  return d;
};
const KEYS = def('florida-keys');

const rv: Receipt = {
  kind: 'takedown',
  region: 'florida-keys',
  event: 'base:keys-t1-kevin-grudge',
  road: 'm1-long-bridge',
  s: 400,
  rival: 'base:kevin-from-accounting',
  vehicle: 'base:snowbird-rv',
  n: 1,
};
const bust: Receipt = { ...rv, kind: 'bust', rival: null, vehicle: null, road: 'm1-conch-row', s: 100, n: 3 };

const tally = (over: Partial<RaceTally> = {}): RaceTally => ({
  finished: true,
  place: 2,
  racers: 2,
  busted: false,
  fineCash: 0,
  takedowns: 1,
  style: {},
  styleCash: 0,
  toRivals: {},
  branches: [],
  secrets: [],
  field: ['base:kevin-from-accounting'],
  player: 'base:player',
  ...over,
});

/** A straight line of roads: each road's spot s is x = 10 000 × road number + s. */
const ROADS = ['m1-long-bridge', 'm1-conch-row'];
const at = (road: string, s: number) => {
  const i = ROADS.indexOf(road);
  return i < 0 ? null : { x: 10_000 * i + s, z: 0 };
};
const spot = (road: string, index: number, s: number): BoardSpot => ({
  road,
  index,
  ...(at(road, s) ?? { x: 0, z: 0 }),
});

describe('what a career race leaves: receipts in the profile', () => {
  it('a rival put into a vehicle and a bust are kept, numbered, with the event and region', () => {
    const p0: Profile = startCareer(DEFS, { ...DEFAULT_PROFILE });
    const node = KEYS.nodes.find((n) => n.id === 'kevin-grudge') ?? null;
    const plan = eventPlan(REG, node?.event ?? '');
    const out = settleRace(p0, {
      reg: REG,
      def: KEYS,
      node,
      plan,
      status: { state: 'lost', endNow: false, objectives: [], headline: '' },
      tally: tally({
        busted: true,
        finished: false,
        incidents: [
          { kind: 'takedown', road: 'osm-bahia-honda-bridge', s: 412, rival: rv.rival, vehicle: rv.vehicle },
          { kind: 'bust', road: 'osm-bahia-honda-bridge', s: 900, rival: null, vehicle: null },
        ],
      }),
      build: 'test',
      at: 'now',
    });
    expect(out.profile.receipts).toEqual([
      { ...rv, event: plan.key, road: 'osm-bahia-honda-bridge', s: 412, n: 1 },
      { ...bust, event: plan.key, road: 'osm-bahia-honda-bridge', s: 900, n: 1 },
    ]);
  });

  it('keeps the newest MAX_RECEIPTS; a race with no incidents leaves the list alone', () => {
    const many: Profile = {
      ...startCareer(DEFS, { ...DEFAULT_PROFILE }),
      receipts: Array.from({ length: MAX_RECEIPTS }, (_v, i) => ({ ...rv, n: i + 1 })),
    };
    const plan = eventPlan(REG, 'base:keys-t1-kevin-grudge');
    const settle = (t: RaceTally) =>
      settleRace(many, {
        reg: REG,
        def: KEYS,
        node: null,
        plan,
        status: { state: 'won', endNow: false, objectives: [], headline: '' },
        tally: t,
        build: 'test',
        at: 'now',
      }).profile.receipts;
    expect(settle(tally())).toEqual(many.receipts);
    const after = settle(
      tally({
        incidents: [{ kind: 'takedown', road: 'm1-long-bridge', s: 5, rival: rv.rival, vehicle: rv.vehicle }],
      }),
    );
    expect(after).toHaveLength(MAX_RECEIPTS);
    expect(after.at(-1)).toMatchObject({ s: 5, n: MAX_RECEIPTS + 1 });
  });
});

describe('the boards a receipt rewrites', () => {
  it("each region's career file has takedown and bust templates that recorded facts fill completely", () => {
    for (const d of DEFS) {
      const t = receiptTemplates(REG, d);
      expect(t.takedown.length, d.regionId).toBeGreaterThan(0);
      expect(t.bust.length, d.regionId).toBeGreaterThan(0);
      const facts = receiptFacts(REG, { ...rv, region: d.regionId });
      for (const x of [...t.takedown, ...t.bust]) {
        const text = fillReceipt(x.text, facts);
        expect(text, `${d.regionId} ${x.id}`).not.toBeNull();
        // The headline (first sentence) stays short enough to read at speed.
        const headline = (text ?? '').split(/[.!?]/)[0] ?? '';
        expect(headline.split(/\s+/).length, `${d.regionId} ${x.id}: ${headline}`).toBeLessThanOrEqual(9);
      }
    }
    const facts = receiptFacts(REG, rv);
    expect(facts).toMatchObject({ rival: 'Kevin from Accounting', vehicle: 'Snowbird RV', n: 1 });
    expect(fillReceipt('INCIDENT SITE #{n}.', receiptFacts(REG, bust))).toBe('INCIDENT SITE #3.');
    // A template naming a fact the receipt lacks is never used for it.
    expect(fillReceipt('{VEHICLE} 1.', receiptFacts(REG, bust))).toBeNull();
  });

  it('the nearest board within reach of each spot, on this race’s roads, a billboard or a sign', () => {
    const spots = [
      spot('m1-long-bridge', 0, 0),
      spot('m1-long-bridge', 3, 700),
      spot('m1-conch-row', 1, 150),
    ];
    const boards = receiptBoards(REG, KEYS, [rv, bust], spots, at);
    expect(boards.map((b) => [b.road, b.index, b.kind])).toEqual([
      ['m1-conch-row', 1, 'sign'],
      ['m1-long-bridge', 3, 'billboard'],
    ]);
    expect(boards[0]?.text).toBe('INCIDENT SITE #3. Please do not reenact.');
    expect(boards[1]?.text).toMatch(/SNOWBIRD RV/);
    expect(boards[1]?.ref).toMatch(/^base:career\/keys-circuit#receipt-/);
  });

  it('none when no board is near, the spot is off this race’s roads, or the receipt is another region’s', () => {
    expect(receiptBoards(REG, KEYS, [rv], [spot('m1-long-bridge', 0, 400 + RECEIPT_NEAR_M + 1)], at)).toEqual(
      [],
    );
    expect(
      receiptBoards(REG, KEYS, [{ ...rv, road: 'osm-kw-bertha' }], [spot('m1-long-bridge', 0, 400)], at),
    ).toEqual([]);
    expect(
      receiptBoards(
        REG,
        KEYS,
        [{ ...rv, region: 'pacific-northwest' }],
        [spot('m1-long-bridge', 0, 400)],
        at,
      ),
    ).toEqual([]);
  });

  it('a cut template is never drawn; one board per slot; at most RECEIPTS_PER_RACE, newest first', () => {
    const all = receiptTemplates(REG, KEYS).takedown.map((t) => receiptRef(KEYS, t.id));
    expect(receiptBoards(REG, KEYS, [rv], [spot('m1-long-bridge', 0, 400)], at, new Set(all))).toEqual([]);
    const receipts = Array.from({ length: 5 }, (_v, i) => ({ ...rv, s: 100 * i, n: i + 1 }));
    const spots = Array.from({ length: 5 }, (_v, i) => spot('m1-long-bridge', i, 100 * i));
    const boards = receiptBoards(REG, KEYS, receipts, spots, at);
    expect(boards).toHaveLength(RECEIPTS_PER_RACE);
    expect(boards.map((b) => b.receipt.n)).toEqual([5, 4, 3]);
    expect(new Set(boards.map((b) => b.index)).size).toBe(RECEIPTS_PER_RACE);
    // Seeded by the receipt, never the clock: the same receipts pick the same words.
    expect(receiptBoards(REG, KEYS, receipts, spots, at)).toEqual(boards);
  });
});
