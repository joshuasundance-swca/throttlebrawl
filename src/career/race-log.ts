// One career race, watched from the sim's public events and snapshots (docs/content-packs.md,
// "Event": objectives and rules by kind; the product spec's four event types). The career reads
// the race; it never writes sim state, so a race replays the same whether or not a career watched
// it. Everything here is a pure function of the event stream and the snapshots, so the app and the
// headless career test run the very same rules. DOM-free.
//
// The four event types' win rules [default; the product spec's table]:
// - classic race: finish at or above `finish-place.maxPlace`;
// - takedown hunt: `rules.targetCount` takedowns (on any rider, or the listed ones) before the
//   finish (or `timeLimitS`); with `endOnCount` the event ends at the count;
// - cop escape: get away from the law (interview, 2026-10-02: "survive or lose the heat"). The clock
//   starts when a cop first chases you: survive `surviveS` (or ride `escapeDistanceM`) from there,
//   or lose them (no cop on you for LOSE_HEAT_S after MIN_CHASE_S of chase, or, run W-T, cross the
//   END OF JURISDICTION sign with them on you), or reach the finish; a bust fails it;
// - grudge match: beat `rules.rival` to the line (`finish-ahead`) or knock them down
//   `knockdownsToWin` times (`knockdowns`).
// Optional objectives pay their `rewardCash` as bonuses: `style-cash` (score that much style
// cash) and `ride-branch` (ride a route branch).
//
// Grudge rules (run W-T, the pitch deck's #14: "each tier closes on a grudge match played by the
// rival's own rule"; `rules.rule`, [default] content the maintainer can veto). Three change the
// score here, from the public events alone:
// - `audit` (Kevin's "The Audit"): every hit the rival lands on you adds a line item, one more
//   knockdown to the count, up to AUDIT_MAX_LINE_ITEMS;
// - `collab` (Chad's "The Collab"): the most style cash at your finish wins, not the place: your
//   style events against the rival's, decided when you cross (a tie is not a win);
// - `timber` (Old Growth's): only traffic and scenery takedowns of the rival count toward the
//   knockdowns (his own `orKnockdowns` as a boss too), which teaches the fast way to win a fight.
// The fourth, `bad-connection` (Dial-Up's), changes how he rides, so it lives in the sim.
import type { GrudgeRuleId, SimEvent, SimSnapshot, EntitySnapshot } from '../sim/api';
import type { CareerSecret } from './defs';

export const OBJECTIVE_KINDS = [
  'finish-place',
  'takedowns',
  'escape',
  'beat-rival',
  'style-cash',
  'ride-branch',
] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];
export type EventKind = 'classic-race' | 'takedown-hunt' | 'cop-escape' | 'grudge-match';

export interface ObjectiveSpec {
  id: string;
  kind: ObjectiveKind;
  required: boolean;
  rewardCash: number;
  params: Readonly<Record<string, unknown>>;
}

/** An event's rules block, with rider references qualified. */
export interface RaceRules {
  kind: EventKind;
  targetCount?: number;
  timeLimitS?: number;
  /** `any`, or qualified rider ids. */
  targets?: 'any' | readonly string[];
  endOnCount?: boolean;
  escapeBy?: 'distance' | 'survive';
  escapeDistanceM?: number;
  surviveS?: number;
  /** Qualified rider id. */
  rival?: string;
  winBy?: 'finish-ahead' | 'knockdowns';
  knockdownsToWin?: number;
  grudgeStakes?: number;
  /** The rival's own rule (run W-T), or absent. */
  rule?: GrudgeRuleId;
}

/** The Audit's cap: at most this many knockdowns his hits add to the count. [default] */
export const AUDIT_MAX_LINE_ITEMS = 2;

/**
 * Losing the heat [default]: after a cop has been on you for MIN_CHASE_S in all, LOSE_HEAT_S with
 * no cop on you. (A cop who looks your way for a moment and picks someone else is no chase.)
 */
export const LOSE_HEAT_S = 8;
export const MIN_CHASE_S = 10;
/** How close (m along the same road) a rider passes a map secret to find it. [default] */
export const SECRET_RADIUS_M = 60;

export type RaceState = 'running' | 'won' | 'lost';

export interface ObjectiveStatus {
  id: string;
  kind: ObjectiveKind;
  required: boolean;
  rewardCash: number;
  /** Met (true), failed (false), or still open (null). */
  met: boolean | null;
  /** One short line for the HUD and the results: `TAKEDOWNS 1/3`. */
  label: string;
}

export interface RaceStatus {
  state: RaceState;
  /** The event is decided and ends now (a hunt at its count, an escape, a grudge knockdown). */
  endNow: boolean;
  objectives: ObjectiveStatus[];
  /** The required objectives' lines, joined, for the HUD. */
  headline: string;
}

/** What the race did for the career: the ledger, the grudges and the map read it. */
export interface RaceTally {
  finished: boolean;
  /** Final place among the racers, 1 = first, 0 when not finished. */
  place: number;
  /** Racers in the field (the player included, the law not). */
  racers: number;
  busted: boolean;
  fineCash: number;
  /**
   * Citations a citations cop billed at the finish (run W-T, law with a personality: Deputy
   * Lindqvist), and their cash; settled like a fine. Absent means none.
   */
  citations?: number;
  citationCash?: number;
  takedowns: number;
  /** Style cash by kind (`nearMiss`, `takedownCombo`, ...), and how many of each. */
  style: Readonly<Record<string, { count: number; cash: number }>>;
  styleCash: number;
  /** By rival content id: what the player did to them. */
  toRivals: Readonly<Record<string, { hits: number; takedowns: number; steals: number }>>;
  /** Route branches ridden, `<route>#<branch>`. */
  branches: readonly string[];
  /** Map secret ids passed. */
  secrets: readonly string[];
  /** The rivals who rode (content ids; the law not), and the player's own content id. */
  field: readonly string[];
  player: string;
  /**
   * What the world will remember (run W-T, "a world that keeps receipts"): each rival the player put
   * into a vehicle, and a bust, with where it happened, in race order, at most MAX_INCIDENTS. Absent
   * means none (a tally built by hand).
   */
  incidents?: readonly RaceIncident[];
}

/** One thing a race did that the world keeps a receipt for. Only what the events said happened. */
export interface RaceIncident {
  kind: 'takedown' | 'bust';
  /** The road id and how far along it (whole metres): the victim's spot, or the player's at a bust. */
  road: string;
  s: number;
  /** A takedown's rival and the vehicle (traffic content id) they went into; null at a bust. */
  rival: string | null;
  vehicle: string | null;
}

/** The most incidents one race keeps. [default] */
export const MAX_INCIDENTS = 3;

export interface RaceLogSetup {
  playerId: number;
  rules: RaceRules;
  objectives: readonly ObjectiveSpec[];
  /** The route raced (bare id), for `<route>#<branch>`. */
  routeId: string;
  /** The road id of each network edge index (`config.road.edges[i].id`). */
  roadIds: readonly string[];
  /** The region's map secrets (found by riding past their point, or down their branch). */
  secrets?: readonly CareerSecret[];
}

export interface RaceLog {
  /** Reads one step: its events, and the snapshot after it. */
  note(events: readonly SimEvent[], snapshot: SimSnapshot): void;
  status(): RaceStatus;
  tally(): RaceTally;
  /** World seconds since the start. */
  readonly seconds: number;
}

const n = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const isRacer = (e: EntitySnapshot) => e.kind === 'rider' && e.faction !== 'law';

/**
 * Whether a ridden `<route>#<branch>` matches a wanted branch: the same pair, or the same branch on
 * any route (a shortcut shared by several routes is one secret).
 */
export function rodeBranch(ridden: Iterable<string>, wanted: string): boolean {
  if (!wanted) return false;
  const branch = wanted.slice(wanted.indexOf('#') + 1);
  for (const b of ridden) if (b === wanted || b.slice(b.indexOf('#') + 1) === branch) return true;
  return false;
}

export function createRaceLog(setup: RaceLogSetup): RaceLog {
  const me = setup.playerId;
  const r = setup.rules;
  let seconds = 0;
  let finished = false;
  let place = 0;
  let racers = 0;
  let busted = false;
  let fineCash = 0;
  let citations = 0;
  let citationCash = 0;
  let takedowns = 0;
  let targetTakedowns = 0;
  const style: Record<string, { count: number; cash: number }> = {};
  let styleCash = 0;
  const toRivals: Record<string, { hits: number; takedowns: number; steals: number }> = {};
  const branches = new Set<string>();
  const secrets = new Set<string>();
  const contentOf = new Map<number, string>();
  let field: string[] = [];
  let player = '';
  // The grudge rival: their entity, whether they finished first, and knockdowns on them.
  let rivalId = -1;
  let rivalFinishedFirst = false;
  let rivalKnockdowns = 0;
  // The rules' counts (run W-T): his hits on you (the Audit), his style cash (the Collab).
  let hitsByRival = 0;
  let rivalStyleCash = 0;
  // Receipts (run W-T): a rider's crash into a vehicle, by cause id (the takedown comes a tick
  // later with the same cause), and the incidents kept.
  const crashes = new Map<number, { vehicle: string; road: string; s: number }>();
  const incidents: RaceIncident[] = [];
  const spotOf = (e: EntitySnapshot | undefined) =>
    e ? { road: setup.roadIds[e.road.edge] ?? '', s: Math.round(e.road.s) } : null;
  // The law: when a chase on the player began, the last second a cop was on them, the progress then.
  let chaseStartS = -1;
  let chaseStartProgress = 0;
  let lastHeatS = -1;
  /** Seconds a cop has been on the player in all. */
  let heatS = 0;
  let lostHeat = false;
  let escaped = false;
  let progress = 0;
  let decidedEnd = false;
  let last: SimSnapshot | null = null;
  let lastBranch: string | null = null;

  const targets = r.targets;
  const counts = (victim: string) =>
    !targets || targets === 'any' || targets.length === 0 || targets.includes(victim);
  const rival = (contentId: string) => {
    let row = toRivals[contentId];
    if (!row) toRivals[contentId] = row = { hits: 0, takedowns: 0, steals: 0 };
    return row;
  };

  const raceOverForMe = () => finished || busted;

  function evaluate(): RaceStatus {
    const over = raceOverForMe() || (last?.race.over ?? false);
    const timeUp = r.timeLimitS !== undefined && seconds >= r.timeLimitS;
    const out: ObjectiveStatus[] = setup.objectives.map((o) => {
      const p = o.params;
      let met: boolean | null = null;
      let label = '';
      switch (o.kind) {
        case 'finish-place': {
          const max = n(p['maxPlace'], 3);
          label = max >= racers && racers > 0 ? 'FINISH' : `FINISH TOP ${max}`;
          if (busted) met = false;
          else if (finished) met = place >= 1 && place <= max;
          else if (over) met = false;
          break;
        }
        case 'takedowns': {
          const want = Math.max(1, Math.round(n(p['count'], r.targetCount ?? 1)));
          const have = targetTakedowns;
          label = `TAKEDOWNS ${Math.min(have, want)}/${want}`;
          if (have >= want) met = true;
          else if (over || timeUp) met = false;
          break;
        }
        case 'escape': {
          label = escapeLabel();
          if (busted) met = false;
          else if (escaped || finished) met = true;
          else if (over) met = false;
          break;
        }
        case 'beat-rival': {
          const byKnockdowns = (p['winBy'] ?? r.winBy) === 'knockdowns';
          // The Audit: his hits on you are line items, each one more knockdown to the count.
          const lineItems = r.rule === 'audit' ? Math.min(AUDIT_MAX_LINE_ITEMS, hitsByRival) : 0;
          const want = Math.max(1, Math.round(n(p['knockdowns'], r.knockdownsToWin ?? 1))) + lineItems;
          // A boss may be beaten either way: to the line, or knocked down `orKnockdowns` times.
          const or = Math.round(n(p['orKnockdowns'], 0));
          const timber = r.rule === 'timber';
          if (r.rule === 'collab' && !byKnockdowns) {
            // The Collab: views decide it, counted when you cross.
            label = `MOST STYLE: YOU $${styleCash} · THEM $${rivalStyleCash}`;
            if (busted) met = false;
            else if (finished) met = styleCash > rivalStyleCash;
            else if (over) met = false;
          } else if (byKnockdowns) {
            const have = Math.min(rivalKnockdowns, want);
            label = timber
              ? `TIMBER ${have}/${want}: INTO TRAFFIC OR SCENERY`
              : `KNOCK DOWN ${have}/${want}` +
                (lineItems > 0 ? ` · ${lineItems} LINE ITEM${lineItems > 1 ? 'S' : ''}` : '');
            if (rivalKnockdowns >= want) met = true;
            else if (over) met = false;
          } else {
            label =
              or > 0
                ? `BEAT THEM HOME OR ${timber ? 'FELL' : 'DROP'} THEM ${Math.min(rivalKnockdowns, or)}/${or}`
                : 'BEAT YOUR RIVAL HOME';
            if (or > 0 && rivalKnockdowns >= or && !busted) met = true;
            else if (rivalFinishedFirst || busted) met = false;
            else if (finished) met = true;
            else if (over) met = rivalId < 0; // the rival never made it: you beat them
          }
          break;
        }
        case 'style-cash': {
          const want = Math.max(1, Math.round(n(p['cash'], 500)));
          label = `STYLE $${Math.min(styleCash, want)}/$${want}`;
          if (styleCash >= want) met = true;
          else if (over) met = false;
          break;
        }
        case 'ride-branch': {
          const want = typeof p['branch'] === 'string' ? p['branch'] : '';
          label = 'FIND THE SHORTCUT';
          if (rodeBranch(branches, want)) met = true;
          else if (over) met = false;
          break;
        }
      }
      return { id: o.id, kind: o.kind, required: o.required, rewardCash: o.rewardCash, met, label };
    });
    const required = out.filter((o) => o.required);
    const state: RaceState = required.some((o) => o.met === false)
      ? 'lost'
      : required.every((o) => o.met === true)
        ? 'won'
        : 'running';
    if (state !== 'running' && !raceOverForMe()) {
      // Decided early: a hunt at its count (endOnCount), an escape, a grudge settled.
      // A grudge won before the line was won by knockdowns.
      if (state === 'won')
        decidedEnd ||=
          (r.kind === 'takedown-hunt' && r.endOnCount === true) ||
          r.kind === 'cop-escape' ||
          r.kind === 'grudge-match';
      else decidedEnd ||= r.kind !== 'classic-race';
    }
    return {
      state,
      endNow: decidedEnd,
      objectives: out,
      headline: required.map((o) => o.label).join(' · '),
    };
  }

  function escapeLabel(): string {
    if (chaseStartS < 0) return 'LOSE THE COPS';
    if (lostHeat) return 'LOST THE COPS';
    if (r.escapeBy === 'distance' && r.escapeDistanceM) {
      const gone = Math.max(0, progress - chaseStartProgress);
      return `ESCAPE ${Math.min(Math.round(gone), r.escapeDistanceM)}/${r.escapeDistanceM} M`;
    }
    const want = r.surviveS ?? 60;
    return `SURVIVE ${Math.min(Math.floor(seconds - chaseStartS), want)}/${want} S`;
  }

  return {
    get seconds() {
      return seconds;
    },
    note(events, snap) {
      last = snap;
      seconds += n(snap.timeScale, 1) / 60;
      if (contentOf.size === 0) {
        for (const e of snap.entities) if (e.kind === 'rider') contentOf.set(e.id, e.contentId);
        racers = snap.entities.filter(isRacer).length;
        field = snap.entities.filter((e) => isRacer(e) && e.id !== me).map((e) => e.contentId);
        player = snap.entities[me]?.contentId ?? '';
        if (r.rival)
          rivalId = snap.entities.find((e) => e.kind === 'rider' && e.contentId === r.rival)?.id ?? -1;
      }
      const meNow = snap.entities[me];
      for (const e of events) {
        const target = e.target ?? -1;
        const victim = contentOf.get(target) ?? '';
        switch (e.type) {
          case 'finish':
            if (e.actor === me && !finished && !busted) {
              finished = true;
              place = n(e.data['place'], 0);
            } else if (e.actor === rivalId && !finished) rivalFinishedFirst = true;
            break;
          case 'bust':
            if (target === me && !busted && !finished) {
              busted = true;
              fineCash = Math.max(0, Math.round(n(e.data['fineCash'], 0)));
              const at = spotOf(meNow);
              if (at?.road && incidents.length < MAX_INCIDENTS)
                incidents.push({ kind: 'bust', ...at, rival: null, vehicle: null });
            }
            break;
          case 'crash': {
            // A rival going down against a vehicle: kept by cause id for the takedown that follows.
            const into = snap.entities[target];
            const at = spotOf(snap.entities[e.actor]);
            if (into?.kind === 'vehicle' && contentOf.has(e.actor) && at?.road && e.causeId !== undefined)
              crashes.set(e.causeId, { vehicle: into.contentId, ...at });
            break;
          }
          case 'takedown':
            if (e.actor === me && target !== me) {
              takedowns++;
              if (counts(victim)) targetTakedowns++;
              if (victim) rival(victim).takedowns++;
              // Receipts: a rival the player put into a vehicle.
              const crash = e.causeId !== undefined ? crashes.get(e.causeId) : undefined;
              if (crash && victim && incidents.length < MAX_INCIDENTS)
                incidents.push({
                  kind: 'takedown',
                  road: crash.road,
                  s: crash.s,
                  rival: victim,
                  vehicle: crash.vehicle,
                });
              // Timber: only a fall into traffic or scenery fells him.
              const felled = e.data['kind'] === 'traffic' || e.data['kind'] === 'scenery';
              if (target === rivalId && (r.rule !== 'timber' || felled)) rivalKnockdowns++;
            }
            break;
          case 'hit':
            if (e.actor === me && victim && target !== me) rival(victim).hits++;
            else if (e.actor === rivalId && rivalId >= 0 && target === me) hitsByRival++;
            break;
          case 'law':
            // Run W-T: the citations billed at the finish; and the END OF JURISDICTION sign, crossed
            // with the law on you, loses them at once.
            if (target !== me) break;
            if (e.data['kind'] === 'bill') {
              citations = Math.max(0, Math.round(n(e.data['count'], 0)));
              citationCash = Math.max(0, Math.round(n(e.data['totalCash'], 0)));
            } else if (e.data['kind'] === 'jurisdiction' && chaseStartS >= 0 && !busted) lostHeat = true;
            break;
          case 'weaponGrab':
            if (e.actor === me && e.data['source'] === 'steal' && victim) rival(victim).steals++;
            break;
          case 'style':
            if (e.actor === me) {
              const kind = String(e.data['kind'] ?? 'style');
              const cash = Math.round(n(e.data['points'], 0));
              const row = (style[kind] ??= { count: 0, cash: 0 });
              row.count++;
              row.cash += cash;
              styleCash += cash;
            } else if (e.actor === rivalId && rivalId >= 0) {
              rivalStyleCash += Math.round(n(e.data['points'], 0));
            }
            break;
        }
      }
      if (meNow) {
        progress = meNow.progress;
        // The law: a cop whose target is the player is on them.
        const heat = snap.entities.some((e) => e.faction === 'law' && e.targetId === me && e.mode === 'Road');
        const dt = n(snap.timeScale, 1) / 60;
        if (heat) {
          if (chaseStartS < 0) {
            chaseStartS = seconds;
            chaseStartProgress = progress;
          }
          lastHeatS = seconds;
          heatS += dt;
        } else if (heatS >= MIN_CHASE_S && !busted && seconds - lastHeatS >= LOSE_HEAT_S) lostHeat = true;
        if (r.kind === 'cop-escape' && chaseStartS >= 0 && !busted) {
          const survived = r.escapeBy !== 'distance' && seconds - chaseStartS >= (r.surviveS ?? 60);
          const distance =
            r.escapeBy === 'distance' && progress - chaseStartProgress >= (r.escapeDistanceM ?? 2000);
          if (survived || distance || lostHeat) escaped = true;
        }
        // Branches: a new one under the wheels is ridden.
        const branch = meNow.branch ?? null;
        if (branch && branch !== lastBranch) branches.add(`${setup.routeId}#${branch}`);
        lastBranch = branch;
        // Secrets: passed within reach of their point on the same road, or a shortcut ridden.
        const road = setup.roadIds[meNow.road.edge] ?? '';
        for (const s of setup.secrets ?? []) {
          if (secrets.has(s.id)) continue;
          const near = s.road === road && Math.abs(meNow.road.s - s.s) <= SECRET_RADIUS_M;
          const length = snap.race.routeLength;
          const pastSpot = s.atFraction !== null && length > 0 && progress >= s.atFraction * length;
          if (near || pastSpot || (s.kind === 'shortcut' && rodeBranch(branches, s.ref))) secrets.add(s.id);
        }
      }
      // A finish by the player fixes the place; a classified finish at the timeout too.
      if (finished && place === 0) {
        const order = snap.race.finishOrder;
        place = order.includes(me) ? order.indexOf(me) + 1 : 0;
      }
      evaluate();
    },
    status: evaluate,
    tally(): RaceTally {
      return {
        finished,
        place: finished ? place : 0,
        racers,
        busted,
        fineCash,
        citations,
        citationCash,
        takedowns,
        style: Object.fromEntries(Object.entries(style).map(([k, v]) => [k, { ...v }])),
        styleCash,
        toRivals: Object.fromEntries(Object.entries(toRivals).map(([k, v]) => [k, { ...v }])),
        branches: [...branches].sort(),
        secrets: [...secrets].sort(),
        field: [...field],
        player,
        incidents: incidents.map((i) => ({ ...i })),
      };
    },
  };
}
