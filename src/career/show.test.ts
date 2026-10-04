/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, type Profile } from '../save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef, type EventPlan } from './index';
import { createRaceLog, type RaceStatus, type RaceTally } from './race-log';
import { settleRace, type SettleReport } from './settle';
import {
  askObjective,
  biggestMoment,
  clearedNotWon,
  currentGig,
  fill,
  gigStatus,
  MOMENT_KINDS,
  paperView,
  pauseMap,
  pickAsk,
  POSTER_FACES,
  posterView,
  riderTexts,
  rivalTexts,
  showOf,
  type MomentKind,
} from './show';
import { careerMap } from './view';

// The career show (run W-S, career-show lane; interview, 2026-10-02: "A quiet frame", the local
// newspaper, rival texts and side gigs "in whatever mixes make sense and actually work well"), read
// from the real packs: each region's paper in its own style with a headline built from what
// happened, at most one producer ask per race that pays through the ledger, rival texts that
// remember the race and the grudge, a side gig judged from the tally, the pause map's "you are here".

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const DEFS = careerDefs(REG);
const def = (region: string): CareerDef => {
  const d = careerOf(DEFS, region);
  if (!d) throw new Error(region);
  return d;
};
const KEYS = def('florida-keys');
const PNW = def('pacific-northwest');
const SF = def('san-francisco');
const fresh = (): Profile => startCareer(DEFS, { ...DEFAULT_PROFILE });
const planOf = (d: CareerDef, node: string) =>
  eventPlan(REG, d.nodes.find((n) => n.id === node)?.event ?? '');
/** The first node of a career, in map order, whose event passes `pick`. */
const nodeWhere = (d: CareerDef, what: string, pick: (plan: EventPlan) => boolean): string => {
  const node = d.nodes.find((n) => pick(eventPlan(REG, n.event)));
  if (!node) throw new Error(`${d.regionId}: no ${what}`);
  return node.id;
};
// The checks below name no event, rider or line of a pack: they take the Keys' opening race and its
// field, and read every name, line and amount from the packs (docs/engineering.md, "Assert the
// rule, not today's content").
const OPENING: string = (() => {
  if (!KEYS.tutorialNode) throw new Error('the Keys career names no opening node');
  return KEYS.tutorialNode;
})();
const rivalAt = (i: number): string => {
  const id = planOf(KEYS, OPENING).field[i];
  if (!id) throw new Error(`the Keys' opening field has no rival ${i + 1}`);
  return id;
};
const [RIVAL_A, RIVAL_B, RIVAL_C] = [rivalAt(0), rivalAt(1), rivalAt(2)];
const nameOf = (id: string) => REG.riders[id]?.name ?? id;

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
  field: [RIVAL_A, RIVAL_B],
  player: 'base:player',
  ...over,
});
const report = (over: Partial<SettleReport> = {}): SettleReport => ({
  outcome: 'won',
  won: true,
  lines: [],
  repairs: 0,
  replay: false,
  fine: 0,
  cashBefore: 0,
  cashAfter: 0,
  map: null,
  unlocked: [],
  secretsFound: [],
  grudges: [],
  teaser: null,
  ...over,
});

describe('the show text in each career file', () => {
  it('each region has its own paper in its own style, a headline for every moment, asks and gigs', () => {
    expect(DEFS.length).toBeGreaterThan(1);
    expect(new Set(DEFS.map((d) => showOf(REG, d).paper.name)).size).toBe(DEFS.length);
    for (const d of DEFS) {
      const raw = (
        REG.careers[d.key] as unknown as {
          show: { heads: Record<string, string[]>; paper: { style: string } };
        }
      ).show;
      // The paper's style is the career file's own, not a fallback.
      expect(showOf(REG, d).paper.style, d.regionId).toBe(raw.paper.style);
      for (const k of MOMENT_KINDS) expect(raw.heads[k]?.length, `${d.regionId} ${k}`).toBeGreaterThan(0);
      const s = showOf(REG, d);
      expect(s.asks.length, d.regionId).toBeGreaterThanOrEqual(3);
      expect(s.gigs.length, d.regionId).toBeGreaterThanOrEqual(4);
    }
    console.log(
      `[examined] ${DEFS.length} career files: ${DEFS.map((d) => showOf(REG, d).paper.name).join(', ')}`,
    );
  });

  it('every template fills completely, and no headline is too long to read', () => {
    const vars = {
      rival: 'Kevin',
      n: 3,
      secret: 'The boat ramp cut',
      event: 'The Shakedown',
      place: '4th',
      g: 7,
    };
    let examined = 0;
    for (const d of DEFS) {
      const s = showOf(REG, d);
      for (const k of MOMENT_KINDS)
        for (const h of s.heads[k]) {
          examined++;
          const out = fill(h, vars);
          expect(out, h).not.toMatch(/\{[a-zA-Z]+\}/);
          expect(out.length, h).toBeLessThanOrEqual(64);
        }
    }
    for (const t of riderTexts(REG, DEFS).values())
      for (const line of [t.won, t.lost, t.grudge]) {
        examined++;
        expect(fill(line, vars)).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(line.length, line).toBeLessThanOrEqual(80);
      }
    console.log(`[examined] ${examined} headlines and text lines filled`);
  });

  it('every rival who rides a career event can text you', () => {
    const texts = riderTexts(REG, DEFS);
    const field = new Set(DEFS.flatMap((d) => d.nodes.flatMap((n) => eventPlan(REG, n.event).field)));
    for (const id of field) expect(texts.has(id), id).toBe(true);
    console.log(`[examined] ${field.size} rivals in career fields, ${texts.size} with texts`);
  });
});

describe('the paper: a headline built from what happened, styled per region', () => {
  const plan = planOf(KEYS, OPENING);
  it('a takedown is the big moment: the headline names the rider you dropped most', () => {
    const t = tally({
      takedowns: 3,
      toRivals: {
        [RIVAL_B]: { hits: 1, takedowns: 1, steals: 0 },
        [RIVAL_A]: { hits: 4, takedowns: 2, steals: 0 },
      },
    });
    const keys = paperView(REG, showOf(REG, KEYS), {
      plan,
      report: report(),
      tally: t,
      racesRun: 4,
      timeOfDay: 'golden hour',
    });
    const { name, style } = showOf(REG, KEYS).paper;
    expect(keys).toMatchObject({ style, name, moment: 'down' });
    expect(keys.headline.toUpperCase()).toContain(nameOf(RIVAL_A).toUpperCase());
    expect(keys.dateline).toBe('GOLDEN HOUR EDITION · RACE 4');
    expect(keys.deck).toBe(`${plan.name}: won, 1st of 5.`);
    expect(keys.caption).toBe(`Pictured: ${nameOf(RIVAL_A)}, shortly before.`);
    const sf = paperView(REG, showOf(REG, SF), {
      plan,
      report: report(),
      tally: t,
      racesRun: 4,
      timeOfDay: 'dawn',
    });
    expect(sf.style).toBe(showOf(REG, SF).paper.style);
    expect(sf.headline).not.toBe(keys.headline);
  });

  it('the moments rank: boss, bust, secret, takedown, air, near misses, the result', () => {
    const at = (r: Partial<SettleReport>, t: Partial<RaceTally>): MomentKind =>
      biggestMoment(REG, { plan: planOf(KEYS, KEYS.boss), report: report(r), tally: tally(t) }).kind;
    const finale = {
      progress: {} as never,
      firstWin: true,
      opened: [],
      claimed: [],
      tiersOpened: [],
      finale: true,
    };
    expect(at({ map: finale }, { takedowns: 4 })).toBe('boss');
    expect(at({ outcome: 'busted', won: false, fine: 400 }, { takedowns: 4 })).toBe('bust');
    const secret = KEYS.secrets[0];
    if (!secret) throw new Error('no secret');
    expect(at({ secretsFound: [secret] }, { takedowns: 1 })).toBe('secret');
    expect(at({}, { takedowns: 1 })).toBe('down');
    expect(at({}, { style: { airtime: { count: 2, cash: 80 } } })).toBe('air');
    expect(at({}, { style: { nearMiss: { count: 3, cash: 75 } } })).toBe('miss');
    expect(at({}, {})).toBe('win');
    expect(at({ outcome: 'placed', won: false }, { place: 4 })).toBe('lose');
    const bossPlan = planOf(KEYS, KEYS.boss);
    const boss = biggestMoment(REG, {
      plan: bossPlan,
      report: report({ map: finale }),
      tally: tally(),
    });
    expect(bossPlan.rules.rival, 'the boss race names its rival').toBeDefined();
    expect(boss.rival).toBe(nameOf(bossPlan.rules.rival ?? ''));
  });

  it('a bust prints the fine, a loss the place', () => {
    const pursuit = nodeWhere(PNW, 'cop escape', (p) => p.kind === 'cop-escape');
    const race = nodeWhere(PNW, 'race to the line', (p) => p.kind === 'classic-race');
    const bust = paperView(REG, showOf(REG, PNW), {
      plan: planOf(PNW, pursuit),
      report: report({ outcome: 'busted', won: false, fine: 400 }),
      tally: tally({ busted: true, finished: false }),
      racesRun: 2,
      timeOfDay: 'noon',
    });
    expect(bust.headline).toContain('$400');
    expect(bust.deck).toContain('Fine $400');
    const lose = paperView(REG, showOf(REG, PNW), {
      plan: planOf(PNW, race),
      report: report({ outcome: 'placed', won: false }),
      tally: tally({ place: 4 }),
      racesRun: 3,
      timeOfDay: 'dawn',
    });
    expect(lose.headline).toContain('4TH');
    expect(lose.style).toBe(showOf(REG, PNW).paper.style);
  });

  it('a race to the line cleared below first says cleared, never won (skeptic, run W-S: "won, 5th of 5")', () => {
    const plan = planOf(KEYS, OPENING);
    // The Keys open on a race to the line that asks only to finish.
    expect(plan.kind).toBe('classic-race');
    const paper = (place: number) =>
      paperView(REG, showOf(REG, KEYS), {
        plan,
        report: report(),
        tally: tally({ place }),
        racesRun: 1,
        timeOfDay: 'golden hour',
      });
    // It asks only to finish: last place clears it, and the paper says so.
    const last = paper(5);
    expect(last.deck).toBe(`${plan.name}: cleared, 5th of 5.`);
    expect(last.moment).toBe('lose');
    expect(last.headline).toContain('5TH');
    expect(last.headline).not.toMatch(/\bWON\b|\bWINS\b/);
    expect(clearedNotWon(plan, report(), 5)).toBe(true);
    expect(clearedNotWon(plan, report(), 2)).toBe(true);
    // First place is a win.
    const first = paper(1);
    expect(first.deck).toBe(`${plan.name}: won, 1st of 5.`);
    expect(first.moment).toBe('win');
    expect(clearedNotWon(plan, report(), 1)).toBe(false);
    // A grudge, a hunt or an escape won is won, whatever the place; a race not cleared is not.
    for (const kind of ['grudge-match', 'takedown-hunt', 'cop-escape'])
      expect(
        clearedNotWon(
          planOf(
            KEYS,
            nodeWhere(KEYS, kind, (p) => p.kind === kind),
          ),
          report(),
          4,
        ),
        kind,
      ).toBe(false);
    expect(clearedNotWon(plan, report({ outcome: 'placed', won: false }), 5)).toBe(false);
  });
});

describe('the quiet frame: a poster before, at most one producer ask during', () => {
  it('the poster shows up to four faces from the field, a beef line each from the grudge they hold', () => {
    const plan = planOf(
      KEYS,
      nodeWhere(KEYS, 'field of five or more', (q) => q.field.length > POSTER_FACES),
    );
    const texts = riderTexts(REG, DEFS);
    const rider = (id: string) =>
      REG.riders[id] as unknown as { name: string; blurb?: string; look?: { palette?: string[] } };
    // Three of the faces: one hot, one simmering, and one with no grudge who has a blurb.
    const [hot, simmer] = plan.field;
    const cold = plan.field.slice(2, POSTER_FACES).find((id) => rider(id).blurb);
    if (!hot || !simmer || !cold) throw new Error(`${plan.key}: no three faces to check`);
    const profile = fresh();
    profile.grudges = { [hot]: { 'base:player': 7 }, [simmer]: { 'base:player': 2 } };
    const p = posterView(REG, texts, plan, 'Golden hour', profile);
    expect(p.live).toBe('LIVE · GOLDEN HOUR');
    expect(p.faces).toHaveLength(POSTER_FACES);
    const by = (id: string) => p.faces.find((f) => f.id === id);
    const vars = { event: plan.name, g: 7, n: 0 };
    // Hot: their grudge line, with the number in it. Simmering: a taunt. None: who they are.
    expect(texts.get(hot)?.grudge).toContain('{g}');
    expect(by(hot)?.beef).toBe(fill(texts.get(hot)?.grudge ?? '', vars));
    expect(by(hot)?.beef).toContain('7');
    expect(by(simmer)?.beef).toBe(fill(texts.get(simmer)?.won ?? '', { ...vars, g: 2 }));
    expect(by(cold)?.beef).toBe(rider(cold).blurb);
    // The face: the rider's initials, their look's first colour with readable ink, the grudge.
    const face = by(hot);
    const name = rider(hot).name;
    expect(face?.initials).toMatch(/^[A-Z0-9]{1,2}$/);
    expect(face?.initials[0]).toBe(name.replace(/[^A-Za-z0-9]/g, '')[0]?.toUpperCase());
    expect(face?.colours[0]).toBe(rider(hot).look?.palette?.[0]);
    expect(['#111111', '#f2ead8']).toContain(face?.colours[1]);
    expect(face?.grudge).toBe(7);
  });

  it('the ask is seeded by the race, varies across races, and fits the event', () => {
    const show = showOf(REG, KEYS);
    const classic = planOf(
      KEYS,
      nodeWhere(KEYS, 'race to the line', (p) => p.kind === 'classic-race'),
    );
    const hunt = planOf(
      KEYS,
      nodeWhere(KEYS, 'takedown hunt', (p) => p.kind === 'takedown-hunt'),
    );
    expect(pickAsk(show, classic, 7)).toEqual(pickAsk(show, classic, 7));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(pickAsk(show, classic, seed)?.id ?? '');
      const h = pickAsk(show, hunt, seed);
      expect(h?.kind, 'a hunt is never asked for takedowns').not.toBe('takedowns');
      expect(h?.kind, 'a place ask only in a race to the line').not.toBe('finish-place');
    }
    expect(seen.size).toBe(show.asks.length);
  });

  it('an ask never repeats a goal the event already sets (skeptic, run W-S: the grudge bonus asked twice)', () => {
    let examined = 0;
    for (const d of DEFS) {
      const show = showOf(REG, d);
      for (const node of d.nodes) {
        const plan = eventPlan(REG, node.event);
        const kinds = plan.objectives.map((o) => o.kind);
        const places = plan.objectives
          .filter((o) => o.kind === 'finish-place')
          .map((o) => (typeof o.params['maxPlace'] === 'number' ? o.params['maxPlace'] : 3));
        for (let seed = 1; seed <= 40; seed++) {
          const ask = pickAsk(show, plan, seed);
          if (!ask) continue;
          examined++;
          // A place ask may still tighten the event's own place goal (top 2 in a top-3 race).
          if (ask.kind === 'finish-place')
            expect(Math.min(...places), `${plan.key} seed ${seed}`).toBeGreaterThan(ask.n);
          else expect(kinds, `${plan.key} seed ${seed}`).not.toContain(ask.kind);
        }
      }
    }
    // Each tier-1 grudge has its own style bonus, or is a style contest by its rule (the Collab, run
    // W-T): the producer never asks for style again.
    const firstTierGrudges = DEFS.flatMap((d) =>
      d.nodes
        .filter((n) => n.tier === 0 && planOf(d, n.id).kind === 'grudge-match')
        .map((n) => [d, n.id] as const),
    );
    console.log(
      `[examined] tier-1 grudges: ${firstTierGrudges.map(([d, n]) => `${d.regionId}/${n}`).join(', ')}`,
    );
    expect(firstTierGrudges.length).toBeGreaterThanOrEqual(DEFS.length);
    for (const [d, node] of firstTierGrudges) {
      const plan = planOf(d, node);
      if (plan.rules.rule !== 'collab')
        expect(
          plan.objectives.map((o) => o.kind),
          node,
        ).toContain('style-cash');
      for (let seed = 1; seed <= 40; seed++)
        expect(pickAsk(showOf(REG, d), plan, seed)?.kind, `${node} seed ${seed}`).not.toBe('style-cash');
    }
    console.log(`[examined] ${examined} asks over every career event, seeds 1-40`);
  });

  it('the ask counts only from the moment it is asked, and the ledger pays it', () => {
    const ask = showOf(REG, KEYS).asks.find((a) => a.kind === 'takedowns');
    if (!ask) throw new Error('no takedown ask');
    // A takedown ask is an optional takedown count paying the ask's cash (both the career file's).
    expect(askObjective(ask)).toEqual({
      id: `ask-${ask.id}`,
      kind: 'takedowns',
      required: false,
      rewardCash: ask.cash,
      params: { count: ask.n },
    });
    expect(ask.n).toBeGreaterThan(0);
    expect(ask.cash).toBeGreaterThan(0);
    const ME = 1;
    const ent = (id: number): EntitySnapshot =>
      ({
        id,
        kind: 'rider',
        mode: 'Road',
        faction: 'rider',
        contentId: id === ME ? 'base:player' : RIVAL_B,
        road: { edge: 0, s: 0 },
        progress: 0,
        finished: false,
        targetId: -1,
      }) as unknown as EntitySnapshot;
    const snap = (tick: number): SimSnapshot => ({
      tick,
      timeScale: 1,
      entities: [ent(0), ent(ME)],
      race: { over: false, routeLength: 2000, finishOrder: [] },
    });
    const takedown: SimEvent = {
      tick: 1,
      type: 'takedown',
      actor: ME,
      target: 0,
      data: {},
    } as unknown as SimEvent;
    // A takedown before the ask is not the producer's.
    const log = createRaceLog({
      playerId: ME,
      rules: { kind: 'classic-race' },
      objectives: [askObjective(ask)],
      routeId: '',
      roadIds: [],
    });
    log.note([], snap(2));
    expect(log.status().objectives[0]?.met).toBeNull();
    // The ask's count of takedowns after it: one short is not yet met, the last one meets it.
    for (let i = 0; i < ask.n; i++) {
      expect(log.status().objectives[0]?.met, `${i} of ${ask.n}`).toBeNull();
      log.note([{ ...takedown, tick: 3 + i }], snap(3 + i));
    }
    expect(log.status().objectives[0]?.met).toBe(true);
    // The app hands it to settle as a bonus objective: the ledger pays it.
    const raced = nodeWhere(KEYS, 'race to the line', (p) => p.kind === 'classic-race');
    const plan = planOf(KEYS, raced);
    const node = KEYS.nodes.find((n) => n.id === raced) ?? null;
    const asked = log.status().objectives[0];
    if (!asked) throw new Error('no ask status');
    const status: RaceStatus = {
      state: 'lost',
      endNow: false,
      headline: '',
      objectives: [{ ...asked, label: "Producer's ask" }],
    };
    const r = settleRace(fresh(), {
      reg: REG,
      def: KEYS,
      node,
      plan,
      status,
      tally: tally({ finished: false, place: 0 }),
      build: 't',
      at: 'n',
    });
    expect(r.report.lines).toEqual([{ label: "Bonus: producer's ask", cash: ask.cash }]);
  });
});

describe('side gigs and rival texts between races', () => {
  it("a region's gig holds until a race is run, then the next one comes up; the tally judges it", () => {
    const show = showOf(REG, KEYS);
    const p = fresh();
    const a = currentGig(show, p, KEYS.regionId);
    expect(currentGig(show, p, KEYS.regionId)).toEqual(a);
    const ids = new Set<string>();
    const race: Profile['history'][number] = {
      event: 'x',
      node: null,
      region: KEYS.regionId,
      place: 1,
      outcome: 'won',
      cash: 0,
      takedowns: 0,
      build: '',
      at: '',
    };
    for (let n = 0; n < 30; n++) {
      const later: Profile = { ...p, history: new Array<typeof race>(n).fill(race) };
      ids.add(currentGig(show, later, KEYS.regionId)?.id ?? '');
    }
    expect(ids.size).toBe(show.gigs.length);
    const air = show.gigs.find((g) => g.need === 'airtime');
    const pie = show.gigs.find((g) => g.need === 'finish');
    if (!air || !pie) throw new Error('gigs');
    // Each gig's count, cash and name are the career file's.
    const airs = (count: number) => tally({ style: { airtime: { count, cash: 40 * count } } });
    expect(gigStatus(air, airs(air.n))).toMatchObject({
      met: true,
      rewardCash: air.cash,
      label: `Side gig: ${air.name}`,
      required: false,
    });
    expect(gigStatus(air, airs(air.n - 1)).met).toBe(false);
    expect(gigStatus(pie, tally({ place: pie.n })).met).toBe(true);
    expect(gigStatus(pie, tally({ place: pie.n + 1 })).met).toBe(false);
    expect(gigStatus(pie, tally({ place: 1, busted: true })).met).toBe(false);
  });

  it('texts come from the rival you hurt most and one who beat you home, and remember the grudge', () => {
    const texts = riderTexts(REG, DEFS);
    const plan = planOf(KEYS, OPENING);
    const after = fresh();
    after.grudges = { [RIVAL_A]: { 'base:player': 8 } };
    const t = tally({
      place: 3,
      toRivals: {
        [RIVAL_A]: { hits: 3, takedowns: 2, steals: 0 },
        [RIVAL_B]: { hits: 1, takedowns: 0, steals: 0 },
      },
    });
    const out = rivalTexts(REG, texts, plan, t, [RIVAL_C, RIVAL_A], after);
    expect(out.map((x) => x.from)).toEqual([nameOf(RIVAL_A), nameOf(RIVAL_C)]);
    // The hot one texts their grudge line (the rider file's), filled with the race and the level.
    expect(texts.get(RIVAL_A)?.grudge).toContain('{g}');
    expect(out[0]).toMatchObject({
      memory: `After ${plan.name}: you knocked them off twice.`,
      line: fill(texts.get(RIVAL_A)?.grudge ?? '', { event: plan.name, g: 8, n: 2 }),
      grudge: 8,
    });
    expect(out[0]?.line).toContain('8');
    expect(out[1]).toMatchObject({
      memory: `After ${plan.name}: they finished ahead of you.`,
      line: fill(texts.get(RIVAL_C)?.won ?? '', { event: plan.name, g: 0, n: 0 }),
    });
    // A quiet race still gets one word from the field: the first rider in it.
    const quiet = rivalTexts(REG, texts, plan, tally(), [], fresh());
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.line).toBe(fill(texts.get(RIVAL_A)?.lost ?? '', { event: plan.name, g: 0, n: 0 }));
  });
});

describe("the pause screen's map", () => {
  it('marks the player on the panel holding their road, inside its bounds', () => {
    const panels = careerMap(REG, KEYS, fresh());
    const road = panels[0]?.roads[0];
    if (!road) throw new Error('no road');
    const v = pauseMap(REG, KEYS, panels, road.id, 100);
    expect(v?.panel.id).toBe(panels[0]?.id);
    const [x0, z0, x1, z1] = v?.panel.bounds ?? [0, 0, 0, 0];
    expect(v?.here?.x).toBeGreaterThanOrEqual(x0);
    expect(v?.here?.x).toBeLessThanOrEqual(x1);
    expect(v?.here?.z).toBeGreaterThanOrEqual(z0);
    expect(v?.here?.z).toBeLessThanOrEqual(z1);
    expect(v?.title).toContain(KEYS.name);
    // A road off the map still shows the map, with no marker.
    expect(pauseMap(REG, KEYS, panels, 'not-a-road', 0)?.here).toBeNull();
    expect(pauseMap(REG, KEYS, [], road.id, 0)).toBeNull();
  });

  it("shows the Keys' secret road as a '?' with its roads undrawn until it is found (run W-U)", () => {
    // The secret road and the roads it hides are the career file's (the Keys' Unlisted Key today).
    const secret = KEYS.secrets.find((s) => s.kind === 'road');
    if (!secret) throw new Error('the Keys hide no secret road');
    const island = secret.hides ?? [];
    expect(island).toContain(secret.road);
    const panel = careerMap(REG, KEYS, fresh()).find((p) => p.roads.some((r) => r.id === secret.road));
    if (!panel) throw new Error('no panel holds the secret road');
    // Undrawn: exactly the roads the panel's secret roads hide.
    const onPanel = KEYS.secrets.filter((s) => s.kind === 'road' && panel.roads.some((r) => r.id === s.road));
    const hides = [...new Set(onPanel.flatMap((s) => s.hides ?? []))].sort();
    expect(
      panel.roads
        .filter((r) => r.hidden)
        .map((r) => r.id)
        .sort(),
    ).toEqual(hides);
    const mark = panel.secrets.find((s) => s.id === secret.id);
    expect(mark).toMatchObject({ found: false, hinted: true });
    // Paused out on the island before it is found: the map still holds the player's road.
    expect(pauseMap(REG, KEYS, [panel], secret.road, 180)?.here).not.toBeNull();
    // Found: its roads are drawn and the mark is a found secret.
    const p = fresh();
    const keys = p.regions[KEYS.regionId];
    if (!keys) throw new Error('no Keys progress');
    const found: Profile = {
      ...p,
      regions: { ...p.regions, [KEYS.regionId]: { ...keys, secrets: [...keys.secrets, secret.id] } },
    };
    const after = careerMap(REG, KEYS, found).find((x) => x.id === panel.id);
    expect(after?.roads.filter((r) => r.hidden && island.includes(r.id))).toEqual([]);
    expect(after?.secrets.find((s) => s.id === secret.id)?.found).toBe(true);
    // Only secret roads carry a '?'.
    expect(
      panel.secrets
        .filter((s) => s.hinted)
        .map((s) => s.id)
        .sort(),
    ).toEqual(onPanel.map((s) => s.id).sort());
  });
});
