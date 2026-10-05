import { describe, expect, it } from 'vitest';
import classicPreset from '../../../packs/base/hud/classic.json';
import { placeTouchButtons, type LayoutElement } from '../../sim/api';
import { overlap, pauseBox, type Box } from '../hud-layout';
import {
  PANEL_AIR,
  PANEL_HEAD_H,
  PANEL_MAX_W,
  PANEL_VW,
  planPanel,
  touchBand,
  type PanelInput,
} from './place';

// Playtest 4, P4-1 [decided, the maintainer]: "Tuning on mobile blocks pause button and it seems you
// can't get it to minimize once it's up so you have to refresh the whole page/game". The panel used
// to sit 8 px in from the top-right corner, over the pause button, as tall as the screen and 300 px
// wide, so it covered the pause button and the touch buttons too. These tests are table-driven over
// the phone screens, against the Classic preset the game ships (the touch buttons as placed there),
// both hands. The browser check (tests/e2e/ui-style-popups.spec.ts) measures the painted panel.

interface Preset {
  elements: LayoutElement[];
}
const classic = classicPreset as unknown as Preset;
const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

/** The phone screens the browser checks use, sideways, plus the other common sizes and a laptop. */
const SCREENS: { w: number; h: number; touch: boolean }[] = [
  { w: 915, h: 412, touch: true },
  { w: 932, h: 430, touch: true },
  { w: 844, h: 390, touch: true },
  { w: 800, h: 360, touch: true },
  { w: 740, h: 360, touch: true },
  { w: 640, h: 360, touch: true },
  { w: 667, h: 375, touch: true },
  { w: 568, h: 320, touch: true },
  // Upright and the laptop race with a fine pointer: no touch buttons.
  { w: 412, h: 915, touch: false },
  { w: 360, h: 640, touch: false },
  { w: 1366, h: 768, touch: false },
];

/**
 * The touch buttons as the Classic preset places them (the real boxes the panel must not cover): the
 * attack and brake buttons, and playtest 4's wheelie button as core settles it.
 */
function buttonsOf(s: { w: number; h: number; touch: boolean }, mirror: boolean): Box[] {
  if (!s.touch) return [];
  const placed = placeTouchButtons({ id: 'classic', mirror, elements: classic.elements }, s.w, s.h);
  return [placed.attack, placed.brake, placed.wheelie].flatMap((r) =>
    r ? [{ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h }] : [],
  );
}

/** How far the buttons reach, and rise: the way ui/index.ts's placeAll works out `--touch-reach` and `--touch-rise`. */
function reachRise(buttons: readonly Box[], w: number, h: number): { reach: number; rise: number } {
  let reach = 0;
  let rise = 0;
  for (const b of buttons) {
    reach = Math.max(reach, (b.left + b.right) / 2 > w / 2 ? w - b.left : b.right);
    rise = Math.max(rise, h - b.top);
  }
  return { reach: Math.ceil(reach), rise: Math.ceil(rise) };
}

function input(
  s: { w: number; h: number; touch: boolean },
  mirror: boolean,
  safe = NO_SAFE,
): { input: PanelInput; buttons: Box[] } {
  const buttons = buttonsOf(s, mirror);
  return { input: { w: s.w, h: s.h, safe, mirror, ...reachRise(buttons, s.w, s.h) }, buttons };
}

/** Where the panel stood before this fix: 8 px in from the top-right corner, the screen's height, 300 px or 46 % wide. */
function legacyBox(w: number, h: number): Box {
  const width = Math.min(PANEL_MAX_W, PANEL_VW * w);
  return { left: w - 8 - width, top: 8, right: w - 8, bottom: h - 8 };
}

describe('the old placement (negative control: the check can see the bug)', () => {
  for (const s of SCREENS) {
    it(`${s.w}x${s.h}: 8 px from the top-right corner covered the pause button${s.touch ? ' and the touch buttons' : ''}`, () => {
      const old = legacyBox(s.w, s.h);
      expect(overlap(old, pauseBox(s.w, NO_SAFE, false))).toBe(true);
      for (const b of buttonsOf(s, false)) expect(overlap(old, b)).toBe(true);
    });
  }
});

describe('where the tuning panel stands', () => {
  for (const mirror of [false, true]) {
    describe(mirror ? 'left-handed mirror' : 'right-handed', () => {
      for (const s of SCREENS) {
        it(`${s.w}x${s.h}: clear of the pause button${s.touch ? ' and the touch buttons' : ''}, on the screen, with room to use`, () => {
          const { input: i, buttons } = input(s, mirror);
          const plan = planPanel(i);
          const pause = pauseBox(s.w, NO_SAFE, mirror);
          expect(overlap(plan.box, pause, PANEL_AIR), 'the pause button').toBe(false);
          for (const b of buttons) expect(overlap(plan.box, b, PANEL_AIR), 'a touch button').toBe(false);
          expect(plan.box.left).toBeGreaterThanOrEqual(PANEL_AIR);
          expect(plan.box.top).toBeGreaterThanOrEqual(PANEL_AIR);
          expect(plan.box.right).toBeLessThanOrEqual(s.w - PANEL_AIR);
          expect(plan.box.bottom).toBeLessThanOrEqual(s.h - PANEL_AIR);
          // Room for the header and a few slider rows (it scrolls past that), on every phone and the laptop.
          expect(plan.box.bottom - plan.box.top, 'room to use').toBeGreaterThanOrEqual(120);
          // It docks on the pause button's side, so the other thumb's side stays free to steer.
          expect(plan.side).toBe(mirror ? 'left' : 'right');
        });
      }
    });
  }

  it('while the pause screen is up it docks on the right, in the right half, clear of the pause menu, either hand', () => {
    // The pause menu (Resume first) stands in the left half: the first column on a short landscape
    // screen, the middle on a tall one. The pause button is under the pause screen then, so the
    // left-handed panel would only cover Resume there.
    for (const mirror of [false, true]) {
      for (const s of SCREENS) {
        const { input: i } = input(s, mirror);
        const plan = planPanel({ ...i, paused: true });
        expect(plan.side, `${s.w}x${s.h}`).toBe('right');
        expect(plan.box.left, `${s.w}x${s.h}: the right half`).toBeGreaterThanOrEqual(s.w / 2);
        expect(plan.box.right).toBeLessThanOrEqual(s.w - PANEL_AIR);
      }
    }
  });

  it('says what it keeps clear of: the pause button, and the touch buttons where there are any', () => {
    const phone = SCREENS[0] as (typeof SCREENS)[number];
    const laptop = SCREENS.find((s) => s.w === 1366) as (typeof SCREENS)[number];
    expect(planPanel(input(phone, false).input).clear).toHaveLength(2);
    expect(planPanel(input(laptop, false).input).clear).toHaveLength(1);
  });

  it('stands under the pause button, and stops above the touch buttons, at 915x412 (the numbers)', () => {
    const phone = SCREENS[0] as (typeof SCREENS)[number];
    const plan = planPanel(input(phone, false).input);
    const pause = pauseBox(915, NO_SAFE, false);
    expect(plan.box.top).toBe(pause.bottom + PANEL_AIR);
    const { buttons } = input(phone, false);
    const highest = Math.min(...buttons.map((b) => b.top));
    expect(plan.box.bottom).toBeLessThanOrEqual(highest - PANEL_AIR);
    // Not shrunk more than it has to: it stops within a button's own air of the highest touch button.
    expect(plan.box.bottom).toBeGreaterThan(highest - PANEL_AIR - 24);
    // The numbers: 60 px down to 237 px at 915x412 (177 px tall, 131 of it sliders under the 46 px
    // header), and 60 px down to 194 px at 568x320 (134 px tall). Playtest 4's wheelie button, over
    // the brake beside the attack button, is the highest touch button now (P4-1's numbers, before it,
    // were 263 and 203).
    expect([plan.box.top, plan.box.bottom]).toEqual([60, 237]);
    const tiny = planPanel(input({ w: 568, h: 320, touch: true }, false).input).box;
    expect([tiny.top, tiny.bottom]).toEqual([60, 194]);
  });

  it('is 300 px wide, or 46 % of a narrow screen', () => {
    expect(planPanel(input(SCREENS[0] as (typeof SCREENS)[number], false).input).box).toMatchObject({
      right: 915 - PANEL_AIR,
      left: 915 - PANEL_AIR - PANEL_MAX_W,
    });
    const tiny = planPanel(input({ w: 568, h: 320, touch: true }, false).input).box;
    expect(tiny.right - tiny.left).toBeCloseTo(0.46 * 568, 5);
  });

  it('runs to the bottom margin where there are no touch buttons (the laptop, upright)', () => {
    for (const s of SCREENS.filter((x) => !x.touch)) {
      const plan = planPanel(input(s, false).input);
      expect(plan.box.bottom).toBe(s.h - PANEL_AIR);
    }
  });

  it("keeps in from a notch and the home bar: the safe-area insets and the pause button's own corner", () => {
    const s = { w: 915, h: 412, touch: true };
    const safe = { top: 0, right: 44, bottom: 21, left: 44 };
    for (const mirror of [false, true]) {
      const { input: i, buttons } = input(s, mirror, safe);
      const plan = planPanel(i);
      const pause = pauseBox(s.w, safe, mirror);
      expect(overlap(plan.box, pause, PANEL_AIR)).toBe(false);
      for (const b of buttons) expect(overlap(plan.box, b, PANEL_AIR)).toBe(false);
      if (mirror) expect(plan.box.left).toBeGreaterThanOrEqual(44);
      else expect(plan.box.right).toBeLessThanOrEqual(s.w - 44);
      expect(plan.box.bottom).toBeLessThanOrEqual(s.h - 21);
    }
  });

  it('the touch band the placement reads covers the real buttons (so reading it keeps them clear)', () => {
    for (const mirror of [false, true]) {
      for (const s of SCREENS.filter((x) => x.touch)) {
        const { input: i, buttons } = input(s, mirror);
        const band: Box = mirror
          ? { left: 0, top: s.h - i.rise, right: i.reach, bottom: s.h }
          : { left: s.w - i.reach, top: s.h - i.rise, right: s.w, bottom: s.h };
        for (const b of buttons) {
          expect(b.left).toBeGreaterThanOrEqual(band.left - 1);
          expect(b.right).toBeLessThanOrEqual(band.right + 1);
          expect(b.top).toBeGreaterThanOrEqual(band.top - 1);
          expect(b.bottom).toBeLessThanOrEqual(band.bottom + 1);
        }
      }
    }
  });

  it('on a screen too short for the panel and the buttons together, the header still fits and stays on screen', () => {
    const plan = planPanel({ w: 700, h: 200, safe: NO_SAFE, mirror: false, reach: 250, rise: 140 });
    expect(plan.box.bottom - plan.box.top).toBeGreaterThanOrEqual(PANEL_HEAD_H);
    expect(plan.box.top).toBeGreaterThanOrEqual(PANEL_AIR);
  });

  it('is the same every time it is asked (pure)', () => {
    const { input: i } = input(SCREENS[0] as (typeof SCREENS)[number], false);
    expect(planPanel(i)).toEqual(planPanel({ ...i }));
  });
});

describe('the touch band as ui/ writes it on the root', () => {
  it('reads the two custom properties as px numbers', () => {
    expect(touchBand('239px', '140px')).toEqual({ reach: 239, rise: 140 });
    expect(touchBand(' 12px ', '0px')).toEqual({ reach: 12, rise: 0 });
  });
  it('reads nothing, a bad value or a negative one as no buttons', () => {
    expect(touchBand('', '')).toEqual({ reach: 0, rise: 0 });
    expect(touchBand('wide', 'tall')).toEqual({ reach: 0, rise: 0 });
    expect(touchBand('-5px', 'NaNpx')).toEqual({ reach: 0, rise: 0 });
  });
});
