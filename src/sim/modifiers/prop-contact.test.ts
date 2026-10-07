// Every set-piece prop a rider can reach is met by the one rule (the maintainer, 2026-10-06: "a road race
// in a physical world with honest edges"; docs/content-packs.md, "Contact outcomes: one rule"). The polish J
// live check rode through a parade's marchers, roadwork's flagger and a crash scene's cop with no contact.
// Here, on testConfig's straight with a lane vote, roadwork and a speed trap forced in, a rider is put in
// line with each kind that had no sim shape and ridden through it, by sim ticks: a sign is ridden through
// with a wobble and stays standing, the radar is knocked flying, a person is a soft wobble (never a crash)
// and stumbles aside, and the gantry's post is solid by closing speed. Each with its negative control: the
// switch off (`modifiers.propContact` 0, every race recorded before), the same ride meets nothing.
import { describe, expect, it } from 'vitest';
import { createSimWithWorld } from '../create';
import { input, testConfig } from '../riders/testing';
import { PIECE_SOLIDS_KEY, type PieceSolids } from '../riders/features';
import type { PropKind, SimConfig, SimEvent, SimModifierDef } from '../types';
import { GANTRY_POST, PROP_CONTACT_KEY, setPieceState, type SetProp } from './setpieces';

const mod = (id: string, effect: Record<string, unknown>): SimModifierDef => ({
  contentId: `test:${id}`,
  kind: 'human',
  chance: 1,
  atProgress: [0.2, 0.6],
  durationTicks: 0,
  weight: 1,
  effects: [{ kind: 'set-piece', signText: id.toUpperCase(), ...effect }],
});

function config(contact: 0 | 1): SimConfig {
  const base = testConfig({ tuning: { [PROP_CONTACT_KEY]: contact } });
  return {
    ...base,
    modifiers: [
      mod('vote', { piece: 'lane-vote', left: 'work', right: 'trap', leftText: 'A', rightText: 'B' }),
      mod('work', { piece: 'roadwork', person: 'flagger' }),
      mod('trap', { piece: 'speed-trap' }),
    ],
  };
}

/** A race with every piece live (the player taken past each in turn), and the player's mover. */
function live(contact: 0 | 1) {
  const cfg = config(contact);
  const { sim, world } = createSimWithWorld(cfg);
  const me = world.movers[0];
  if (!me) throw new Error('no player');
  const st = setPieceState(world);
  for (const p of st.pieces) {
    me.pos.s = p.u - 200;
    for (let t = 0; t < 3; t++) sim.step([input(0)]);
  }
  expect(
    st.pieces.every((p) => p.phase === 1),
    'every piece is live',
  ).toBe(true);
  return { cfg, sim, world, me, st };
}

/** The first prop of a kind (and look), as the sim holds it. */
function propOf(st: ReturnType<typeof setPieceState>, kind: PropKind, variant?: string): SetProp {
  const q = st.props.find((x) => x.kind === kind && (variant === undefined || x.variant === variant));
  if (!q) throw new Error(`no ${kind}`);
  return q;
}

/** Rides the player from `back` m short of (s, d) at `speed`, held there, for `ticks`; the events it caused. */
function ride(
  r: ReturnType<typeof live>,
  at: { s: number; d: number },
  speed: number,
  back: number,
  ticks: number,
): SimEvent[] {
  const { sim, me } = r;
  me.pos.s = at.s - back;
  me.pos.d = at.d;
  me.pos.dir = 1;
  me.yaw = 0;
  me.speed = speed;
  me.mode = 'Road';
  me.h = 0;
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    me.speed = Math.max(me.speed, me.mode === 'Road' ? Math.min(speed, me.speed + 0.2) : 0);
    sim.step([input(0)]);
    out.push(...sim.events().filter((e) => e.actor === me.id));
    if (out.some((e) => e.type === 'crash')) break;
  }
  return out;
}

/** The middle of testConfig's straight's right shoulder (3.4 to 4.9 m), where a rider rides. */
const SHOULDER_CD = 4.15;

const wobblesFrom = (events: readonly SimEvent[], prop: string) =>
  events.filter((e) => e.type === 'wobble' && e.data['prop'] === prop);

describe('set-piece props with no sim shape before are met by the one rule', () => {
  it('a sign: ridden through with one wobble, never a crash, and it stays standing; switched off, nothing', () => {
    const on = live(1);
    const sign = propOf(on.st, 'sign', 'roadwork');
    // Signs stand past the lanes and their shoulder (standSignsOff): here off the straight's 4.9 m band, out of
    // a rider's reach. Stood back on the shoulder, where a road's own verge would let a rider reach it.
    expect(sign.cd).toBeGreaterThan(4.9);
    sign.cd = SHOULDER_CD;
    const evOn = ride(on, { s: sign.u, d: sign.cd }, 15, 15, 90);
    expect(wobblesFrom(evOn, 'sign')).toHaveLength(1);
    expect(evOn.some((e) => e.type === 'crash')).toBe(false);
    expect(sign.moving).toBe(false);
    const off = live(0);
    const signOff = propOf(off.st, 'sign', 'roadwork');
    signOff.cd = SHOULDER_CD;
    const evOff = ride(off, { s: signOff.u, d: signOff.cd }, 15, 15, 90);
    expect(wobblesFrom(evOff, 'sign')).toHaveLength(0);
    console.log(
      `[examined] sign at u ${sign.u.toFixed(1)} cd ${sign.cd.toFixed(2)}: on ${wobblesFrom(evOn, 'sign').length} wobble, off ${wobblesFrom(evOff, 'sign').length}`,
    );
  });

  it('the radar: knocked flying with a wobble, never a crash; switched off, nothing', () => {
    const on = live(1);
    const radar = propOf(on.st, 'radar');
    const evOn = ride(on, { s: radar.u, d: radar.cd }, 15, 15, 90);
    expect(wobblesFrom(evOn, 'radar')).toHaveLength(1);
    expect(evOn.some((e) => e.type === 'crash')).toBe(false);
    expect(radar.moving || radar.tilt > 0).toBe(true);
    const off = live(0);
    const radarOff = propOf(off.st, 'radar');
    expect(wobblesFrom(ride(off, { s: radarOff.u, d: radarOff.cd }, 15, 15, 90), 'radar')).toHaveLength(0);
    expect(radarOff.moving).toBe(false);
  });

  it('a person met before they are out of the way: a soft wobble, never a crash, and they stumble aside; switched off, nothing', () => {
    const on = live(1);
    const flagger = propOf(on.st, 'person', 'flagger');
    const before = flagger.cd;
    // Right on them: no time to step aside.
    const evOn = ride(on, { s: flagger.u, d: flagger.cd }, 10, 0.5, 40);
    expect(wobblesFrom(evOn, 'person')).toHaveLength(1);
    expect(evOn.some((e) => e.type === 'crash')).toBe(false);
    expect(Math.abs(flagger.cd - before)).toBeGreaterThan(0.5);
    const off = live(0);
    const flaggerOff = propOf(off.st, 'person', 'flagger');
    expect(wobblesFrom(ride(off, { s: flaggerOff.u, d: flaggerOff.cd }, 10, 0.5, 40), 'person')).toHaveLength(
      0,
    );
  });

  it("the gantry's post: solid by closing speed where it is drawn, a crash square on at speed, a wobble slow; switched off, nothing", () => {
    const on = live(1);
    const gantry = propOf(on.st, 'gantry');
    const solids = (on.world.systems[PIECE_SOLIDS_KEY] as PieceSolids | undefined)?.live ?? [];
    expect(solids).toHaveLength(1);
    const post = solids[0]?.feature;
    // Where render draws it: its span's half and GANTRY_POST.outM to the right of the way it faces.
    const d = gantry.cd + Math.max(GANTRY_POST.minSpanM, gantry.span) / 2 + GANTRY_POST.outM;
    expect(((post?.d0 ?? 0) + (post?.d1 ?? 0)) / 2).toBeCloseTo(d, 6);
    expect(((post?.s0 ?? 0) + (post?.s1 ?? 0)) / 2).toBeCloseTo(gantry.u, 6);
    const fast = ride(on, { s: gantry.u, d }, 20, 20, 120);
    const crash = fast.find((e) => e.type === 'crash');
    expect(crash?.data['object']).toBe('gantry-post');
    const slowRace = live(1);
    const slow = ride(slowRace, { s: gantry.u, d }, 5, 6, 180);
    expect(slow.some((e) => e.type === 'crash')).toBe(false);
    expect(slow.filter((e) => e.type === 'wobble' && e.data['object'] === 'gantry-post')).toHaveLength(1);
    const off = live(0);
    expect(off.world.systems[PIECE_SOLIDS_KEY]).toBeUndefined();
    const through = ride(off, { s: gantry.u, d }, 20, 20, 120);
    expect(through.some((e) => e.type === 'crash' || e.type === 'wobble')).toBe(false);
    console.log(
      `[examined] gantry post at u ${gantry.u.toFixed(1)} d ${d.toFixed(2)}: 20 m/s ${crash ? `crash (${String(crash.data['hit'])})` : 'no crash'}; 5 m/s ${slow.filter((e) => e.type === 'wobble').length} wobble; off: ${through.length} events`,
    );
  });
});
