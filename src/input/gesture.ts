// The attack gesture's timing invariant (docs/architecture.md, "Input": attack gesture timing;
// docs/milestones/M1.md, "input-1"). `attack` starts the wind-up on the tick it is sampled. A kick
// swipe or a side drag is recognised up to its window after the press and sampled on the next
// tick, so the window in ticks plus one must stay shorter than the wind-up it modifies; otherwise
// a real kick would sometimes arrive after the punch is already active and come out as a punch.
// Pure, so content-1's pack lint can reuse it.
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

/**
 * Problems with the gesture windows against each weapon's wind-up, as plain messages (empty when
 * the invariant holds). The kick swipe converts every wind-up but the kick's own; the side drag
 * applies to every wind-up, the kick's included.
 */
export function gestureTimingProblems(
  t: Pick<InputThresholds, 'attackDragMs' | 'kickSwipeMs'>,
  weapons: readonly WindupEntry[],
): string[] {
  const problems: string[] = [];
  const kickTicks = gestureWindowTicks(t.kickSwipeMs) + 1;
  const dragTicks = gestureWindowTicks(t.attackDragMs) + 1;
  for (const w of weapons) {
    const windup = secondsToTicks(w.windupS);
    if (!isKick(w.id) && kickTicks >= windup)
      problems.push(
        `${w.id}: kickSwipeMs ${t.kickSwipeMs} ms is ${kickTicks - 1} ticks + 1 sampling tick = ${kickTicks}, not shorter than the ${windup}-tick wind-up`,
      );
    if (dragTicks >= windup)
      problems.push(
        `${w.id}: attackDragMs ${t.attackDragMs} ms is ${dragTicks - 1} ticks + 1 sampling tick = ${dragTicks}, not shorter than the ${windup}-tick wind-up`,
      );
  }
  return problems;
}
