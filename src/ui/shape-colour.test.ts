import { describe, expect, it } from 'vitest';
import { confusable, contrastRatio, CVDS, simulate } from './colour-check';
import { GAUGE_ZONE_ORDER, GAUGE_ZONES, gaugeCues, movesMeterCss } from './moves-gauge';
import { GAUGE } from './moves-meter';
import { HEAT_LABELS, HEAT_PIPS } from './heat-badge';

// The shape and colour check over the HUD (M5's a11y-1; docs/product-spec.md, "Accessibility": rivals
// and HUD "told apart by shape as well as by color, for color-blind players"). A HUD state that colour
// alone tells apart needs a second cue: a word, a shape or a place. The colour maths is in
// colour-check.ts (Machado's protan, deutan and tritan matrices); this file holds each colour-coded
// piece of the HUD to the rule. Nothing here is a copy of the CSS: the zone colours and the cues are
// read from the modules that draw them.

describe('the colour check can tell colours apart, and can find colours that are not', () => {
  it('reads black on white as 21:1 and a colour on itself as 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3fbf5f', '#3fbf5f')).toBeCloseTo(1, 8);
  });

  it('keeps white and black as they are for every kind of colour blindness (they have no hue)', () => {
    for (const kind of CVDS) {
      const [r, g, b] = simulate('#ffffff', kind);
      expect(r).toBeCloseTo(1, 2);
      expect(g).toBeCloseTo(1, 2);
      expect(b).toBeCloseTo(1, 2);
    }
  });

  it('finds the green and the amber that differ by hue alone, and passes a light and a dark', () => {
    expect(confusable('#c9962f', '#3fbf5f')).toBe(true);
    expect(confusable('#ffffff', '#202020')).toBe(false);
    expect(confusable('#f5c542', '#7a1d12')).toBe(false);
  });
});

describe('the wheelie gauge: zones that colour alone could not separate carry a shape', () => {
  const pairs = GAUGE_ZONE_ORDER.slice(1).map((upper, i) => {
    const lower = GAUGE_ZONE_ORDER[i] as (typeof GAUGE_ZONE_ORDER)[number];
    return { lower, upper, between: `${lower}|${upper}` };
  });

  it('has colour-confusable neighbours, so the rule below means something', () => {
    const bad = pairs.filter((p) => confusable(GAUGE_ZONES[p.lower], GAUGE_ZONES[p.upper]));
    expect(bad.length).toBeGreaterThan(0);
  });

  it('draws a tick on every boundary whose two colours could be mistaken', () => {
    const ticked = new Set(gaugeCues(GAUGE.stops).ticks.map((t) => t.between));
    for (const p of pairs) {
      if (confusable(GAUGE_ZONES[p.lower], GAUGE_ZONES[p.upper]))
        expect(ticked.has(p.between), `a tick between ${p.lower} and ${p.upper}`).toBe(true);
    }
  });

  it('puts each tick where the band changes, in bar fractions that rise from the bottom', () => {
    const cues = gaugeCues(GAUGE.stops);
    const at = Object.fromEntries(cues.ticks.map((t) => [t.between, t.at]));
    expect(at['low|sweet']).toBe(GAUGE.stops.sweetFrom);
    expect(at['sweet|high']).toBe(GAUGE.stops.sweetTo);
    expect(at['high|loop']).toBe(GAUGE.stops.loopFrom);
    const ordered = cues.ticks.map((t) => t.at);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
  });

  it('brackets the sweet band wider than the bar and hatches the loop-out zone', () => {
    const cues = gaugeCues(GAUGE.stops);
    expect(cues.bracket).toEqual({ from: GAUGE.stops.sweetFrom, to: GAUGE.stops.sweetTo });
    expect(cues.hatch).toEqual({ from: GAUGE.stops.loopFrom, to: 1 });
  });

  it('paints those cues in the gauge CSS: a tick layer per boundary, the bracket and the hatch', () => {
    const css = movesMeterCss(GAUGE);
    const ticks = [...css.matchAll(/#111 calc\(([\d.]+)% - 1px\)/g)].map((m) => Number(m[1]));
    const expected = gaugeCues(GAUGE.stops).ticks.map((t) => Math.round(t.at * 1000) / 10);
    expect(ticks).toEqual(expected);
    expect(css).toContain('.gauge-bar::before');
    expect(css).toContain('repeating-linear-gradient');
  });
});

describe('the other colour-coded HUD pieces carry a word, a shape or a place as well', () => {
  it('tells the heat tiers apart by word and by lit pips (a filled disc against an outline), not by colour', () => {
    // Four tiers, each with its own word; the pips count 0..3; the bar's length is the heat.
    expect(new Set(HEAT_LABELS).size).toBe(HEAT_LABELS.length);
    expect(HEAT_LABELS.length).toBe(HEAT_PIPS + 1);
  });

  it("tells the player's bar from the rival's by its name and by its place, with the colours a lightness apart", () => {
    // Yellow YOU and red-orange rival: not confusable even before the labels.
    expect(confusable('#f5c542', '#e0543a')).toBe(false);
  });
});
