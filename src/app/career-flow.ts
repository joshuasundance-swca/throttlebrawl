// The career's lazy chunk (run W-R): everything app/ needs from src/career/ and the export code,
// plus the views it hands ui/ (pure functions of the registry, the career files and the profile, so
// they test without a DOM). app/index.ts imports this file only with import(), so the career's code
// stays out of the first-load JavaScript (its budget: tests/perf/budget.json). The flow itself
// (starting a career race, settling it, the race-first start) is in app/index.ts, beside the
// free-play race it shares a loop with.
import {
  careerMap,
  careerView,
  currentGig,
  eventPlan,
  garageBikes,
  garagePaints,
  gigNeedText,
  paperView,
  pauseMap,
  pickAsk,
  posterView,
  progressOf,
  riderTexts,
  rivalTexts,
  showOf,
  suggestedNode,
  type AskDef,
  type CareerDef,
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
import type { Profile } from '../save';
import type { CareerResultView, CareerShowView, GarageView, TeaserView } from '../ui';
import { formatSpeed, ordinal } from '../ui';

/** The garage rows, speeds in the player's units. */
export function garageView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  units: 'mph' | 'kmh',
): GarageView {
  const current = profile.bikes.current;
  return {
    cash: profile.cash,
    bikes: garageBikes(reg, defs, profile).map((b) => ({
      key: b.key,
      name: b.name,
      speed: formatSpeed(b.topSpeedMps, units),
      priceCash: b.priceCash,
      state: b.state,
      current: b.current,
      secret: b.secret,
      reason: b.reason,
    })),
    paints: garagePaints(defs, profile).map((p) => ({ ...p })),
    paint: current ? (profile.bikes.paint[current] ?? null) : null,
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
): CareerResultView {
  const title =
    report.outcome === 'won'
      ? 'WON'
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
    nextName: next ? eventPlan(reg, next.event).name : null,
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
        return [card.id, posterView(reg, lines, eventPlan(reg, node?.event ?? ''), card.timeOfDay, profile)];
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

/** The node the career suggests in a region, or null. */
export function nextNodeOf(def: CareerDef, profile: Profile) {
  return suggestedNode(def, progressOf(def, profile.regions));
}

export {
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
  firstRace,
  nodeLength,
  nodeOf,
  paintBike,
  rideBike,
  settleRace,
  startCareer,
  withPromptsSeen,
} from '../career';
export { decodeExportCode, encodeExportCode } from '../save';

/** This module, as app/index.ts holds it once loaded. */
export type CareerFlow = typeof import('./career-flow');
