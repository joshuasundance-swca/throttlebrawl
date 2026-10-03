/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { DEFAULT_PROFILE, type Profile } from '../save';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { careerDefs, careerOf, eventPlan, startCareer, type CareerDef } from './index';
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
  field: ['base:kevin-from-accounting', 'base:dial-up'],
  player: 'base:player',
  ...over,
});
const report = (over: Partial<SettleReport> = {}): SettleReport => ({
  outcome: 'won',
  won: true,
  lines: [],
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
const planOf = (d: CareerDef, node: string) =>
  eventPlan(REG, d.nodes.find((n) => n.id === node)?.event ?? '');

describe('the show text in each career file', () => {
  it('each region has its own paper in its own style, a headline for every moment, asks and gigs', () => {
    const styles = DEFS.map((d) => showOf(REG, d).paper.style);
    expect(styles).toEqual(['rag', 'newsletter', 'blog']);
    expect(new Set(DEFS.map((d) => showOf(REG, d).paper.name)).size).toBe(3);
    for (const d of DEFS) {
      const raw = (REG.careers[d.key] as unknown as { show: { heads: Record<string, string[]> } }).show;
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
  const plan = planOf(KEYS, 'shakedown');
  it('a takedown is the big moment: the headline names the rider you dropped most', () => {
    const t = tally({
      takedowns: 3,
      toRivals: {
        'base:dial-up': { hits: 1, takedowns: 1, steals: 0 },
        'base:kevin-from-accounting': { hits: 4, takedowns: 2, steals: 0 },
      },
    });
    const keys = paperView(REG, showOf(REG, KEYS), {
      plan,
      report: report(),
      tally: t,
      racesRun: 4,
      timeOfDay: 'golden hour',
    });
    expect(keys).toMatchObject({ style: 'rag', name: 'The Mile Marker Shriek', moment: 'down' });
    expect(keys.headline).toContain('KEVIN FROM ACCOUNTING');
    expect(keys.dateline).toBe('GOLDEN HOUR EDITION · RACE 4');
    expect(keys.deck).toBe('The Shakedown: won, 1st of 5.');
    expect(keys.caption).toBe('Pictured: Kevin from Accounting, shortly before.');
    const sf = paperView(REG, showOf(REG, SF), {
      plan,
      report: report(),
      tally: t,
      racesRun: 4,
      timeOfDay: 'dawn',
    });
    expect(sf.style).toBe('blog');
    expect(sf.headline).not.toBe(keys.headline);
  });

  it('the moments rank: boss, bust, secret, takedown, air, near misses, the result', () => {
    const at = (r: Partial<SettleReport>, t: Partial<RaceTally>): MomentKind =>
      biggestMoment(REG, { plan: planOf(KEYS, 'drawbridge'), report: report(r), tally: tally(t) }).kind;
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
    const boss = biggestMoment(REG, {
      plan: planOf(KEYS, 'drawbridge'),
      report: report({ map: finale }),
      tally: tally(),
    });
    expect(boss.rival).toBe('Mother Rust');
  });

  it('a bust prints the fine, a loss the place', () => {
    const bust = paperView(REG, showOf(REG, PNW), {
      plan: planOf(PNW, 'lindqvist'),
      report: report({ outcome: 'busted', won: false, fine: 400 }),
      tally: tally({ busted: true, finished: false }),
      racesRun: 2,
      timeOfDay: 'noon',
    });
    expect(bust.headline).toContain('$400');
    expect(bust.deck).toContain('Fine $400');
    const lose = paperView(REG, showOf(REG, PNW), {
      plan: planOf(PNW, 'ferry-line'),
      report: report({ outcome: 'placed', won: false }),
      tally: tally({ place: 4 }),
      racesRun: 3,
      timeOfDay: 'dawn',
    });
    expect(lose.headline).toContain('4TH');
    expect(lose.style).toBe('newsletter');
  });

  it('a race to the line cleared below first says cleared, never won (skeptic, run W-S: "won, 5th of 5")', () => {
    const plan = planOf(KEYS, 'shakedown');
    const paper = (place: number) =>
      paperView(REG, showOf(REG, KEYS), {
        plan,
        report: report(),
        tally: tally({ place }),
        racesRun: 1,
        timeOfDay: 'golden hour',
      });
    // The Shakedown asks only to finish: last place clears it, and the paper says so.
    const last = paper(5);
    expect(last.deck).toBe('The Shakedown: cleared, 5th of 5.');
    expect(last.moment).toBe('lose');
    expect(last.headline).toContain('5TH');
    expect(last.headline).not.toMatch(/\bWON\b|\bWINS\b/);
    expect(clearedNotWon(plan, report(), 5)).toBe(true);
    expect(clearedNotWon(plan, report(), 2)).toBe(true);
    // First place is a win.
    const first = paper(1);
    expect(first.deck).toBe('The Shakedown: won, 1st of 5.');
    expect(first.moment).toBe('win');
    expect(clearedNotWon(plan, report(), 1)).toBe(false);
    // A grudge, a hunt or an escape won is won, whatever the place; a race not cleared is not.
    expect(clearedNotWon(planOf(KEYS, 'kevin-grudge'), report(), 4)).toBe(false);
    expect(clearedNotWon(planOf(KEYS, 'sunburn-hunt'), report(), 4)).toBe(false);
    expect(clearedNotWon(planOf(KEYS, 'deputy-dash'), report(), 2)).toBe(false);
    expect(clearedNotWon(plan, report({ outcome: 'placed', won: false }), 5)).toBe(false);
  });
});

describe('the quiet frame: a poster before, at most one producer ask during', () => {
  it('the poster shows up to four faces from the field, a beef line each from the grudge they hold', () => {
    const plan = planOf(KEYS, 'long-haul');
    expect(plan.field.length).toBeGreaterThan(4);
    const texts = riderTexts(REG, DEFS);
    const profile = fresh();
    profile.grudges = { 'base:deacon-vane': { 'base:player': 7 }, 'base:dial-up': { 'base:player': 2 } };
    const p = posterView(REG, texts, plan, 'Golden hour', profile);
    expect(p.live).toBe('LIVE · GOLDEN HOUR');
    expect(p.faces).toHaveLength(4);
    const by = (id: string) => p.faces.find((f) => f.id === id);
    // Hot: their grudge line, with the number in it. Simmering: a taunt. None: who they are.
    expect(by('base:deacon-vane')?.beef).toBe('7 sins on your ledger. I keep it in the saddlebag.');
    expect(by('base:dial-up')?.beef).toBe(texts.get('base:dial-up')?.won);
    expect(by('base:chad-speedwell')?.beef).toBe('A sponsored influencer, livestreaming mid-race.');
    expect(by('base:deacon-vane')).toMatchObject({
      initials: 'DV',
      colours: ['#1b1b1f', '#f2ead8'],
      grudge: 7,
    });
  });

  it('the ask is seeded by the race, varies across races, and fits the event', () => {
    const show = showOf(REG, KEYS);
    const classic = planOf(KEYS, 'long-haul');
    const hunt = planOf(KEYS, 'sunburn-hunt');
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
    // Each tier-1 grudge has its own $300-of-style bonus, or is a style contest by its rule (Chad's
    // Collab, run W-T): the producer never asks for style again.
    for (const [d, node] of [
      [KEYS, 'kevin-grudge'],
      [PNW, 'juniper-grudge'],
      [SF, 'collab'],
    ] as const) {
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
    expect(askObjective(ask)).toEqual({
      id: 'ask-sunscreen',
      kind: 'takedowns',
      required: false,
      rewardCash: 250,
      params: { count: 1 },
    });
    const ME = 1;
    const ent = (id: number): EntitySnapshot =>
      ({
        id,
        kind: 'rider',
        mode: 'Road',
        faction: 'rider',
        contentId: id === ME ? 'base:player' : 'base:dial-up',
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
    log.note([{ ...takedown, tick: 3 }], snap(3));
    expect(log.status().objectives[0]?.met).toBe(true);
    // The app hands it to settle as a bonus objective: the ledger pays it.
    const plan = planOf(KEYS, 'long-haul');
    const node = KEYS.nodes.find((n) => n.id === 'long-haul') ?? null;
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
    expect(r.report.lines).toEqual([{ label: "Bonus: producer's ask", cash: 250 }]);
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
      region: 'florida-keys',
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
    expect(gigStatus(air, tally({ style: { airtime: { count: 2, cash: 80 } } }))).toMatchObject({
      met: true,
      rewardCash: 200,
      label: 'Side gig: Charter reel',
      required: false,
    });
    expect(gigStatus(air, tally({ style: { airtime: { count: 1, cash: 40 } } })).met).toBe(false);
    expect(gigStatus(pie, tally({ place: 3 })).met).toBe(true);
    expect(gigStatus(pie, tally({ place: 4 })).met).toBe(false);
    expect(gigStatus(pie, tally({ place: 1, busted: true })).met).toBe(false);
  });

  it('texts come from the rival you hurt most and one who beat you home, and remember the grudge', () => {
    const texts = riderTexts(REG, DEFS);
    const plan = planOf(KEYS, 'shakedown');
    const after = fresh();
    after.grudges = { 'base:kevin-from-accounting': { 'base:player': 8 } };
    const t = tally({
      place: 3,
      toRivals: {
        'base:kevin-from-accounting': { hits: 3, takedowns: 2, steals: 0 },
        'base:dial-up': { hits: 1, takedowns: 0, steals: 0 },
      },
    });
    const out = rivalTexts(REG, texts, plan, t, ['base:chad-speedwell', 'base:kevin-from-accounting'], after);
    expect(out.map((x) => x.from)).toEqual(['Kevin from Accounting', 'Chad Speedwell']);
    expect(out[0]).toMatchObject({
      memory: 'After The Shakedown: you knocked them off twice.',
      line: 'Circling back re: The Shakedown. Grudge level 8. Noted.',
      grudge: 8,
    });
    expect(out[1]).toMatchObject({
      memory: 'After The Shakedown: they finished ahead of you.',
      line: texts.get('base:chad-speedwell')?.won,
    });
    // A quiet race still gets one word from the field.
    const quiet = rivalTexts(REG, texts, plan, tally(), [], fresh());
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.line).toBe(texts.get('base:kevin-from-accounting')?.lost);
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
});
