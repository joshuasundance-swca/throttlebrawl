// The career's lazy chunk (run W-R): everything app/ needs from src/career/ and the export code,
// plus the views it hands ui/ (pure functions of the registry, the career files and the profile, so
// they test without a DOM). app/index.ts imports this file only with import(), so the career's code
// stays out of the first-load JavaScript (its budget: tests/perf/budget.json). The flow itself
// (starting a career race, settling it, the race-first start) is in app/index.ts, beside the
// free-play race it shares a loop with.
import {
  careerView,
  eventPlan,
  garageBikes,
  garagePaints,
  progressOf,
  suggestedNode,
  type CareerDef,
  type CareerView,
  type EventPlan,
  type RaceStatus,
  type SettleReport,
} from '../career';
import type { ContentRegistry } from '../content';
import type { Profile } from '../save';
import type { CareerResultView, GarageView, TeaserView } from '../ui';
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

/** The node the career suggests in a region, or null. */
export function nextNodeOf(def: CareerDef, profile: Profile) {
  return suggestedNode(def, progressOf(def, profile.regions));
}

export {
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
