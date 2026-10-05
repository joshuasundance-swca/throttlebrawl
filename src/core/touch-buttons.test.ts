// Playtest 4 (P4-7, [decided] "Wheelie button"): a small button by the right thumb, placed by the
// layout's settle rule, clear of the attack and brake buttons in both hands and at every phone size.
// Pure geometry on the Classic preset as the pack ships it: every screen of the HUD layout tables
// (phones sideways, small phones, upright, laptops), both hands.
import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
import {
  placeElement,
  placeTouchButtons,
  ROAD_AHEAD,
  TOUCH_GAP_PX,
  WHEELIE_BUTTON_MIN_PX,
  type LayoutElement,
  type Rect,
  type TouchLayout,
} from './layout';

const classic = classicPreset as unknown as { elements: LayoutElement[]; mirror: boolean };
const layoutOf = (mirror: boolean, elements = classic.elements): TouchLayout => ({
  id: 'classic',
  mirror,
  elements,
});

/** The screens the HUD layout's tables cover (ui/moves-meter.test.ts, ui/tuning/place.test.ts). */
const SCREENS: { w: number; h: number }[] = [
  { w: 915, h: 412 },
  { w: 932, h: 430 },
  { w: 844, h: 390 },
  { w: 800, h: 360 },
  { w: 740, h: 360 },
  { w: 667, h: 375 },
  { w: 640, h: 360 },
  { w: 568, h: 320 },
  { w: 412, h: 915 },
  { w: 390, h: 844 },
  { w: 360, h: 740 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
];

/** Whether two rects come closer than `gap` px (touching at exactly `gap` is clear). */
const near = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const roadAhead = (w: number, h: number): Rect => ({
  x: ROAD_AHEAD.left * w,
  y: ROAD_AHEAD.top * h,
  w: (ROAD_AHEAD.right - ROAD_AHEAD.left) * w,
  h: (ROAD_AHEAD.bottom - ROAD_AHEAD.top) * h,
});

describe('the wheelie button: the settle rule (playtest 4, P4-7)', () => {
  it('the Classic preset ships it, touch-only and visible', () => {
    const e = classic.elements.find((x) => x.element === 'touch-wheelie');
    expect(e).toMatchObject({ visible: true, touchOnly: true });
  });

  it('on every screen, both hands: clear of attack and brake, off the road ahead, on screen, big enough', () => {
    const sizes: string[] = [];
    for (const mirror of [false, true])
      for (const s of SCREENS) {
        const where = `${s.w}x${s.h}${mirror ? ' mirrored' : ''}`;
        const b = placeTouchButtons(layoutOf(mirror), s.w, s.h);
        const { attack, brake, wheelie } = b;
        if (!attack || !brake || !wheelie) throw new Error(`${where}: a button is missing`);
        // The attack and brake buttons stand where the record puts them: the rule only moves the new one.
        const el = (n: string) => classic.elements.find((x) => x.element === n) as LayoutElement;
        expect(attack, where).toEqual(placeElement(el('touch-attack'), s.w, s.h, mirror));
        expect(brake, where).toEqual(placeElement(el('touch-brake'), s.w, s.h, mirror));
        expect(near(wheelie, attack, TOUCH_GAP_PX), `${where}: wheelie × attack`).toBe(false);
        expect(near(wheelie, brake, TOUCH_GAP_PX), `${where}: wheelie × brake`).toBe(false);
        expect(near(wheelie, roadAhead(s.w, s.h)), `${where}: wheelie in the road ahead`).toBe(false);
        expect(wheelie.x, where).toBeGreaterThanOrEqual(0);
        expect(wheelie.y, where).toBeGreaterThanOrEqual(0);
        expect(wheelie.x + wheelie.w, where).toBeLessThanOrEqual(s.w);
        expect(wheelie.y + wheelie.h, where).toBeLessThanOrEqual(s.h);
        expect(wheelie.w, where).toBeGreaterThanOrEqual(WHEELIE_BUTTON_MIN_PX);
        expect(wheelie.h, where).toBe(wheelie.w);
        // By the right thumb: on the attack button's side of the screen, and nearer it than the brake is.
        const cx = (r: Rect) => r.x + r.w / 2;
        const cy = (r: Rect) => r.y + r.h / 2;
        expect(cx(wheelie) > s.w / 2, `${where}: on the attack button's side`).toBe(cx(attack) > s.w / 2);
        const reach = (r: Rect) => Math.hypot(cx(r) - cx(attack), cy(r) - cy(attack));
        expect(reach(wheelie), `${where}: within the attack thumb's reach`).toBeLessThanOrEqual(reach(brake));
        sizes.push(`${where} ${Math.round(wheelie.w)}px`);
      }
    console.log(`[examined] wheelie button size per screen: ${sizes.join('; ')}`);
  });

  it('keeps its full size where the record leaves room (the maintainer’s 20:9 phone sideways)', () => {
    const e = classic.elements.find((x) => x.element === 'touch-wheelie') as LayoutElement;
    for (const mirror of [false, true]) {
      const placed = placeTouchButtons(layoutOf(mirror), 915, 412).wheelie;
      expect(placed).toEqual(placeElement(e, 915, 412, mirror));
    }
  });

  it('settles a record that would sit on the attack button off it (a custom layout)', () => {
    // Negative control: the record's own spot is put right on the attack button.
    const attack = classic.elements.find((x) => x.element === 'touch-attack') as LayoutElement;
    const elements = classic.elements.map((x) =>
      x.element === 'touch-wheelie' ? { ...x, offset: attack.offset, scale: 0.7 } : x,
    );
    const raw = placeElement(
      elements.find((x) => x.element === 'touch-wheelie') as LayoutElement,
      915,
      412,
      false,
    );
    const b = placeTouchButtons(layoutOf(false, elements), 915, 412);
    if (!b.attack || !b.wheelie) throw new Error('missing');
    expect(near(raw, b.attack, TOUCH_GAP_PX)).toBe(true);
    expect(near(b.wheelie, b.attack, TOUCH_GAP_PX)).toBe(false);
    if (b.brake) expect(near(b.wheelie, b.brake, TOUCH_GAP_PX)).toBe(false);
    expect(b.wheelie.y).toBeGreaterThanOrEqual(0);
  });

  it('a layout without the button (an older saved one) has none, and the others are unchanged', () => {
    const elements = classic.elements.filter((x) => x.element !== 'touch-wheelie');
    const b = placeTouchButtons(layoutOf(false, elements), 915, 412);
    expect(b.wheelie).toBeNull();
    expect(b.attack).not.toBeNull();
    const hidden = classic.elements.map((x) =>
      x.element === 'touch-wheelie' ? { ...x, visible: false } : x,
    );
    expect(placeTouchButtons(layoutOf(false, hidden), 915, 412).wheelie).toBeNull();
  });
});
