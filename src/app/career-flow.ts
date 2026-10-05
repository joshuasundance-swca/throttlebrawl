// The career's lazy chunk (run W-R): everything app/ needs from src/career/ and the export code,
// plus the views it hands ui/ (pure functions of the registry, the career files and the profile, so
// they test without a DOM). app/index.ts imports this file only with import(), so the career's code
// stays out of the first-load JavaScript (its budget: tests/perf/budget.json). The flow itself
// (starting a career race, settling it) is in app/index.ts, beside the
// free-play race it shares a loop with.
import {
  backupCode,
  bikeLadder,
  careerMap,
  careerView,
  clearedNotWon,
  currentGig,
  eventPlan,
  fieldLevel,
  garageBikes,
  garagePaints,
  gigNeedText,
  globalTier,
  paperView,
  pauseMap,
  pickAsk,
  posterView,
  progressOf,
  newCareer,
  regionOpen,
  repairBill,
  riderTexts,
  rivalTexts,
  rideRefusal,
  seasonPurseScale,
  seasonRace,
  showOf,
  startCareer,
  suggestedNode,
  tierPurse,
  tierReached,
  type AskDef,
  type CareerDef,
  type CareerNode,
  type CareerView,
  type EventPlan,
  type GigDef,
  type PaperView,
  type PauseMapView,
  type RaceStatus,
  type RaceTally,
  type RivalText,
  type SettleReport,
} from '../career';
import type { ContentRegistry } from '../content';
import type { EventPatch, FieldLevel } from '../sim/api';
import { MAX_CAREER_BACKUPS, type Profile } from '../save';
import type { CareerResultView, CareerShowView, GarageView, TeaserView } from '../ui';
import { formatSpeed, ordinal } from '../ui';

/**
 * About what one race pays now (playtest 3, the garage: "how many races each takes to afford"):
 * the purse of the highest tier open in any open region, in the season's scale, to the $50. It is
 * an estimate by the design's own table, not a promise: a loss pays less, style and the ask add.
 */
export function typicalRacePay(defs: readonly CareerDef[], profile: Profile): number {
  let g = 1;
  for (const d of defs) {
    if (!regionOpen(defs, profile, d)) continue;
    g = Math.max(g, globalTier(defs, d, tierReached(d, progressOf(d, profile.regions)) - 1));
  }
  return Math.round((tierPurse(g) * seasonPurseScale(profile.season)) / 50) * 50;
}

/** The garage rows, speeds in the player's units. */
export function garageView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  units: 'mph' | 'kmh',
): GarageView {
  const current = profile.bikes.current;
  const ladder = bikeLadder(reg, defs).map((l) => l.key);
  return {
    cash: profile.cash,
    racePay: typicalRacePay(defs, profile),
    bikes: garageBikes(reg, defs, profile).map((b) => {
      const step = ladder.indexOf(b.key) + 1;
      return {
        key: b.key,
        name: b.name,
        speed: formatSpeed(b.topSpeedMps, units),
        priceCash: b.priceCash,
        state: b.state,
        current: b.current,
        secret: b.secret,
        reason: b.reason,
        ...(step > 0 ? { step, steps: ladder.length } : {}),
        repairCash: repairBill(1, b.priceCash, Infinity).cash,
      };
    }),
    paints: garagePaints(defs, profile).map((p) => ({ ...p })),
    paint: current ? (profile.bikes.paint[current] ?? null) : null,
    backups: profile.careerBackups.map((b) => ({
      code: b.code,
      label: `Season ${b.season}${b.at ? `, kept ${b.at.slice(0, 10)}` : ''}`,
    })),
  };
}

/** The career map screen's view for a region (bare or qualified id). */
export function mapView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  region: string,
): CareerView {
  return careerView(reg, defs, profile, region);
}

const riderName = (reg: ContentRegistry, key: string) =>
  reg.riders[key]?.name ?? key.slice(key.indexOf(':') + 1);

/**
 * What a career race runs this season (playtest 3): the remix patch (null in Season 1), the event
 * plan with it applied, the length it races, and the field level of its tier and season (null when
 * the registry has no starting bike to measure by). app/ passes the patch and the level to
 * buildSimConfig and runs the race log on the plan.
 */
export interface CareerRaceSetup {
  patch: EventPatch | null;
  plan: EventPlan;
  length: { id: string; route: string } | null;
  fieldLevel: FieldLevel | null;
}

export function careerRaceSetup(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  def: CareerDef,
  node: CareerNode,
): CareerRaceSetup {
  const { patch, plan, length } = seasonRace(reg, defs, profile, def, node);
  return { patch, plan, length, fieldLevel: fieldLevel(reg, defs, def, node, profile.season) };
}

/**
 * The New career button (playtest 3, round 3: "a 'New career' button that keeps the old save as a
 * backup code"): the old career as an export code kept in the save, and a fresh career. A career
 * with no race run yet has nothing to keep, so it comes back as it is (`kept` false): a stray tap
 * must never push a real backup off the newest few.
 */
export async function startNewCareer(
  defs: readonly CareerDef[],
  profile: Profile,
  buildId: string,
  at: string,
): Promise<{ profile: Profile; kept: boolean }> {
  if (profile.history.length === 0) return { profile, kept: false };
  const code = await backupCode(profile, buildId, at);
  return { profile: newCareer(defs, profile, { code, at }), kept: true };
}

/**
 * Loading a backup code (or any export code) as the career: the profile the code carries, with the
 * career it replaces kept as a backup of its own (when it has raced) and the backups already kept,
 * the newest few, so restoring never loses a career.
 */
export async function restoreCareer(
  defs: readonly CareerDef[],
  current: Profile,
  loaded: Profile,
  buildId: string,
  at: string,
): Promise<Profile> {
  const replaced =
    current.history.length > 0
      ? [{ code: await backupCode(current, buildId, at), at, season: current.season }]
      : [];
  const seen = new Set<string>();
  const careerBackups = [...loaded.careerBackups, ...current.careerBackups, ...replaced]
    .filter((b) => !seen.has(b.code) && seen.add(b.code))
    .slice(-MAX_CAREER_BACKUPS);
  return startCareer(defs, { ...loaded, careerBackups });
}

/** The career results screen: the outcome, the objectives, every dollar, and what changed. */
export function resultView(
  reg: ContentRegistry,
  def: CareerDef,
  plan: EventPlan,
  status: RaceStatus,
  report: SettleReport,
  place: number,
  racers: number,
  after: Profile,
  /** Every career (the season's remix draws on them); left out: this one alone. */
  defs: readonly CareerDef[] = [def],
): CareerResultView {
  // A race to the line cleared below first is CLEARED, never WON beside "5th of 5" (skeptic, run W-S).
  const cleared = clearedNotWon(plan, report, place)
    ? `${place >= 1 ? `${ordinal(place).toUpperCase()} OF ${racers}. ` : ''}CLEARED.`
    : null;
  const title =
    report.outcome === 'won'
      ? (cleared ?? 'WON')
      : report.outcome === 'busted'
        ? 'BUSTED'
        : report.outcome === 'quit'
          ? 'QUIT'
          : report.outcome === 'placed'
            ? `${ordinal(place).toUpperCase()} OF ${racers}. NOT ENOUGH.`
            : 'LOST';
  const news: string[] = [];
  for (const t of report.map?.tiersOpened ?? []) news.push(`${t} is open.`);
  const claimed = report.map?.claimed.length ?? 0;
  if (claimed > 0) news.push(`${claimed === 1 ? 'A road' : `${claimed} roads`} claimed on the map.`);
  for (const s of report.secretsFound) news.push(`Found: ${s.name}.`);
  for (const b of report.unlocked) news.push(`Unlocked: ${reg.bikes[b]?.name ?? b}. It's in the garage.`);
  for (const g of report.grudges)
    if (g.after >= 3 && g.after > g.before)
      news.push(`${riderName(reg, g.rival)} holds a grudge: ${g.after} of 10.`);
  const next = suggestedNode(def, progressOf(def, after.regions));
  return {
    title,
    eventName: plan.name,
    objectives: status.objectives.map((o) => ({ label: o.label, met: o.met, required: o.required })),
    lines: report.lines,
    fine: report.fine,
    cashAfter: report.cashAfter,
    news,
    nextName: next ? seasonRace(reg, defs, after, def, next).plan.name : null,
  };
}

/** The teaser after a boss: its lines, and the region it points to when the build carries it. */
export function teaserView(defs: readonly CareerDef[], report: SettleReport): TeaserView | null {
  const t = report.teaser;
  if (!t) return null;
  const next = t.next ? defs.find((d) => d.regionKey === t.next) : undefined;
  return { lines: t.lines, next: next ? { id: next.regionId, name: next.regionName } : null };
}

// ---- The career show (run W-S, career-show lane) ---------------------------------------------------

/**
 * The map screen's show for a region: each event's poster (the stream's quiet frame), the region's
 * side gig now, and the latest rival texts (app/ keeps them from the last career race).
 */
export function showMapView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  view: CareerView,
  texts: readonly RivalText[],
): CareerShowView {
  const def = defs.find((d) => d.regionId === view.region.id);
  if (!def) return { posters: {}, gig: null, texts };
  const lines = riderTexts(reg, defs);
  const posters: CareerShowView['posters'] = Object.fromEntries(
    view.tiers
      .flatMap((t) => t.nodes)
      .map((card) => {
        const node = def.nodes.find((x) => x.id === card.id);
        // The season's plan: a remixed event's poster shows what it is this season.
        const plan = node ? seasonRace(reg, defs, profile, def, node).plan : eventPlan(reg, '');
        return [card.id, posterView(reg, lines, plan, card.timeOfDay, profile)];
      }),
  );
  const gig = currentGig(showOf(reg, def), profile, def.regionId);
  return {
    posters,
    gig: gig
      ? { name: gig.name, need: gigNeedText(gig), text: gig.text, cash: gig.cash, regionName: def.regionName }
      : null,
    texts,
  };
}

/** What a career race brings with it: the producer's one ask (seeded by the race) and the side gig. */
export function raceShow(
  reg: ContentRegistry,
  def: CareerDef,
  plan: EventPlan,
  profile: Profile,
  seed: number,
): { ask: AskDef | null; gig: GigDef | null } {
  const show = showOf(reg, def);
  return { ask: pickAsk(show, plan, seed), gig: currentGig(show, profile, def.regionId) };
}

/** After a career race: the region's paper and the rivals' texts. */
export function showResult(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  def: CareerDef,
  plan: EventPlan,
  report: SettleReport,
  tally: RaceTally,
  ahead: readonly string[],
  after: Profile,
  timeOfDay: string,
): { paper: PaperView; texts: RivalText[] } {
  return {
    paper: paperView(reg, showOf(reg, def), {
      plan,
      report,
      tally,
      racesRun: after.history.length,
      timeOfDay,
    }),
    texts: rivalTexts(reg, riderTexts(reg, defs), plan, tally, ahead, after),
  };
}

/** The pause screen's map: the region's network the player is on, with the player marked. */
export function pauseMapView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  regionKey: string,
  roadId: string,
  s: number,
): PauseMapView | null {
  const def = defs.find((d) => d.regionKey === regionKey);
  if (!def) return null;
  return pauseMap(reg, def, careerMap(reg, def, profile), roadId, s);
}

/**
 * Why a career race may not start at a node (a shut region, a locked node), in plain words with
 * the events named, or null when it may. app/index.ts asks before every career race starts, so no
 * button or dev hook rides past the chapter order or the tier gates (playtest 3, round 3).
 */
export function rideLock(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  def: CareerDef,
  node: CareerNode,
): string | null {
  const nameOf = (id: string): string => {
    const n = def.nodes.find((x) => x.id === id);
    return n ? eventPlan(reg, n.event).name : id;
  };
  return rideRefusal(defs, profile, def, node, nameOf);
}

/** The node the career suggests in a region, or null. */
export function nextNodeOf(def: CareerDef, profile: Profile) {
  return suggestedNode(def, progressOf(def, profile.regions));
}

export {
  canStartSeason,
  seasonLabel,
  startSeason,
  ASK_AT_FRACTION,
  ASK_LABEL,
  askObjective,
  currentPaintHex,
  gigStatus,
  bare,
  buyBike,
  buyPaint,
  careerDefs,
  careerOf,
  createOnboarding,
  createRaceLog,
  eventPlan,
  nodeLength,
  nodeOf,
  paintBike,
  incidentSites,
  receiptBoards,
  rideBike,
  settleRace,
  startCareer,
  withPromptsSeen,
} from '../career';
export { decodeExportCode, encodeExportCode } from '../save';

/** This module, as app/index.ts holds it once loaded. */
export type CareerFlow = typeof import('./career-flow');
