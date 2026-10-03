// The career's presentation as plain data (run W-S, career-show lane; interview, 2026-10-02, round 4:
// "Maybe all of the above in whatever mixes make sense and actually work well"; round 6: "A quiet
// frame"). Everything here is DOM-free and a pure function of the registry, the career files, the
// profile and what a race did, so ui/ only draws it and the tests read it without a browser:
//
// - the streaming outfit's QUIET FRAME: a pre-race poster (the faces in the field, a beef line each
//   from the grudge they hold, the light) and at most ONE producer ask during a race, paying a bonus;
// - the region's paper after a race (a Keys rag, a damp Pacific Northwest newsletter, an SF tech
//   blog): a headline built from the race's biggest moment;
// - rival texts between races that remember what happened (this race, and the grudge they keep);
// - a light side gig: one per region at a time, judged after your next career race there;
// - the pause screen's network map: where you are on the region's map.
//
// The words live in each career file's loose `show` block (docs/content-packs.md, "Career"); the
// rules for picking them live here. Picks are seeded by the race or the profile, never by the clock.
import type { GrudgeRuleId } from '../core';
import { packOf, type ContentRegistry } from '../content';
import type { Profile } from '../save';
import { bare, careerDefs, qualify, type CareerDef, type EventPlan } from './defs';
import type { ObjectiveSpec, ObjectiveStatus, RaceTally } from './race-log';
import type { SettleReport } from './settle';
import type { MapPanel } from './view';

export type PaperStyle = 'rag' | 'newsletter' | 'blog';
/** What a race's headline is about, biggest first. */
export const MOMENT_KINDS = ['boss', 'bust', 'secret', 'down', 'air', 'miss', 'win', 'lose'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

/** The producer's asks: a bonus objective the race log can judge from the moment it is asked. */
export interface AskDef {
  id: string;
  kind: 'takedowns' | 'style-cash' | 'finish-place';
  /** The count, the style cash, or the place to finish at or above. */
  n: number;
  cash: number;
  text: string;
}

export const GIG_NEEDS = [
  'airtime',
  'nearMiss',
  'oncoming',
  'trick',
  'weaponSteal',
  'takedowns',
  'finish',
] as const;
export type GigNeed = (typeof GIG_NEEDS)[number];

/** A side gig: judged from the next career race's tally in its region, silently (no HUD). */
export interface GigDef {
  id: string;
  name: string;
  need: GigNeed;
  n: number;
  cash: number;
  text: string;
}

/** A rider's three text lines: `won` (they beat you), `lost` (you got the better of them), `grudge`. */
export interface RiderTexts {
  won: string;
  lost: string;
  grudge: string;
}

export interface ShowText {
  paper: { name: string; style: PaperStyle; tagline: string };
  heads: Readonly<Record<MomentKind, readonly string[]>>;
  asks: readonly AskDef[];
  gigs: readonly GigDef[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const int = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
const strings = (v: unknown): string[] =>
  list(v)
    .map((x) => str(x))
    .filter((x) => x.length > 0);

/** Headlines when a career file's `show` has none for a moment (plain, deadpan). [default] */
export const FALLBACK_HEADS: Readonly<Record<MomentKind, readonly string[]>> = {
  boss: ['{RIVAL} IS DONE'],
  bust: ['RIDER BUSTED, FINED ${n}'],
  secret: ['RIDER FINDS {SECRET}'],
  down: ['{RIVAL} KNOCKED OFF'],
  air: ['RIDER AIRBORNE {n} TIMES'],
  miss: ['{n} NEAR MISSES, ZERO APOLOGIES'],
  win: ['RIDER WINS {EVENT}'],
  lose: ['RIDER FINISHES {PLACE}'],
};

/** What the still under the headline shows, by moment. [default] */
export const CAPTIONS: Readonly<Record<MomentKind, string>> = {
  boss: 'Pictured: the moment it was over.',
  bust: 'Pictured: the paperwork.',
  secret: 'Pictured: a road that was not on the map.',
  down: 'Pictured: {rival}, shortly before.',
  air: 'Pictured: airborne. Briefly.',
  miss: 'Pictured: traffic, unbothered.',
  win: 'Pictured: the line, crossed.',
  lose: "Pictured: everyone else's tail lights.",
};

const PAPER_STYLES: readonly PaperStyle[] = ['rag', 'newsletter', 'blog'];
const ASK_KINDS: readonly AskDef['kind'][] = ['takedowns', 'style-cash', 'finish-place'];

/** A career file's `show` block, read defensively. */
export function showOf(reg: ContentRegistry, def: CareerDef): ShowText {
  const show = obj(obj(reg.careers[def.key])['show']);
  const paper = obj(show['paper']);
  const heads = obj(show['heads']);
  return {
    paper: {
      name: str(paper['name'], def.regionName),
      style: PAPER_STYLES.find((s) => s === paper['style']) ?? 'rag',
      tagline: str(paper['tagline']),
    },
    heads: Object.fromEntries(
      MOMENT_KINDS.map((k) => {
        const own = strings(heads[k]);
        return [k, own.length ? own : FALLBACK_HEADS[k]];
      }),
    ) as Record<MomentKind, string[]>,
    asks: list(show['asks'])
      .map(obj)
      .filter((a) => ASK_KINDS.includes(a['kind'] as AskDef['kind']) && typeof a['text'] === 'string')
      .map((a) => ({
        id: str(a['id'], 'ask'),
        kind: a['kind'] as AskDef['kind'],
        n: Math.max(1, int(a['n'], 1)),
        cash: Math.max(0, int(a['cash'], 0)),
        text: str(a['text']),
      })),
    gigs: list(show['gigs'])
      .map(obj)
      .filter((g) => GIG_NEEDS.includes(g['need'] as GigNeed) && typeof g['name'] === 'string')
      .map((g) => ({
        id: str(g['id'], 'gig'),
        name: str(g['name']),
        need: g['need'] as GigNeed,
        n: Math.max(1, int(g['n'], 1)),
        cash: Math.max(0, int(g['cash'], 0)),
        text: str(g['text']),
      })),
  };
}

/** Every career file's rider texts, by qualified rider id (a bare id names the file's own pack). */
export function riderTexts(reg: ContentRegistry, defs: readonly CareerDef[]): Map<string, RiderTexts> {
  const out = new Map<string, RiderTexts>();
  for (const def of defs) {
    const texts = obj(obj(reg.careers[def.key])['show'])['texts'];
    for (const [id, raw] of Object.entries(obj(texts))) {
      const t = obj(raw);
      const won = str(t['won']);
      const lost = str(t['lost']);
      if (!won || !lost) continue;
      out.set(qualify(def.pack, id), { won, lost, grudge: str(t['grudge'], won) });
    }
  }
  return out;
}

// ---- Seeded picks ---------------------------------------------------------------------------------

/** A small string hash (FNV-1a), for picks that must not move between runs. */
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pick<T>(items: readonly T[], seed: string): T | undefined {
  return items.length ? items[hashOf(seed) % items.length] : undefined;
}

/** Fills `{key}` (as given) and `{KEY}` (upper case) from `vars`; unknown keys stay as they are. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (all, key: string) => {
    const v = vars[key] ?? vars[key.toLowerCase()];
    if (v === undefined) return all;
    return key !== key.toLowerCase() && key === key.toUpperCase() ? String(v).toUpperCase() : String(v);
  });
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
};

const riderName = (reg: ContentRegistry, key: string): string => reg.riders[key]?.name ?? bare(key);

/** The most grudge points a rival holds (toward the player: the only rider the career tracks). */
export function grudgeOf(profile: Profile, rival: string): number {
  const row = profile.grudges[rival];
  return row ? Math.max(0, ...Object.values(row)) : 0;
}

/** The grudge band a text or a beef line speaks from. [default] */
export const GRUDGE_HOT = 6;

// ---- The pre-race poster --------------------------------------------------------------------------

export interface PosterFace {
  id: string;
  name: string;
  initials: string;
  /** Background and ink, from the rider's look palette. */
  colours: [string, string];
  /** One line of beef: their grudge line, a taunt, or who they are. */
  beef: string;
  grudge: number;
}

export interface PosterView {
  /** The chyron: `LIVE · GOLDEN HOUR`. */
  live: string;
  faces: PosterFace[];
  /** A grudge match's rule card (run W-T), or null: the rival's own rule, said before the race. */
  rule: RuleCard | null;
}

/** A grudge rule as the poster states it: a name and one line. */
export interface RuleCard {
  id: GrudgeRuleId;
  name: string;
  line: string;
}

/**
 * The rule cards' words when a career file's `show.rules` has none (run W-T, the pitch deck's #14;
 * the tone guide's deadpan, short enough to read at a glance). [default]
 */
export const RULE_CARDS: Readonly<Record<GrudgeRuleId, { name: string; line: string }>> = {
  audit: { name: 'THE AUDIT', line: 'Every hit he lands is a line item. Each one adds a knockdown.' },
  'bad-connection': {
    name: 'BAD CONNECTION',
    line: 'Hear the modem? He drops out, then reconnects up the road. Hit him while he buffers.',
  },
  collab: { name: 'THE COLLAB', line: 'Most style at the line wins. Finishing first is just content.' },
  timber: { name: 'TIMBER', line: 'Your fists do not count. Traffic and scenery do.' },
};

/** A rule's card: the career file's `show.rules[id]` (`name`, `line`) when whole, else the default. */
export function ruleCard(reg: ContentRegistry, def: CareerDef | null, id: GrudgeRuleId): RuleCard {
  const own = def ? obj(obj(obj(reg.careers[def.key])['show'])['rules'])[id] : undefined;
  const o = obj(own);
  const name = str(o['name']);
  const line = str(o['line']);
  return name && line ? { id, name, line } : { id, ...RULE_CARDS[id] };
}

/** The career whose map holds an event (by qualified event key), or null. */
function careerHolding(reg: ContentRegistry, eventKey: string): CareerDef | null {
  return careerDefs(reg).find((d) => d.nodes.some((n) => n.event === eventKey)) ?? null;
}

/** The most faces a poster shows ("the four faces"). */
export const POSTER_FACES = 4;
const HEX = /^#[0-9a-f]{6}$/i;

function initialsOf(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 -]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  const first = words[0] ?? '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${(words[words.length - 1] ?? '')[0] ?? ''}`.toUpperCase();
}

/** Readable ink on a background colour. */
function inkOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum > 150 ? '#111111' : '#f2ead8';
}

/** The stream's poster for an event: up to four faces from its field, a beef line each, the light. */
export function posterView(
  reg: ContentRegistry,
  texts: ReadonlyMap<string, RiderTexts>,
  plan: EventPlan,
  timeOfDay: string,
  profile: Profile,
): PosterView {
  const faces = plan.field.slice(0, POSTER_FACES).map((id): PosterFace => {
    const rider = reg.riders[id] as unknown as Json | undefined;
    const name = riderName(reg, id);
    const palette = strings(obj(rider?.['look'])['palette']).filter((c) => HEX.test(c));
    const bg = palette[0] ?? '#444444';
    const g = grudgeOf(profile, id);
    const t = texts.get(id);
    const vars = { event: plan.name, g: Math.round(g), n: 0 };
    const beef =
      g >= GRUDGE_HOT && t
        ? fill(t.grudge, vars)
        : g > 0 && t
          ? fill(t.won, vars)
          : str(rider?.['blurb']) || (t ? fill(t.won, vars) : '');
    return { id, name, initials: initialsOf(name), colours: [bg, inkOn(bg)], beef, grudge: Math.round(g) };
  });
  const rule = plan.rules.rule ? ruleCard(reg, careerHolding(reg, plan.key), plan.rules.rule) : null;
  return { live: `LIVE · ${timeOfDay.toUpperCase()}`, faces, rule };
}

// ---- The producer's ask ---------------------------------------------------------------------------

/** Where in the race the producer asks: this fraction of the route. [default] */
export const ASK_AT_FRACTION = 0.25;

/**
 * The one ask a race may get (seeded by the race), or null. An ask never repeats a goal the event
 * already sets: no style ask when the event pays its own style bonus, no takedown ask in a hunt
 * (skeptic, run W-S: a tier-1 grudge's "$300 of style" came back as the producer's ask, met once and
 * failed once on the same results). A place ask is the one exception, since every race to the line
 * has a place goal: it fits only when it asks for better than every place the event names. [default]
 */
export function pickAsk(show: ShowText, plan: EventPlan, seed: number): AskDef | null {
  const places = plan.objectives
    .filter((o) => o.kind === 'finish-place')
    .map((o) => (typeof o.params['maxPlace'] === 'number' ? o.params['maxPlace'] : 3));
  const fits = show.asks.filter((a) => {
    // A place ask needs a race to the line with a field to beat, and a tighter place than the event's.
    if (a.kind === 'finish-place')
      return plan.kind === 'classic-race' && plan.field.length >= a.n && places.every((p) => a.n < p);
    // A takedown hunt already asks for takedowns; Chad's Collab is a style contest already (run W-T).
    if (a.kind === 'takedowns' && plan.kind === 'takedown-hunt') return false;
    if (a.kind === 'style-cash' && plan.rules.rule === 'collab') return false;
    return !plan.objectives.some((o) => o.kind === a.kind);
  });
  return pick(fits, `ask:${plan.key}:${seed}`) ?? null;
}

/** The ask as an optional objective the race log judges from the moment it is asked. */
export function askObjective(ask: AskDef): ObjectiveSpec {
  const params =
    ask.kind === 'takedowns'
      ? { count: ask.n }
      : ask.kind === 'style-cash'
        ? { cash: ask.n }
        : { maxPlace: ask.n };
  return { id: `ask-${ask.id}`, kind: ask.kind, required: false, rewardCash: ask.cash, params };
}

export const ASK_LABEL = "Producer's ask";

// ---- Side gigs ------------------------------------------------------------------------------------

/** The region's side gig now: one at a time, the next one after every race (seeded by the history). */
export function currentGig(show: ShowText, profile: Profile, regionId: string): GigDef | null {
  return pick(show.gigs, `gig:${regionId}:${profile.history.length}`) ?? null;
}

/** What a gig asks, in plain words. */
export function gigNeedText(gig: GigDef): string {
  const n = gig.n;
  switch (gig.need) {
    case 'airtime':
      return n === 1 ? 'Get airborne once' : `Get airborne ${n} times`;
    case 'nearMiss':
      return `${n} near misses`;
    case 'oncoming':
      return `${n} oncoming runs`;
    case 'trick':
      return n === 1 ? 'Land a trick' : `Land ${n} tricks`;
    case 'weaponSteal':
      return n === 1 ? 'Steal a weapon' : `Steal ${n} weapons`;
    case 'takedowns':
      return n === 1 ? 'Knock a rider off' : `Knock ${n} riders off`;
    case 'finish':
      return n === 1 ? 'Win the race' : `Finish in the top ${n}`;
  }
}

/** A gig judged from a race's tally, as a bonus objective the ledger pays. */
export function gigStatus(gig: GigDef, tally: RaceTally): ObjectiveStatus {
  const style = (k: string) => tally.style[k]?.count ?? 0;
  let met: boolean;
  let kind: ObjectiveStatus['kind'] = 'style-cash';
  switch (gig.need) {
    case 'takedowns':
      kind = 'takedowns';
      met = tally.takedowns >= gig.n;
      break;
    case 'finish':
      kind = 'finish-place';
      met = tally.finished && !tally.busted && tally.place >= 1 && tally.place <= gig.n;
      break;
    default:
      met = style(gig.need) >= gig.n;
  }
  return {
    id: `gig-${gig.id}`,
    kind,
    required: false,
    rewardCash: gig.cash,
    met,
    label: `Side gig: ${gig.name}`,
  };
}

// ---- The paper ------------------------------------------------------------------------------------

export interface Moment {
  kind: MomentKind;
  /** The rival it is about (a name), or ''. */
  rival: string;
  n: number;
  secret: string;
}

export interface MomentInput {
  plan: EventPlan;
  report: SettleReport;
  tally: RaceTally;
}

/** The race's biggest moment: a boss down, a bust, a secret, a takedown, air, near misses, the result. */
export function biggestMoment(reg: ContentRegistry, input: MomentInput): Moment {
  const { plan, report, tally } = input;
  const none = { rival: '', n: 0, secret: '' };
  if (report.map?.finale)
    return { ...none, kind: 'boss', rival: plan.rules.rival ? riderName(reg, plan.rules.rival) : '' };
  if (report.outcome === 'busted') return { ...none, kind: 'bust', n: report.fine };
  const secret = report.secretsFound[0];
  if (secret) return { ...none, kind: 'secret', secret: secret.name };
  if (tally.takedowns > 0) {
    let top = '';
    let most = 0;
    for (const [id, row] of Object.entries(tally.toRivals).sort(([a], [b]) => (a < b ? -1 : 1)))
      if (row.takedowns > most) {
        most = row.takedowns;
        top = id;
      }
    return { ...none, kind: 'down', rival: top ? riderName(reg, top) : 'A rival', n: tally.takedowns };
  }
  const air = (tally.style['airtime']?.count ?? 0) + (tally.style['trick']?.count ?? 0);
  if (air >= 2) return { ...none, kind: 'air', n: air };
  const misses = tally.style['nearMiss']?.count ?? 0;
  if (misses >= 3) return { ...none, kind: 'miss', n: misses };
  if (report.won && !clearedNotWon(plan, report, tally.place)) return { ...none, kind: 'win' };
  return { ...none, kind: 'lose', n: tally.place };
}

/**
 * A race to the line cleared below first place: a finish-only or top-three event passed in 2nd to
 * last. The career counts it as won (the map, the save), but the words say CLEARED, so "won" never
 * sits beside "5th of 5" (skeptic, run W-S). A grudge, a hunt or an escape won is won at any place.
 */
export function clearedNotWon(plan: EventPlan, report: SettleReport, place: number): boolean {
  return report.outcome === 'won' && plan.kind === 'classic-race' && place !== 1;
}

export interface PaperView {
  name: string;
  style: PaperStyle;
  tagline: string;
  /** `GOLDEN HOUR EDITION · RACE 4`. */
  dateline: string;
  headline: string;
  /** The result in one line. */
  deck: string;
  /** Under the still. */
  caption: string;
  moment: MomentKind;
}

/** The region's paper after a career race: its headline built from the race's biggest moment. */
export function paperView(
  reg: ContentRegistry,
  show: ShowText,
  input: MomentInput & { racesRun: number; timeOfDay: string },
): PaperView {
  const m = biggestMoment(reg, input);
  const { plan, report, tally } = input;
  const place = tally.finished ? ordinal(tally.place) : 'nowhere';
  const vars = {
    rival: m.rival || 'A rival',
    n: m.kind === 'lose' ? place : m.n,
    secret: m.secret,
    event: plan.name,
    place,
  };
  const template =
    pick(show.heads[m.kind], `paper:${plan.key}:${input.racesRun}`) ?? FALLBACK_HEADS[m.kind][0] ?? '';
  const deck =
    report.outcome === 'busted'
      ? `${plan.name}: busted. Fine $${report.fine}.`
      : report.outcome === 'won'
        ? `${plan.name}: ${clearedNotWon(plan, report, tally.place) ? 'cleared' : 'won'}${tally.finished ? `, ${place} of ${tally.racers}` : ''}.`
        : tally.finished
          ? `${plan.name}: ${place} of ${tally.racers}. Not enough.`
          : `${plan.name}: lost.`;
  return {
    name: show.paper.name,
    style: show.paper.style,
    tagline: show.paper.tagline,
    dateline: `${input.timeOfDay.toUpperCase()} EDITION · RACE ${input.racesRun}`,
    headline: fill(template, vars),
    deck,
    caption: fill(CAPTIONS[m.kind], vars),
    moment: m.kind,
  };
}

// ---- Rival texts ----------------------------------------------------------------------------------

export interface RivalText {
  id: string;
  from: string;
  colour: string;
  /** What it remembers, in plain words: `After The Shakedown: you knocked them off twice.` */
  memory: string;
  line: string;
  grudge: number;
}

/** At most this many texts after a race. [default] */
export const MAX_TEXTS = 2;
const TIMES = ['', 'once', 'twice'];
const times = (n: number) => TIMES[n] ?? `${n} times`;

/**
 * The texts after a career race: from the rival you hurt most, and from one who beat you home,
 * each in their own voice, remembering this race and the grudge they now hold.
 */
export function rivalTexts(
  reg: ContentRegistry,
  texts: ReadonlyMap<string, RiderTexts>,
  plan: EventPlan,
  tally: RaceTally,
  /** Rivals who finished ahead of the player, first first (content ids). */
  ahead: readonly string[],
  after: Profile,
): RivalText[] {
  const out: RivalText[] = [];
  const used = new Set<string>();
  const add = (id: string, which: 'won' | 'lost', memory: string, n: number) => {
    const t = texts.get(id);
    if (!t || used.has(id) || out.length >= MAX_TEXTS) return;
    used.add(id);
    const g = grudgeOf(after, id);
    const line = g >= GRUDGE_HOT ? t.grudge : t[which];
    const rider = reg.riders[id] as unknown as Json | undefined;
    const colour = strings(obj(rider?.['look'])['palette']).find((c) => HEX.test(c)) ?? '#444444';
    out.push({
      id,
      from: riderName(reg, id),
      colour,
      memory: `After ${plan.name}: ${memory}`,
      line: fill(line, { event: plan.name, g: Math.round(g), n }),
      grudge: Math.round(g),
    });
  };
  // The one you hurt most (a takedown counts as three hits).
  let hurt = '';
  let worst = 0;
  for (const [id, row] of Object.entries(tally.toRivals).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const score = row.hits + 3 * row.takedowns + 2 * row.steals;
    if (score > worst) {
      worst = score;
      hurt = id;
    }
  }
  const hurtRow = tally.toRivals[hurt];
  if (hurt && hurtRow)
    add(
      hurt,
      'lost',
      hurtRow.takedowns > 0
        ? `you knocked them off ${times(hurtRow.takedowns)}.`
        : `you hit them ${times(hurtRow.hits)}.`,
      hurtRow.takedowns || hurtRow.hits,
    );
  // One who beat you home.
  for (const id of ahead) {
    if (used.has(id)) continue;
    add(id, 'won', 'they finished ahead of you.', 0);
    break;
  }
  // A quiet race still gets a word from the field.
  if (out.length === 0) {
    const first = tally.field.find((id) => texts.has(id));
    if (first) add(first, tally.finished && !tally.busted ? 'lost' : 'won', 'they saw the whole thing.', 0);
  }
  return out;
}

// ---- The pause screen's map -----------------------------------------------------------------------

export interface PauseMapView {
  panel: MapPanel;
  /** The player on the map, or null when the road is not on it. */
  here: { x: number; z: number } | null;
  title: string;
}

/** The map panel holding the road the player is on, with the player marked. */
export function pauseMap(
  reg: ContentRegistry,
  def: CareerDef,
  panels: readonly MapPanel[],
  roadId: string,
  s: number,
): PauseMapView | null {
  const panel = panels.find((p) => p.roads.some((r) => r.id === roadId)) ?? panels[0];
  if (!panel) return null;
  let here: { x: number; z: number } | null = null;
  if (panel.roads.some((r) => r.id === roadId)) {
    for (const pack of [def.pack, packOf(def.regionKey), 'base']) {
      const road = reg.roads[qualify(pack, roadId)] as unknown as Json | undefined;
      const data = obj(obj(road?.['samples'])['data']);
      const xs = data['x'];
      const zs = data['z'];
      if (!Array.isArray(xs) || !Array.isArray(zs) || xs.length === 0) continue;
      const spacing = typeof road?.['sampleSpacingM'] === 'number' ? road['sampleSpacingM'] : 2;
      const i = Math.max(0, Math.min(xs.length - 1, Math.round(s / spacing)));
      here = { x: Number(xs[i]), z: Number(zs[i]) };
      break;
    }
  }
  return { panel, here, title: `${def.name} · ${panel.name}` };
}
