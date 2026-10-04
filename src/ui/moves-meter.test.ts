import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
import { placeElement, type LayoutElement, type MovesSnapshot } from '../sim/api';
import {
  createDriftMeter,
  driftOutcome,
  driftRun,
  GAUGE,
  gaugeBlockers,
  gaugeView,
  meterLine,
  placeGauge,
  type GaugeBlockers,
  restBase,
} from './moves-meter';
import { HUD_SIZE, layoutTop, lookAheadBox, overlap, placedBox, settleLifts, type Box } from './hud-layout';

// T6.3 (playtest 3, the critic's C7): the drift chain is the ticker's meter line and empties
// visibly on a wipeout; the wheelie gauge beside the stick is the one new widget, and the layout's
// settle rule places it. The browser spec (tests/e2e/ui-style-popups.spec.ts) measures the real one.

const moves = (over: Partial<MovesSnapshot> = {}): MovesSnapshot => ({
  wheelieS: 0,
  wheelieBand: null,
  driftS: 0,
  driftChain: 0,
  driftCash: 0,
  driftSide: 0,
  ...over,
});

describe('the drift chain as a meter run', () => {
  it('is no run until there is unbanked drift cash, and carries the chain and the cash after', () => {
    expect(driftRun(null)).toBeNull();
    expect(driftRun(undefined)).toBeNull();
    expect(driftRun(moves())).toBeNull();
    expect(driftRun(moves({ driftS: 0.2, driftChain: 1, driftCash: 0 }))).toBeNull();
    expect(driftRun(moves({ driftS: 1.4, driftChain: 2, driftCash: 140 }))).toEqual({
      kind: 'drift',
      seconds: 1.4,
      cash: 140,
      qualifies: true,
      chain: 2,
    });
    // Between drifts the chain stays open with its cash (the window has not lapsed yet).
    expect(driftRun(moves({ driftS: 0, driftChain: 2, driftCash: 140 }))?.cash).toBe(140);
  });

  it('ignores a non-finite cash rather than painting NaN', () => {
    expect(driftRun(moves({ driftCash: Number.NaN, driftChain: 1 }))).toBeNull();
  });
});

describe('the drift meter: shown, banked, emptied', () => {
  it('shows the chain while its cash is up, and hands back the last value when it goes', () => {
    const m = createDriftMeter();
    expect(m.update(moves()).shown).toBeNull();
    const up = m.update(moves({ driftS: 0.9, driftChain: 1, driftCash: 60 }));
    expect(up.shown?.cash).toBe(60);
    expect(up.ended).toBeNull();
    expect(up.drifting).toBe(true);
    const later = m.update(moves({ driftS: 1.5, driftChain: 1, driftCash: 130 }));
    expect(later.shown?.cash).toBe(130);
    // The window lapses and the chain banks (or a wipeout empties it): the cash is gone from the
    // snapshot, and the last value shown comes back as `ended` for the caller to land or empty.
    const gone = m.update(moves());
    expect(gone.shown).toBeNull();
    expect(gone.ended?.cash).toBe(130);
    expect(m.update(moves()).ended).toBeNull();
  });

  it('keeps showing through the gap between two chained drifts (driftS back at 0, cash still up)', () => {
    const m = createDriftMeter();
    m.update(moves({ driftS: 1.2, driftChain: 1, driftCash: 90 }));
    const gap = m.update(moves({ driftS: 0, driftChain: 1, driftCash: 90 }));
    expect(gap.shown?.cash).toBe(90);
    expect(gap.ended).toBeNull();
    expect(gap.drifting).toBe(false);
    const second = m.update(moves({ driftS: 0.3, driftChain: 2, driftCash: 100 }));
    expect(second.shown?.chain).toBe(2);
    expect(second.ended).toBeNull();
  });

  it('says whether the meter ended on a live race: no empty flash when the snapshot just went away', () => {
    const m = createDriftMeter();
    m.update(moves({ driftS: 1, driftChain: 1, driftCash: 80 }));
    const out = m.update(null);
    expect(out.ended?.cash).toBe(80);
    expect(out.raceLive).toBe(false);
    m.update(moves({ driftS: 1, driftChain: 1, driftCash: 80 }));
    expect(m.update(moves()).raceLive).toBe(true);
  });

  it('forgets everything on reset (a new race starts clean)', () => {
    const m = createDriftMeter();
    m.update(moves({ driftS: 1, driftChain: 1, driftCash: 80 }));
    m.reset();
    expect(m.update(moves()).ended).toBeNull();
  });
});

describe('what becomes of a chain that left the snapshot', () => {
  const live = moves({ driftS: 1, driftChain: 2, driftCash: 90 });
  const ending = (m: MovesSnapshot | null) => {
    const meter = createDriftMeter();
    meter.update(live);
    return meter.update(m);
  };

  it('lands on its award when the banking pop arrives with it', () => {
    expect(driftOutcome(ending(moves()), [{ kind: 'drift' }])).toBe('banked');
  });

  it('is lost on a live race when no banking pop arrived: a crash, a wobble or a hit emptied it', () => {
    expect(driftOutcome(ending(moves()), [{ kind: 'nearMiss' }])).toBe('lost');
    expect(driftOutcome(ending(moves()), [])).toBe('lost');
  });

  it('is neither when nothing ended, or when the race itself went away', () => {
    const meter = createDriftMeter();
    expect(driftOutcome(meter.update(live), [])).toBe('none');
    expect(driftOutcome(ending(null), [])).toBe('none');
  });

  it('shows one line: a drift under the rider, else a live run, else the open chain', () => {
    const style = { kind: 'oncoming', seconds: 3, cash: 200, qualifies: true } as const;
    const open = createDriftMeter();
    const chainOnly = open.update(moves({ driftS: 0, driftChain: 2, driftCash: 90 }));
    expect(meterLine(chainOnly, null)?.kind).toBe('drift');
    expect(meterLine(chainOnly, style)?.kind).toBe('oncoming');
    const sliding = createDriftMeter().update(moves({ driftS: 0.8, driftChain: 2, driftCash: 90 }));
    expect(meterLine(sliding, style)?.kind).toBe('drift');
    expect(meterLine(createDriftMeter().update(moves()), null)).toBeNull();
  });
});

describe('the wheelie gauge view', () => {
  it('shows only while a wheelie is up, with the marker at its angle on a bar that runs to just past the loop-out', () => {
    expect(gaugeView(null, 0).show).toBe(false);
    expect(gaugeView(moves(), 0).show).toBe(false);
    const v = gaugeView(moves({ wheelieS: 1, wheelieBand: 'sweet' }), 0.6);
    expect(v.show).toBe(true);
    expect(v.band).toBe('sweet');
    expect(v.marker).toBeCloseTo(0.6 / GAUGE.maxRad, 5);
  });

  it('clamps the marker to the bar and tolerates a missing angle', () => {
    expect(gaugeView(moves({ wheelieBand: 'high' }), 9).marker).toBe(1);
    expect(gaugeView(moves({ wheelieBand: 'low' }), -1).marker).toBe(0);
    expect(gaugeView(moves({ wheelieBand: 'low' }), undefined).marker).toBe(0);
    expect(gaugeView(moves({ wheelieBand: 'low' }), Number.NaN).marker).toBe(0);
  });

  it('paints the sweet band between the sim bands, low under it and the loop-out over', () => {
    const stops = GAUGE.stops;
    expect(stops.sweetFrom).toBeCloseTo(0.35 / GAUGE.maxRad, 5);
    expect(stops.sweetTo).toBeCloseTo(0.85 / GAUGE.maxRad, 5);
    expect(stops.loopFrom).toBeCloseTo(1.2 / GAUGE.maxRad, 5);
    expect(stops.sweetFrom).toBeLessThan(stops.sweetTo);
    expect(stops.sweetTo).toBeLessThan(stops.loopFrom);
    expect(stops.loopFrom).toBeLessThan(1);
  });
});

// ---- Placement: the settle rule ------------------------------------------------------------------

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

/** The screens the HUD layout's own table covers: phones sideways, small phones, windows, laptops. */
const SCREENS: { w: number; h: number }[] = [
  { w: 915, h: 412 },
  { w: 844, h: 390 },
  { w: 800, h: 360 },
  { w: 740, h: 360 },
  { w: 640, h: 360 },
  { w: 568, h: 320 },
  { w: 412, h: 915 },
  { w: 390, h: 844 },
  { w: 360, h: 740 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
];

interface World {
  w: number;
  h: number;
  mirror: boolean;
  blockers: GaugeBlockers;
  look: Box;
  zone: Box;
  buttons: Box[];
  text: Box[];
}

function world(w: number, h: number, mirror: boolean): World {
  const position = placedBox(element('position'), w, h, mirror, HUD_SIZE.position);
  const target = placedBox(element('health-target'), w, h, mirror, HUD_SIZE.health);
  const plan = layoutTop({ w, h, safe: NO_SAFE, mirror, position, target });
  const buttons = ['touch-attack', 'touch-brake'].map((n) => {
    const r = placeElement(element(n), w, h, mirror);
    return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h };
  });
  const speed = placedBox(element('speedometer'), w, h, mirror, HUD_SIZE.speed);
  const self = placedBox(element('health-self'), w, h, mirror, HUD_SIZE.health);
  const lifts = settleLifts(
    [
      { name: 'hud-speed', box: speed },
      { name: 'hud-health', box: self },
    ],
    buttons,
  );
  const lift = (name: string, b: Box): Box => ({
    ...b,
    top: b.top - (lifts[name] ?? 0),
    bottom: b.bottom - (lifts[name] ?? 0),
  });
  const text = [lift('hud-speed', speed), lift('hud-health', self)];
  const zoneRect = placeElement(element('touch-stick-zone'), w, h, mirror);
  return {
    w,
    h,
    mirror,
    blockers: gaugeBlockers({ plan, position, target, buttons, text }),
    look: lookAheadBox(w, h),
    zone: {
      left: zoneRect.x,
      top: zoneRect.y,
      right: zoneRect.x + zoneRect.w,
      bottom: zoneRect.y + zoneRect.h,
    },
    buttons,
    text,
  };
}

const place = (wd: World, base: { x: number; y: number }) =>
  placeGauge({ w: wd.w, h: wd.h, base, mirror: wd.mirror, blockers: wd.blockers, look: wd.look });

describe('placing the wheelie gauge beside the stick (rule 6, the settle rule)', () => {
  it('at rest (no thumb down), clear of every piece and the road ahead, on every screen, both hands', () => {
    for (const mirror of [false, true])
      for (const s of SCREENS) {
        const wd = world(s.w, s.h, mirror);
        const spot = place(wd, restBase(wd.zone, mirror));
        const where = `${s.w}x${s.h}${mirror ? ' mirrored' : ''}`;
        expect(spot, `${where}: a place`).not.toBeNull();
        if (!spot) continue;
        expect(spot.tier, `${where}: clear of everything, the road ahead too`).toBe('all');
        for (const b of wd.blockers.all)
          expect(overlap(spot.box, b), `${where}: overlaps a piece`).toBe(false);
        expect(overlap(spot.box, wd.look), `${where}: in the road ahead`).toBe(false);
        expect(spot.box.left).toBeGreaterThanOrEqual(0);
        expect(spot.box.top).toBeGreaterThanOrEqual(0);
        expect(spot.box.right).toBeLessThanOrEqual(s.w);
        expect(spot.box.bottom).toBeLessThanOrEqual(s.h);
      }
  });

  it('wherever the thumb lands in the stick zone, never over a touch button or a text widget, on screen', () => {
    // A grid of thumb positions across the zone, kept 24 px off the edge (the phone's back gesture).
    let placed = 0;
    for (const mirror of [false, true])
      for (const s of SCREENS.filter((x) => x.w > x.h)) {
        const wd = world(s.w, s.h, mirror);
        const z = wd.zone;
        for (let fx = 0; fx <= 1.0001; fx += 0.125)
          for (let fy = 0; fy <= 1.0001; fy += 0.125) {
            const base = {
              x: Math.min(Math.max(z.left + fx * (z.right - z.left), 24), s.w - 24),
              y: Math.min(Math.max(z.top + fy * (z.bottom - z.top), 24), s.h - 24),
            };
            // A thumb on a touch button is not a stick press (ui ignores it).
            if (
              wd.buttons.some(
                (b) => base.x >= b.left && base.x <= b.right && base.y >= b.top && base.y <= b.bottom,
              )
            )
              continue;
            const spot = place(wd, base);
            const where = `${s.w}x${s.h}${mirror ? ' mirrored' : ''} thumb ${Math.round(base.x)},${Math.round(base.y)}`;
            expect(spot, `${where}: a place`).not.toBeNull();
            if (!spot) continue;
            placed++;
            // Measured 2026-10-04: every grid point of every screen gets the top tier. Keep it that way.
            expect(spot.tier, `${where}: clear of every piece and the road ahead`).toBe('all');
            for (const b of [...wd.buttons, ...wd.text])
              expect(overlap(spot.box, b), `${where}: over a button or a text widget`).toBe(false);
            expect(spot.box.left, where).toBeGreaterThanOrEqual(0);
            expect(spot.box.top, where).toBeGreaterThanOrEqual(0);
            expect(spot.box.right, where).toBeLessThanOrEqual(s.w);
            expect(spot.box.bottom, where).toBeLessThanOrEqual(s.h);
          }
      }
    expect(placed).toBeGreaterThan(400);
  });

  it('sits beside the stick when there is room: the inner side first, level with the thumb', () => {
    const wd = world(915, 412, false);
    const base = { x: 100, y: 240 };
    const spot = place(wd, base);
    expect(spot?.box.left).toBeGreaterThan(base.x); // the right-handed stick is on the left; the gauge on its inner side
    expect(spot ? spot.box.left - base.x : 0).toBeLessThan(110); // close beside the ring (60 px) and its air
    const m = world(915, 412, true);
    const mb = { x: 915 - 100, y: 240 };
    const ms = place(m, mb);
    expect(ms?.box.right).toBeLessThan(mb.x);
  });

  it('goes to the outer side when the inner side is the road ahead', () => {
    const wd = world(915, 412, false);
    const base = { x: 215, y: 150 }; // inner side would be x 283+, inside the road ahead (x from 229)
    const spot = place(wd, base);
    expect(spot).not.toBeNull();
    expect(spot ? overlap(spot.box, wd.look) : true).toBe(false);
  });

  it('is deterministic: the same input gives the same place', () => {
    const wd = world(844, 390, false);
    const a = place(wd, { x: 130, y: 200 });
    const b = place(wd, { x: 130, y: 200 });
    expect(a).toEqual(b);
  });
});
