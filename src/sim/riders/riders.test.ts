// riders-1 acceptance (docs/milestones/M1.md, "riders-1 · Bike handling"): throttle converges to
// top speed, letting go slows, braking stops within a bounded distance, the barrier always gives a
// wobble or crash event, no NaN at zero speed or across a junction, and a scripted run hashes the
// same every time.
import { describe, expect, it } from 'vitest';
import { createSim } from '../api';
import type { SimEvent } from '../types';
import { barrierLimits, riderState, RIDERS_TUNING, WOBBLE_TICKS } from './index';
import { input, riderHarness, testConfig } from './testing';

const TOP = 38;

describe('riders-1: longitudinal', () => {
  it('converges to top speed under full throttle on the flat, and never passes it', () => {
    const h = riderHarness(testConfig(), { s: 10, d: 1.7 });
    let max = 0;
    for (let t = 0; t < 60 * 40; t++) {
      h.step(input(1));
      max = Math.max(max, h.rider.speed);
    }
    expect(h.rider.speed).toBeGreaterThan(TOP - 0.5);
    expect(max).toBeLessThanOrEqual(TOP);
  });

  it('scales top speed and acceleration by the tuning panel (non-default values)', () => {
    const slow = riderHarness(testConfig({ tuning: { 'riders.speedScale': 0.8 } }), { s: 10, d: 1.7 });
    for (let t = 0; t < 60 * 40; t++) slow.step(input(1));
    expect(slow.rider.speed).toBeGreaterThan(TOP * 0.8 - 0.5);
    expect(slow.rider.speed).toBeLessThanOrEqual(TOP * 0.8);

    // Half a second from a standstill: the launch punch (playtest 1c) fades as the bike nears 75 % of
    // top speed, so over a longer run the quicker bike loses more of it and the ratio shrinks.
    const quick = riderHarness(testConfig({ tuning: { 'riders.accelScale': 1.5 } }), { s: 10, d: 1.7 });
    const base = riderHarness(testConfig(), { s: 10, d: 1.7 });
    for (let t = 0; t < 30; t++) {
      quick.step(input(1));
      base.step(input(1));
    }
    expect(quick.rider.speed).toBeGreaterThan(base.rider.speed * 1.3);
  });

  it('slows the bike when the throttle is let go (coasting), monotonically', () => {
    const h = riderHarness(testConfig(), { s: 10, d: 1.7, speed: 30 });
    let prev = h.rider.speed;
    for (let t = 0; t < 120; t++) {
      h.step(input(0));
      expect(h.rider.speed).toBeLessThan(prev);
      prev = h.rider.speed;
    }
    expect(h.rider.speed).toBeLessThan(28);
    expect(h.rider.speed).toBeGreaterThan(20); // a coast, not a brake
  });

  it('stops from top speed within a bounded distance and time under full brake', () => {
    const h = riderHarness(testConfig(), { s: 10, d: 1.7, speed: TOP });
    const s0 = h.rider.pos.s;
    let ticks = 0;
    while (h.rider.speed > 0 && ticks < 600) {
      h.step(input(0, 1));
      ticks++;
    }
    const dist = h.rider.pos.s - s0;
    // v² / 2·brake = 80.2 m for the bike's 9 m/s²; coasting drag and air drag only shorten it.
    expect(h.rider.speed).toBe(0);
    expect(dist).toBeLessThanOrEqual((TOP * TOP) / (2 * 9));
    expect(dist).toBeGreaterThan(50);
    expect(ticks).toBeLessThanOrEqual(Math.ceil((TOP / 9) * 60));
  });

  it('climbs slower and descends faster (grade)', () => {
    const cfg = (grade: number) => testConfig({ edges: [{ id: 'a', lengthM: 3000, kappa: 0, grade }] });
    const up = riderHarness(cfg(0.06), { s: 10, d: 1.7, speed: 20 });
    const flat = riderHarness(cfg(0), { s: 10, d: 1.7, speed: 20 });
    const down = riderHarness(cfg(-0.06), { s: 10, d: 1.7, speed: 20 });
    for (let t = 0; t < 120; t++) for (const h of [up, flat, down]) h.step(input(0.5));
    expect(up.rider.speed).toBeLessThan(flat.rider.speed);
    expect(down.rider.speed).toBeGreaterThan(flat.rider.speed);
  });
});

describe('riders-1: steering, lean and direction', () => {
  it('steering right moves toward +d riding with s, and toward -d riding against it', () => {
    const fwd = riderHarness(testConfig(), { s: 100, d: 0, dir: 1, speed: 20 });
    const back = riderHarness(testConfig(), { s: 2000, d: 0, dir: -1, speed: 20 });
    for (let t = 0; t < 30; t++) {
      fwd.step(input(0.5, 0, 1));
      back.step(input(0.5, 0, 1));
    }
    expect(fwd.rider.pos.d).toBeGreaterThan(0.5);
    expect(back.rider.pos.d).toBeLessThan(-0.5);
    expect(fwd.rider.pos.s).toBeGreaterThan(100);
    expect(back.rider.pos.s).toBeLessThan(2000);
  });

  it('scales steering by the tuning panel at low and high speed (non-default value)', () => {
    for (const speed of [8, 30]) {
      const base = riderHarness(testConfig(), { s: 100, d: 0, speed });
      const sharp = riderHarness(testConfig({ tuning: { 'riders.steerScale': 1.5 } }), {
        s: 100,
        d: 0,
        speed,
      });
      for (let t = 0; t < 20; t++) {
        base.step(input(0.3, 0, 0.5));
        sharp.step(input(0.3, 0, 0.5));
      }
      expect(sharp.rider.pos.d).toBeGreaterThan(base.rider.pos.d * 1.3);
    }
  });

  it('leans into a turn from the sideways acceleration, and the lean is smoothed', () => {
    const h = riderHarness(testConfig(), { s: 100, d: -1, speed: 25 });
    h.step(input(0.5, 0, 1));
    const first = riderState(h.world).lean[h.rider.id] ?? 0;
    for (let t = 0; t < 8; t++) h.step(input(0.5, 0, 1));
    const later = riderState(h.world).lean[h.rider.id] ?? 0;
    expect(first).toBeGreaterThan(0); // leaning right, into a right turn
    expect(later).toBeGreaterThan(first); // builds up, not instant
    const left = riderHarness(testConfig(), { s: 100, d: 1, speed: 25 });
    for (let t = 0; t < 9; t++) left.step(input(0.5, 0, -1));
    expect(riderState(left.world).lean[left.rider.id] ?? 0).toBeLessThan(0);
  });

  it('advances s by v/(1 − kappa·d) on a bend, the same rule in both directions', () => {
    const kappa = 1 / 150;
    const bend = [{ id: 'a', lengthM: 3000, kappa }];
    for (const dir of [1, -1] as const) {
      const s0 = dir === 1 ? 100 : 2900;
      for (const d of [-3, 3]) {
        const h = riderHarness(testConfig({ edges: bend }), { s: s0, d, dir, speed: 20 });
        // One tick at yaw 0 and constant speed isolates ds/dt (throttle holds 20 m/s roughly).
        h.step(input(0));
        const v = h.rider.speed;
        const ds = h.rider.pos.s - s0;
        expect(ds).toBeCloseTo((dir * v) / (1 - kappa * d) / 60, 9);
      }
    }
  });

  it('couples yaw to the road: with no steering the rider drifts to the outside of the bend', () => {
    const bend = [{ id: 'a', lengthM: 3000, kappa: 1 / 150 }]; // a right-hand bend
    const fwd = riderHarness(testConfig({ edges: bend }), { s: 100, d: 0, dir: 1, speed: 20 });
    const back = riderHarness(testConfig({ edges: bend }), { s: 2900, d: 0, dir: -1, speed: 20 });
    for (let t = 0; t < 90; t++) {
      fwd.step(input(0.4));
      back.step(input(0.4));
    }
    // The bend's centre is on the +d side whichever way you ride it (it turns right riding with s,
    // left riding against s), so riding straight on drifts toward -d, the outside, both ways.
    expect(fwd.rider.pos.d).toBeLessThan(-0.3);
    expect(back.rider.pos.d).toBeLessThan(-0.3);
    expect(back.rider.yaw).toBeGreaterThan(0); // toward the rider's right, which is -d riding against s
  });
});

describe('riders-1: the shoulder and the barrier', () => {
  const crashOrWobble = (events: readonly SimEvent[]) =>
    events.filter((e) => e.type === 'crash' || e.type === 'wobble');

  it('never lets steering push past the shoulder without a wobble or crash event (both sides, both directions)', () => {
    for (const dir of [1, -1] as const) {
      for (const steer of [1, -1]) {
        for (const speed of [8, 20, 36]) {
          const cfg = testConfig();
          const h = riderHarness(cfg, { s: dir === 1 ? 100 : 2800, d: 1.7 * dir, dir, speed });
          const { lo, hi } = barrierLimits(cfg, 0, 100);
          let firstContact = -1;
          let firstEvent = -1;
          for (let t = 0; t < 240; t++) {
            const ev = crashOrWobble(h.step(input(0.6, 0, steer)));
            const d = h.rider.pos.d;
            expect(d).toBeGreaterThanOrEqual(lo);
            expect(d).toBeLessThanOrEqual(hi);
            if (firstContact < 0 && (d === lo || d === hi)) firstContact = t;
            if (firstEvent < 0 && ev.length > 0) firstEvent = t;
          }
          expect(firstContact).toBeGreaterThanOrEqual(0);
          expect(firstEvent).toBe(firstContact);
        }
      }
    }
  });

  // A tight right-hander taken flat out while steering wide: the road turning under the bike adds
  // to the steered heading, so the rider meets the outside wall at well over 6 m/s across.
  const TIGHT = [{ id: 'a', lengthM: 3000, kappa: 1 / 80 }];
  const tooFast = (tuning: Record<string, number> = {}) =>
    riderHarness(testConfig({ edges: TIGHT, tuning }), { s: 100, d: 0, speed: 36 });

  it('a gentle drift into the barrier wobbles; running wide at speed crashes', () => {
    const cfg = testConfig();
    const gentle = riderHarness(cfg, { s: 100, d: 3.5, speed: 12 });
    const gentleEvents: SimEvent[] = [];
    for (let t = 0; t < 60; t++) gentleEvents.push(...gentle.step(input(0.3, 0, 0.3)));
    expect(gentleEvents.map((e) => e.type)).toEqual(['wobble']);
    expect(riderState(gentle.world).wobble[gentle.rider.id]).toBeGreaterThan(0);

    const hard = tooFast();
    const hardEvents: SimEvent[] = [];
    for (let t = 0; t < 120; t++) hardEvents.push(...hard.step(input(1, 0, -1)));
    const crash = hardEvents.find((e) => e.type === 'crash');
    expect(crash).toBeDefined();
    expect(crash?.actor).toBe(hard.rider.id);
    expect(crash?.data['cause']).toBe('barrier');
    expect(Number(crash?.data['impactMps'])).toBeGreaterThanOrEqual(6);
  });

  it('crashes on a lighter contact while already wobbling, and the crash speed is tunable', () => {
    const cfg = testConfig();
    const h = riderHarness(cfg, { s: 100, d: 4.35, speed: 20, yaw: 0.06 });
    const types: string[] = [];
    for (let t = 0; t < 10; t++) types.push(...h.step(input(0.5, 0, 0.4)).map((e) => e.type));
    expect(types).toEqual(['wobble']);
    // Back off the wall, then steer in hard: about 3.4 m/s across, under 6 but over 40 % of it.
    h.rider.pos.d = 3.8;
    h.rider.yaw = 0.2;
    for (let t = 0; t < 20; t++) types.push(...h.step(input(0.5, 0, 1)).map((e) => e.type));
    expect(types).toContain('crash');

    // The same run wide only wobbles when the crash speed is raised to 15 m/s.
    const tough = tooFast({ 'riders.crashImpactMps': 15 });
    const toughTypes: string[] = [];
    for (let t = 0; t < 120; t++) toughTypes.push(...tough.step(input(1, 0, -1)).map((e) => e.type));
    expect(toughTypes).toEqual(['wobble']);
  });

  it('wobbles for a while, then settles, with the wobble counted down in scaled time', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 3.5, speed: 12 });
    let t = 0;
    while (h.step(input(0.3, 0, 0.3)).length === 0 && t < 60) t++;
    const st = riderState(h.world);
    expect(st.wobble[h.rider.id]).toBe(WOBBLE_TICKS);
    h.world.timeScale = 0.5;
    h.step(input(0.3));
    expect(st.wobble[h.rider.id]).toBe(WOBBLE_TICKS - 0.5);
    h.world.timeScale = 1;
    for (let k = 0; k < WOBBLE_TICKS; k++) h.step(input(0.3, 0, -0.2));
    expect(st.wobble[h.rider.id]).toBe(0);
  });

  it('is slower on the shoulder than in the lane', () => {
    const lane = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 25 });
    const shoulder = riderHarness(testConfig(), { s: 100, d: 4.15, speed: 25 });
    for (let t = 0; t < 60; t++) {
      lane.step(input(0.6));
      shoulder.step(input(0.6));
    }
    expect(shoulder.rider.speed).toBeLessThan(lane.rider.speed - 1);
  });

  it('tops out clearly slower on the shoulder, flat out (playtest 1 item 2: shoulders stay slower)', () => {
    // Wider travel lanes (road lane) must not make the shoulder a free overtaking lane.
    const lane = riderHarness(testConfig(), { s: 10, d: 1.7 });
    const shoulder = riderHarness(testConfig(), { s: 10, d: 4.15 });
    for (let t = 0; t < 60 * 40; t++) {
      lane.step(input(1));
      shoulder.step(input(1));
    }
    expect(shoulder.rider.pos.d).toBeCloseTo(4.15, 6); // still on the shoulder
    expect(shoulder.rider.speed).toBeLessThan(lane.rider.speed * 0.85);
  });
});

describe('riders-1: robustness and determinism', () => {
  it('has no NaN at zero speed, whatever the input', () => {
    const h = riderHarness(testConfig(), { s: 100, d: 1.7, speed: 0 });
    for (let t = 0; t < 300; t++) {
      h.step(input(t % 3 === 0 ? 0 : 0.01, t % 5 === 0 ? 1 : 0, t % 2 === 0 ? 1 : -1));
      const st = riderState(h.world);
      for (const v of [
        h.rider.pos.s,
        h.rider.pos.d,
        h.rider.speed,
        h.rider.yaw,
        st.lean[h.rider.id],
        st.rpm[h.rider.id],
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(h.rider.speed).toBeGreaterThanOrEqual(0);
    }
  });

  it('crosses a junction transfer with no NaN and no lost or doubled distance', () => {
    const edges = [
      { id: 'a', lengthM: 200, kappa: 1 / 200 },
      { id: 'b', lengthM: 200, kappa: -1 / 250 },
      { id: 'c', lengthM: 400, kappa: 0 },
    ];
    const cfg = testConfig({ edges });
    const h = riderHarness(cfg, { s: 150, d: 0, speed: 30 });
    const seen = new Set<number>();
    let prevS = h.rider.pos.s;
    let prevEdge = h.rider.pos.edge;
    for (let t = 0; t < 60 * 10; t++) {
      h.step(input(1));
      const p = h.rider.pos;
      for (const v of [p.s, p.d, h.rider.speed, h.rider.yaw]) expect(Number.isFinite(v)).toBe(true);
      // Progress this tick, measured across the edge change: at most one tick at top speed / 0.1.
      const lenPrev = cfg.road.edges[prevEdge]?.length ?? 0;
      const ds = p.edge === prevEdge ? p.s - prevS : lenPrev - prevS + p.s;
      expect(ds).toBeGreaterThan(0);
      expect(ds).toBeLessThan(1);
      seen.add(p.edge);
      prevS = p.s;
      prevEdge = p.edge;
    }
    expect([...seen]).toEqual([0, 1, 2]);
  });

  it('600 ticks of scripted input give the same hash every run, including barrier contacts', () => {
    const script = (t: number) =>
      input(t % 300 < 250 ? 1 : 0, t % 300 >= 280 ? 0.7 : 0, t < 200 ? 0.9 : t < 400 ? -0.9 : 0.2);
    const run = () => {
      const sim = createSim(testConfig({ rivals: 1 }));
      const hashes: number[] = [];
      const types = new Set<string>();
      for (let t = 0; t < 600; t++) {
        sim.step([script(t)]);
        hashes.push(sim.hash());
        for (const e of sim.events()) types.add(e.type);
      }
      return { hashes, types };
    };
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(new Set(a.hashes).size).toBe(600);
    expect(a.types.has('wobble') || a.types.has('crash')).toBe(true);
  });

  it('declares its tuning parameters inside their ranges, all sim-affecting', () => {
    const ids = RIDERS_TUNING.map((d) => d.id);
    expect(ids).toEqual([
      'riders.steerScale',
      'riders.speedScale',
      'riders.accelScale',
      'riders.launchGain',
      'riders.crashImpactMps',
      'riders.bendEdgeForgive',
      'riders.fenceSmashMps',
      'riders.landingCrashMps',
      'riders.airCarve',
      'riders.airAlign',
      'riders.crestLaunch',
      'riders.surgeMinAirS',
      'riders.surgeS',
      'riders.surgeMps',
      'riders.landingHitDamage',
      'riders.landingHitHurtShare',
      'riders.laneDropTaperM',
      'riders.airControl',
      'riders.newspaperAirS',
      'riders.uturnMps',
      'riders.uturnRate',
      'riders.wheelie',
      'riders.wheelieGain',
      'riders.wheelieRise',
      'riders.drift',
      'riders.driftSteerGain',
      'riders.driftDrag',
      'riders.driftChainS',
      'riders.driftMinMps',
      'riders.driftEdgeForgive',
      'riders.driftExitMps',
      'riders.highDropM',
      'riders.furniture',
      'riders.smokeSlowdown',
      'riders.supports',
    ]);
    for (const d of RIDERS_TUNING) {
      expect(d.affectsSim).toBe(true);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });
});
