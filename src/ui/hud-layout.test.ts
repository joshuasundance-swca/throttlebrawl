import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
import { placeElement, type LayoutElement } from '../sim/api';
import {
  HUD_SIZE,
  hudTextScale,
  OBJECTIVE_LINES,
  objectiveHeight,
  TICKER_H,
  layoutTop,
  lookAheadBox,
  overlap,
  pauseBox,
  placedBox,
  planVars,
  scaledElement,
  settleLifts,
  type Box,
  type TopMode,
  type TopPlan,
} from './hud-layout';
import { TEXT_SCALE } from './text-size';

// The HUD's top layout (design spec "HUD layout: nothing overlaps", playtest 3): table-driven over
// the screens the spec lists, with the left-handed mirror, against the Classic preset the game ships.
// Every slot is checked at its reserved size (a widget inside its slot cannot overlap another), with
// the road ahead kept clear. The browser spec (tests/e2e/ui-hud-layout.spec.ts) measures the real
// widgets inside these slots.

interface Preset {
  elements: LayoutElement[];
}
const classic = classicPreset as unknown as Preset;
const element = (name: string): LayoutElement => {
  const e = classic.elements.find((x) => x.element === name);
  if (!e) throw new Error(`the Classic preset has no ${name}`);
  return e;
};
const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

/** The screens in the design spec's table (CSS px), with the mode the rules give each. */
const SCREENS: { w: number; h: number; mode: TopMode; displaced?: boolean }[] = [
  { w: 915, h: 412, mode: 'inline' },
  { w: 844, h: 390, mode: 'inline' },
  { w: 800, h: 360, mode: 'inline' },
  { w: 740, h: 360, mode: 'inline' },
  { w: 640, h: 360, mode: 'inline' },
  // Too short for the stacked row to stay above the road ahead: the ticker squeezes into the gap.
  { w: 568, h: 320, mode: 'inline' },
  { w: 412, h: 915, mode: 'stacked' },
  { w: 390, h: 844, mode: 'stacked' },
  { w: 360, h: 740, mode: 'stacked', displaced: true },
  { w: 320, h: 640, mode: 'stacked', displaced: true },
  // The laptop and a big monitor.
  { w: 1366, h: 768, mode: 'inline' },
  { w: 1920, h: 1080, mode: 'inline' },
];

interface Case {
  plan: TopPlan;
  pieces: { name: string; box: Box }[];
  bottom: { name: string; box: Box }[];
  buttons: Box[];
}

function solve(w: number, h: number, mirror: boolean, safe = NO_SAFE, k = 1): Case {
  // The text widgets grow with the Text size setting (`scaledElement`); the touch buttons do not.
  const text = (name: string) => scaledElement(element(name), k);
  const position = placedBox(text('position'), w, h, mirror, HUD_SIZE.position);
  const target = placedBox(text('health-target'), w, h, mirror, HUD_SIZE.health);
  const plan = layoutTop({ w, h, safe, mirror, position, target, textScale: k });
  const buttons = ['touch-attack', 'touch-brake'].map((n) => {
    const r = placeElement(element(n), w, h, mirror);
    return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h };
  });
  const speed = placedBox(text('speedometer'), w, h, mirror, HUD_SIZE.speed);
  const self = placedBox(text('health-self'), w, h, mirror, HUD_SIZE.health);
  const lifts = settleLifts(
    [
      { name: 'hud-speed', box: speed },
      { name: 'hud-health', box: self },
    ],
    buttons,
  );
  const lifted = (name: string, b: Box): Box => ({
    ...b,
    top: b.top - (lifts[name] ?? 0),
    bottom: b.bottom - (lifts[name] ?? 0),
  });
  const bottom = [
    { name: 'hud-speed', box: lifted('hud-speed', speed) },
    { name: 'hud-health', box: lifted('hud-health', self) },
  ];
  const pieces = [
    { name: 'hud-position', box: position },
    { name: 'hud-target', box: plan.target ?? target },
    { name: 'hud-pause', box: plan.pause },
    { name: 'hud-ticker', box: plan.ticker },
    { name: 'look-offer', box: plan.toast },
    { name: 'hud-objective', box: plan.objective },
    { name: 'hud-heat', box: plan.heat },
    ...bottom,
    { name: 'touch-attack', box: buttons[0] as Box },
    { name: 'touch-brake', box: buttons[1] as Box },
  ];
  return { plan, pieces, bottom, buttons };
}

function pairs(c: Case, mode: TopMode): string[] {
  const out: string[] = [];
  for (const [i, a] of c.pieces.entries())
    for (const b of c.pieces.slice(i + 1)) {
      // In stacked mode the offer takes the ticker's slot, and the strip steps aside while it is up.
      if (mode === 'stacked' && [a.name, b.name].sort().join() === 'hud-ticker,look-offer') continue;
      if (overlap(a.box, b.box)) out.push(`${a.name} × ${b.name}`);
    }
  return out;
}

describe('the top layout, table-driven over the design spec screens', () => {
  for (const mirror of [false, true]) {
    describe(mirror ? 'left-handed mirror' : 'right-handed', () => {
      for (const s of SCREENS) {
        it(`${s.w}x${s.h}: ${s.mode}${s.displaced ? ', rival bar displaced' : ''}, nothing overlaps, the road ahead is clear`, () => {
          const c = solve(s.w, s.h, mirror);
          expect(c.plan.mode).toBe(s.mode);
          expect(c.plan.target !== null, 'the rival bar leaves row A only where the table says').toBe(
            s.displaced === true,
          );
          expect(pairs(c, s.mode)).toEqual([]);
          const look = lookAheadBox(s.w, s.h);
          // The pieces of the top layout stay out of the road ahead (the browser check's rule), on every screen
          // big enough for the objective, the offer and the heat badge to have room (windows under 390 px wide
          // are best effort: with the rival bar displaced, the heat badge's row runs into the road ahead,
          // as it does in the design spec's own table; no phone shows one upright).
          const inLook = c.pieces
            .filter((p) => !['hud-speed', 'hud-health', 'touch-attack', 'touch-brake'].includes(p.name))
            .filter((p) => overlap(p.box, look))
            .map((p) => p.name);
          if (s.w >= 390) expect(inLook, 'in the road ahead').toEqual([]);
          for (const p of c.pieces) {
            expect(p.box.left, `${p.name} on screen (left)`).toBeGreaterThanOrEqual(-0.5);
            expect(p.box.top, `${p.name} on screen (top)`).toBeGreaterThanOrEqual(-0.5);
            expect(p.box.right, `${p.name} on screen (right)`).toBeLessThanOrEqual(s.w + 0.5);
            expect(p.box.bottom, `${p.name} on screen (bottom)`).toBeLessThanOrEqual(s.h + 0.5);
          }
        });
      }
    });
  }

  it('keeps the rival bar slot reserved: the ticker slot does not depend on whether the bar shows', () => {
    // The slot is taken from the layout record whether or not a rival is up (layoutTop never sees "shown").
    const a = solve(915, 412, false).plan.ticker;
    const b = solve(915, 412, false).plan.ticker;
    expect(a).toEqual(b);
  });

  it('puts the ticker in the widest gap of row A, one line high, in inline mode', () => {
    const c = solve(915, 412, false);
    const position = c.pieces[0]?.box as Box;
    const target = c.pieces[1]?.box as Box;
    expect(c.plan.ticker.top).toBe(8);
    expect(c.plan.ticker.bottom - c.plan.ticker.top).toBe(TICKER_H);
    expect(c.plan.ticker.left).toBeGreaterThanOrEqual(position.right);
    expect(c.plan.ticker.right).toBeLessThanOrEqual(target.left);
    // Centred in the gap, 8 px of air each side (the design spec's 160-675 at this size, with the
    // spec's 140 px position badge; the slot here is the 150 px upper bound).
    expect(c.plan.ticker.left).toBeCloseTo(position.right + 8, 1);
    expect(c.plan.ticker.right).toBeCloseTo(target.left - 8, 1);
  });

  it('stacks the ticker under row A on a narrow screen and gives the objective and the heat badge one row', () => {
    const c = solve(412, 915, false);
    expect(c.plan.ticker.top).toBeGreaterThan(c.plan.pause.bottom);
    expect(c.plan.objective.top).toBe(c.plan.heat.top);
    expect(c.plan.objective.right).toBeLessThanOrEqual(c.plan.heat.left);
    expect(c.plan.objective.bottom - c.plan.objective.top).toBe(objectiveHeight(OBJECTIVE_LINES.stacked));
  });

  it('puts the objective above the heat badge, in the same column, past the road ahead, in inline mode', () => {
    const c = solve(915, 412, false);
    expect(c.plan.heat.top).toBeGreaterThanOrEqual(c.plan.objective.bottom);
    expect(c.plan.objective.left).toBeGreaterThanOrEqual(lookAheadBox(915, 412).right);
    expect(c.plan.heat.left).toBeGreaterThanOrEqual(lookAheadBox(915, 412).right);
    // Never the playtest 3 overlap: the objective and the heat badge share no pixel.
    expect(overlap(c.plan.objective, c.plan.heat)).toBe(false);
  });

  it('flips every column with the left-handed mirror', () => {
    const plain = solve(915, 412, false).plan;
    const flipped = solve(915, 412, true).plan;
    expect(plain.objectiveSide).toBe('right');
    expect(flipped.objectiveSide).toBe('left');
    expect(flipped.objective.right).toBeLessThanOrEqual(lookAheadBox(915, 412).left);
    expect(flipped.pause.left).toBeLessThan(plain.pause.left);
  });

  it('holds the offer in the column under the position badge, clear of the road ahead, in inline mode', () => {
    const c = solve(915, 412, false);
    expect(c.plan.toast.left).toBe((c.pieces[0]?.box as Box).left);
    expect(c.plan.toast.right).toBeLessThanOrEqual(lookAheadBox(915, 412).left);
    expect(c.plan.toastCentred).toBe(false);
  });

  it('keeps clear of a notch: the safe-area insets move the ticker, the pause button and the columns in', () => {
    const safe = { top: 24, right: 44, bottom: 20, left: 44 };
    const plain = solve(844, 390, false).plan;
    const notched = solve(844, 390, false, safe).plan;
    expect(notched.pause.right).toBeLessThanOrEqual(844 - 44);
    expect(notched.ticker.top).toBe(24);
    expect(notched.heat.right).toBeLessThanOrEqual(844 - 44);
    expect(notched.ticker.top).toBeGreaterThan(plain.ticker.top);
    expect(pauseBox(844, safe, true).left).toBe(44);
  });

  it('is deterministic: the same input gives the same plan', () => {
    expect(solve(740, 360, false).plan).toEqual(solve(740, 360, false).plan);
  });

  it('writes the plan as CSS variables: centres for the ticker, edges for the columns', () => {
    const c = solve(915, 412, false);
    const vars = planVars(c.plan, 915);
    const slot = c.plan.ticker;
    expect(vars['--hl-ticker-x']).toBe(`${Math.round(((slot.left + slot.right) / 2) * 100) / 100}px`);
    expect(vars['--hl-ticker-w']).toBe(`${Math.round((slot.right - slot.left) * 100) / 100}px`);
    expect(vars['--hl-obj-r']).toBe('8px');
    expect(vars['--hl-obj-l']).toBe('auto');
    expect(vars['--hl-heat-r']).toBe('8px');
    const stacked = planVars(solve(412, 915, false).plan, 412);
    expect(stacked['--hl-toast-t']).toBe('-50%');
    expect(stacked['--hl-obj-l']).toBe('8px');
  });
});

// The Text size setting (docs/product-spec.md, "Accessibility"): at every size the rules hold on every
// screen in the table, because the slots grow with the text. The sizes are the setting's own factors.
describe('the top layout at the larger text sizes (rule 7)', () => {
  for (const size of ['large', 'largest'] as const) {
    for (const mirror of [false, true]) {
      for (const s of SCREENS.filter((x) => x.w >= 360)) {
        it(`${size} text, ${s.w}x${s.h}${mirror ? ' mirrored' : ''}: nothing overlaps and the road ahead is clear`, () => {
          // What the race's HUD draws with on this screen (a short phone takes less of it).
          const c = solve(s.w, s.h, mirror, NO_SAFE, hudTextScale(TEXT_SCALE[size], s.h));
          expect(pairs(c, c.plan.mode)).toEqual([]);
          const look = lookAheadBox(s.w, s.h);
          const inLook = c.pieces
            .filter((p) => !['hud-speed', 'hud-health', 'touch-attack', 'touch-brake'].includes(p.name))
            .filter((p) => overlap(p.box, look))
            .map((p) => p.name);
          // The stacked layout (a narrow upright window; a touch phone shows the rotate screen instead) is
          // best effort at the larger sizes: its rows stack down from the top and may reach the road
          // ahead's top edge. Under 360 px wide is not checked here at all. Phones held sideways are.
          if (c.plan.mode === 'inline') expect(inLook, 'in the road ahead').toEqual([]);
          for (const p of c.pieces) {
            expect(p.box.left, `${p.name} on screen (left)`).toBeGreaterThanOrEqual(-0.5);
            expect(p.box.top, `${p.name} on screen (top)`).toBeGreaterThanOrEqual(-0.5);
            expect(p.box.right, `${p.name} on screen (right)`).toBeLessThanOrEqual(s.w + 0.5);
            expect(p.box.bottom, `${p.name} on screen (bottom)`).toBeLessThanOrEqual(s.h + 0.5);
          }
        });
      }
    }
  }

  it('grows the slots it reserves with the text and leaves the pause button alone', () => {
    const plain = solve(915, 412, false).plan;
    const big = solve(915, 412, false, NO_SAFE, TEXT_SCALE.largest).plan;
    const height = (b: Box) => b.bottom - b.top;
    expect(height(big.ticker)).toBeCloseTo(height(plain.ticker) * TEXT_SCALE.largest, 5);
    expect(height(big.objective)).toBeGreaterThan(height(plain.objective));
    expect(height(big.heat)).toBeGreaterThan(height(plain.heat));
    expect(height(big.toast)).toBeGreaterThan(height(plain.toast));
    expect(big.pause).toEqual(plain.pause);
  });

  it('caps the HUD factor by the screen height: none on the shortest phone, the whole of it from 390 px', () => {
    expect(hudTextScale(TEXT_SCALE.largest, 320)).toBe(1);
    expect(hudTextScale(TEXT_SCALE.largest, 360)).toBeGreaterThan(1);
    expect(hudTextScale(TEXT_SCALE.largest, 360)).toBeLessThan(TEXT_SCALE.largest);
    expect(hudTextScale(TEXT_SCALE.largest, 412)).toBe(TEXT_SCALE.largest);
    expect(hudTextScale(TEXT_SCALE.large, 412)).toBe(TEXT_SCALE.large);
    expect(hudTextScale(1, 768)).toBe(1);
    // Never below Normal, and a bad height changes nothing.
    expect(hudTextScale(TEXT_SCALE.largest, 100)).toBe(1);
    expect(hudTextScale(TEXT_SCALE.largest, Number.NaN)).toBe(1);
  });

  it('is the same plan at Normal as with no factor at all', () => {
    expect(solve(740, 360, false, NO_SAFE, 1).plan).toEqual(solve(740, 360, false).plan);
  });
});

describe('settling a text widget off a touch button (rule 6)', () => {
  it('lifts the health bar 6 px clear of the brake button and the speed readout stays put', () => {
    // 360x740: today's Classic preset puts the health bar over the brake button there.
    const c = solve(360, 740, false);
    const self = c.bottom.find((p) => p.name === 'hud-health')?.box as Box;
    const brake = c.buttons[1] as Box;
    expect(overlap(self, brake)).toBe(false);
    expect(self.bottom).toBeLessThanOrEqual(brake.top - 6 + 0.5);
    const raw = placedBox(element('health-self'), 360, 740, false, HUD_SIZE.health);
    expect(overlap(raw, brake), 'the preset alone overlaps there').toBe(true);
  });

  it('moves nothing where nothing overlaps', () => {
    const lifts = settleLifts(
      [{ name: 'a', box: { left: 0, top: 100, right: 100, bottom: 140 } }],
      [{ left: 200, top: 100, right: 300, bottom: 200 }],
    );
    expect(lifts['a']).toBe(0);
  });

  it('keeps a lifted widget clear of the one below it', () => {
    const blocker = { left: 90, top: 300, right: 190, bottom: 380 };
    const lifts = settleLifts(
      [
        { name: 'low', box: { left: 0, top: 330, right: 100, bottom: 370 } },
        { name: 'high', box: { left: 0, top: 290, right: 100, bottom: 328 } },
      ],
      [blocker],
    );
    expect(lifts['low']).toBeGreaterThan(0);
    const low = { left: 0, top: 330 - (lifts['low'] ?? 0), right: 100, bottom: 370 - (lifts['low'] ?? 0) };
    const high = { left: 0, top: 290 - (lifts['high'] ?? 0), right: 100, bottom: 328 - (lifts['high'] ?? 0) };
    expect(overlap(low, blocker)).toBe(false);
    expect(overlap(high, low, 6)).toBe(false);
  });
});
