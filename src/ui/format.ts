// Pure text and number helpers for the screens and the HUD (no DOM, so unit tests run in node).
import type { EntitySnapshot, SimSnapshot } from '../sim/api';

export interface RaceResult {
  place: number;
  of: number;
  prizeCash: number;
  eventName: string;
  /** Went down near a cop: the race ended in a bust (cops-1). */
  busted?: boolean;
  fineCash?: number;
  /** The player's takedowns this race (ui-3); the results screen's tally shows when either is set. */
  takedowns?: number;
  /** The player's style cash this race (the snapshot's `styleTally`). */
  styleCash?: number;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const MPS_TO_MPH = 2.2369363;
const MPS_TO_KMH = 3.6;

export function formatSpeed(mps: number, units: 'mph' | 'kmh'): string {
  const v = Number.isFinite(mps) ? Math.max(0, mps) : 0;
  return units === 'mph' ? `${Math.round(v * MPS_TO_MPH)} mph` : `${Math.round(v * MPS_TO_KMH)} km/h`;
}

export function healthFraction(health: number, max: number): number {
  if (!Number.isFinite(health) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, health / max));
}

function cash(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The update card on a result screen (a deploy replaced the game while the player raced): what it
 * says and exactly when the reload comes (playtest 4 run A's second fix check, punch 2). Race again,
 * Retry and Next go into a race and never reload; only the way back to the menu does, and a career
 * result's way back is its Map (app/states.test.ts holds that rule).
 */
export function reloadOfferText(screen: 'results' | 'careerResults'): string {
  const when = screen === 'careerResults' ? 'go to the map' : 'go back to the menu';
  return `The game was updated while you raced. It reloads when you ${when}.`;
}

/**
 * The results screen's lines. The headline format `1st of 5` is read by the bot race test. The
 * tally (takedowns and style, ui-3) is null when the result carries neither.
 */
export function resultText(r: RaceResult): {
  headline: string;
  detail: string;
  tally: string | null;
  busted: boolean;
} {
  const tally =
    r.takedowns === undefined && r.styleCash === undefined
      ? null
      : `Takedowns: ${r.takedowns ?? 0}. Style: ${cash(r.styleCash ?? 0)}.`;
  if (r.busted) {
    return {
      headline: 'Busted',
      detail: `Fine: ${cash(r.fineCash ?? 0)}. Nobody is collecting it yet.`,
      tally,
      busted: true,
    };
  }
  return {
    headline: `${ordinal(r.place)} of ${r.of}`,
    detail: `${r.eventName}. Prize: ${cash(r.prizeCash)}. Nobody is paying it yet.`,
    tally,
    busted: false,
  };
}

/** The build id is the stamp's last field: `throttlebrawl · <channel> · <branch> · <id>`. */
export function buildIdFromStamp(stamp: string): string {
  const parts = stamp.split(' · ');
  return parts[parts.length - 1]?.trim() ?? '';
}

/** The racers: riders, not traffic or pickups, and not the law (a cop chases but never places). */
export function riderCount(snapshot: SimSnapshot): number {
  let n = 0;
  for (const e of snapshot.entities) if (e.kind === 'rider' && e.faction !== 'law') n++;
  return n;
}

/** The player's current auto-target, when it is another rider (only riders have a health bar). */
export function targetOf(snapshot: SimSnapshot, player: EntitySnapshot | null): EntitySnapshot | null {
  if (!player || player.targetId < 0 || player.targetId === player.id) return null;
  const t = snapshot.entities.find((e) => e.id === player.targetId);
  return t && t.kind === 'rider' ? t : null;
}
