// The touch attack gesture as rules over angles and speeds (playtest 4, P4-6, "Auto-aim + swipe"
// [decided]; the combat audit: a slanted kick swipe of 21 to 59 degrees picked a side by accident).
// Driven through TouchState with the shipped thresholds and a swipe of known angle and speed, so the
// rules hold wherever the numbers sit:
// - a tap hits whichever rival is closest (no side, no kick);
// - a swipe down kicks, and only a clearly sideways lean of it picks the kick's side;
// - a flat flick picks a punch's side, and stays reachable at a natural flick speed;
// - a swipe up is the straight kick.
import { describe, expect, it } from 'vitest';
import type { Rect } from '../core';
import { emptyActions, type ActionState } from './actions';
import { TouchState, type TouchZones } from './devices/touch';
import { inputDefaults } from './tuning';

const ATTACK: Rect = { x: 700, y: 250, w: 100, h: 100 };
const ZONES: TouchZones = { width: 915, height: 412, stick: null, brake: null, attack: ATTACK };
const X0 = ATTACK.x + ATTACK.w / 2;
const Y0 = ATTACK.y + ATTACK.h / 2;

/**
 * A swipe of `distPx` at `deg` degrees from straight down (positive to the right, so 90 is a flat
 * flick right, 180 straight up), at `pxPerMs`, sampled once the finger has moved.
 */
function swipe(deg: number, pxPerMs: number, distPx = 40, thresholds = inputDefaults()): ActionState {
  const touch = new TouchState(thresholds);
  touch.down(1, X0, Y0, 1000, ZONES);
  touch.sample(emptyActions()); // the press tick
  const rad = (Math.abs(deg) * Math.PI) / 180;
  const dx = Math.sign(deg) * Math.sin(rad) * distPx;
  touch.move(1, X0 + dx, Y0 + Math.cos(rad) * distPx, 1000 + distPx / pxPerMs);
  const a = emptyActions();
  touch.sample(a);
  return a;
}

function tap(): ActionState {
  const touch = new TouchState(inputDefaults());
  touch.down(1, X0, Y0, 1000, ZONES);
  touch.up(1);
  const a = emptyActions();
  touch.sample(a);
  return a;
}

const NATURAL = 0.4; // px/ms, a relaxed thumb swipe (40 px in 100 ms)
const FLICK = 0.8; // px/ms, a quick flick

describe('the attack swipe, as rules', () => {
  it('a tap is an attack with no side and no kick: the sim aims it at the closest rival', () => {
    const a = tap();
    expect(a.attack).toBe(true);
    expect(a.attackSide).toBe(0);
    expect(a.kick).toBe(false);
  });

  it('a slanted swipe down stays auto-aimed up to a clearly sideways lean, whatever its speed', () => {
    const side = inputDefaults().kickSideDeg;
    expect(side).toBeGreaterThanOrEqual(35);
    for (const speed of [NATURAL, FLICK, 1.5]) {
      for (let deg = 0; deg < side; deg += 1) {
        for (const sign of [1, -1]) {
          const a = swipe(sign * deg, speed);
          expect(a.kick, `${sign * deg} deg at ${speed}`).toBe(true);
          expect(a.attackSide, `${sign * deg} deg at ${speed}`).toBe(0);
        }
      }
    }
  });

  it('a clearly sideways swipe down kicks to the side it leans to, mirrored', () => {
    const { kickSideDeg, kickConeDeg } = inputDefaults();
    for (let deg = kickSideDeg + 2; deg < kickConeDeg - 1; deg += 3) {
      const right = swipe(deg, NATURAL);
      const left = swipe(-deg, NATURAL);
      expect(right.kick, `${deg}`).toBe(true);
      expect(right.attackSide, `${deg}`).toBe(1);
      expect(left.kick, `${deg}`).toBe(true);
      expect(left.attackSide, `${deg}`).toBe(-1);
    }
  });

  it('a flat flick is a punch to that side, and is reachable at a natural flick speed', () => {
    const { kickConeDeg, attackDragPx, attackDragMs } = inputDefaults();
    for (let deg = kickConeDeg + 5; deg <= 135 - 5; deg += 5) {
      // Long enough that its sideways part crosses the drag distance.
      const dist = (attackDragPx + 6) / Math.sin((deg * Math.PI) / 180);
      // From a flick that only just makes the window to a hard one.
      for (const margin of [1.3, 2, 4]) {
        for (const sign of [1, -1]) {
          const a = swipe(sign * deg, (dist / attackDragMs) * margin, dist);
          expect(a.kick, `${deg} deg at x${margin}`).toBe(false);
          expect(a.attackSide, `${deg} deg at x${margin}`).toBe(sign);
        }
      }
    }
  });

  it('a flick too slow for the side window stays an auto-aimed punch', () => {
    const { attackDragPx, attackDragMs } = inputDefaults();
    const a = swipe(90, (attackDragPx / attackDragMs) * 0.5, attackDragPx + 6);
    expect(a.kick).toBe(false);
    expect(a.attackSide).toBe(0);
  });

  it('a swipe up is the straight kick, whichever way it leans', () => {
    for (let deg = 140; deg <= 180; deg += 10) {
      for (const sign of [1, -1]) {
        const a = swipe(sign * deg, NATURAL);
        expect(a.kick, `${deg}`).toBe(true);
        expect(a.kickStraight, `${deg}`).toBe(true);
        expect(a.attackSide).toBe(0);
      }
    }
  });

  it('the side lean is still a live tuning value', () => {
    const t = inputDefaults();
    t.kickSideDeg = 10;
    expect(swipe(20, NATURAL, 40, t).attackSide).toBe(1);
  });
});
