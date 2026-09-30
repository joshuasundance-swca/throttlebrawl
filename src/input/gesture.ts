// The attack gesture's timing invariant (docs/architecture.md, "Input": attack gesture timing;
// docs/milestones/M1.md, "input-1"). `attack` starts the wind-up on the tick it is sampled. A kick
// swipe or a side drag is recognised up to its window after the press and sampled on the next
// tick, so the window in ticks plus one must stay shorter than the wind-up it modifies; otherwise
// a real kick would sometimes arrive after the punch is already active and come out as a punch.
// Playtest 1 (2026-09-30, "Can't kick"): a natural swipe-down takes 150-200 ms, longer than the
// punch's 7-tick wind-up, so sim/combat also converts an attack at most `combat.kickConvertMs` old
// in any phase. The kick swipe then only has to land inside that window: its ticks plus the
// sampling tick at most the window's ticks (combat's `age <= window`). Pure, so content-1's pack
// lint can reuse it.
import { secondsToTicks } from '../core';
import type { InputThresholds } from './tuning';

/** The ticks (60 Hz) a gesture window of `ms` can span, rounded up. */
export function gestureWindowTicks(ms: number, hz = 60): number {
  return Math.ceil((ms * hz) / 1000 - 1e-9);
}

export interface WindupEntry {
  /** Weapon id, bare or namespaced (`kick` or `base:kick`). */
  id: string;
  windupS: number;
}

const isKick = (id: string) => id === 'kick' || id.endsWith(':kick');

/** Combat's kick-conversion window in ticks, rounded as sim/combat rounds it. */
export function kickConvertTicks(kickConvertMs: number, hz = 60): number {
  return Math.round((kickConvertMs * hz) / 1000);
}

/**
 * Problems with the gesture windows against each weapon's wind-up, as plain messages (empty when
 * the invariant holds). The kick swipe converts every wind-up but the kick's own, and must land
 * inside the wind-up or inside combat's conversion window (`kickConvertMs`, the shipped
 * `combat.kickConvertMs`; 0 means M1's wind-up-only rule). The side drag applies to every
 * wind-up, the kick's included, and only during it.
 */
export function gestureTimingProblems(
  t: Pick<InputThresholds, 'attackDragMs' | 'kickSwipeMs'>,
  weapons: readonly WindupEntry[],
  kickConvertMs = 0,
): string[] {
  const problems: string[] = [];
  const kickTicks = gestureWindowTicks(t.kickSwipeMs) + 1;
  const dragTicks = gestureWindowTicks(t.attackDragMs) + 1;
  const convert = kickConvertTicks(kickConvertMs);
  for (const w of weapons) {
    const windup = secondsToTicks(w.windupS);
    if (!isKick(w.id) && kickTicks >= windup && kickTicks > convert)
      problems.push(
        convert > 0
          ? `${w.id}: kickSwipeMs ${t.kickSwipeMs} ms is ${kickTicks - 1} ticks + 1 sampling tick = ${kickTicks}, past the ${windup}-tick wind-up and the ${convert}-tick kickConvertMs window (${kickConvertMs} ms)`
          : `${w.id}: kickSwipeMs ${t.kickSwipeMs} ms is ${kickTicks - 1} ticks + 1 sampling tick = ${kickTicks}, not shorter than the ${windup}-tick wind-up`,
      );
    if (dragTicks >= windup)
      problems.push(
        `${w.id}: attackDragMs ${t.attackDragMs} ms is ${dragTicks - 1} ticks + 1 sampling tick = ${dragTicks}, not shorter than the ${windup}-tick wind-up`,
      );
  }
  return problems;
}
