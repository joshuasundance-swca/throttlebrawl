// The law's own props are met by the one rule, like a set piece's (the maintainer, 2026-10-06: "a road race
// in a physical world with honest edges"; docs/content-packs.md, "Contact outcomes: one rule"). The polish M
// live check rode through the cops' END OF JURISDICTION sign (Key West seed 4, Smathers Beach: 0.16 m from its
// foot at 39.7 m/s, nothing; Bridge City's sheriff sign the same): sim/cops draws them (`lawProps`) and nothing
// met them. Here, on testConfig's straight with the heat meter's sign and a radar trooper's radar standing, a
// rider is put in line with each and ridden through by sim ticks: the sign is ridden through with one wobble
// and stays standing, the radar is knocked flying, neither is ever a crash, and a rider is not blamed with
// heat for it. Each with its negative controls: the switch off (`modifiers.propContact` 0, every race recorded
// before), and the same ride passing wide of it, meet nothing.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { copsState, lawProps, lawSnapshot, routePosAt } from '../cops';
import { createSimWithWorld } from '../create';
import { input, TEST_BIKE, testConfig } from '../riders/testing';
import { LAW_PROP_ID_BASE, SIM_TUNING, type PropSnapshot, type SimConfig, type SimEvent } from '../api';
import { PROP_CONTACT_KEY } from './setpieces';

const TROOPER = 1;

function config(contact: 0 | 1): SimConfig {
  const base = testConfig();
  return {
    ...base,
    riders: [
      ...base.riders,
      {
        contentId: 'base:trooper',
        name: 'Trooper',
        role: 'cop',
        faction: 'law',
        controller: { kind: 'cop' },
        bike: TEST_BIKE,
        massKg: 95,
        healthMax: 100,
        law: { agency: 'base:test-law', bustRadiusM: 14, bustDwellS: 1, fineCash: 400, pursuitSpeedScale: 1 },
      },
    ],
    event: {
      ...base.event,
      cops: {
        mode: 'every-race',
        baseCount: 0,
        tierScale: 0,
        chaosSummon: false,
        randomness: 0,
        heat: true,
        jurisdiction: { label: 'END OF JURISDICTION. Have a nice day.', agency: 'base:test-law' },
      },
    },
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), [PROP_CONTACT_KEY]: contact },
  };
}

/** A race with the sign up and the trooper's radar standing 100 m before it, and the player's mover. */
function live(contact: 0 | 1) {
  const cfg = config(contact);
  const { sim, world } = createSimWithWorld(cfg);
  const me = world.movers[0];
  if (!me) throw new Error('no player');
  const st = copsState(world);
  expect(st.lineAt, 'the sign stands').toBeGreaterThan(0);
  expect(st.cops, 'the trooper is a cop').toContain(TROOPER);
  // The radar: on the shoulder, 100 m before the sign (as a patrol cop's stands beside him on a bridge).
  st.radarAt[TROOPER] = st.lineAt - 100;
  st.radarD[TROOPER] = 4.15;
  const sign = lawProps(world, cfg).find((p) => p.kind === 'sign');
  const radar = lawProps(world, cfg).find((p) => p.kind === 'radar');
  if (!sign || !radar) throw new Error('the law props are not standing');
  return { cfg, sim, world, me, st, sign, radar };
}

/** The prop as the snapshot shows it now. */
const propNow = (r: ReturnType<typeof live>, id: number): PropSnapshot | undefined =>
  lawProps(r.world, r.cfg).find((p) => p.id === id);

/** Rides the player from `back` m short of (s, d) at `speed` for `ticks`; the events it caused. */
function ride(
  r: ReturnType<typeof live>,
  at: { s: number; d: number },
  speed: number,
  back: number,
  ticks: number,
) {
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
    out.push(...sim.events());
    if (out.some((e) => e.type === 'crash' && e.actor === me.id)) break;
  }
  return out;
}

const wobblesFrom = (events: readonly SimEvent[], prop: string, actor = 0) =>
  events.filter((e) => e.type === 'wobble' && e.data['prop'] === prop && e.actor === actor);
const crashed = (events: readonly SimEvent[]) => events.some((e) => e.type === 'crash');

/** Where the trooper's radar stands on the straight (s, d), and the trooper beside it. */
function radarAt(r: ReturnType<typeof live>): { s: number; d: number } {
  const s = routePosAt(r.cfg, r.st.radarAt[TROOPER] ?? 0)?.s ?? 0;
  const d = r.st.radarD[TROOPER] ?? 0;
  const cop = r.world.movers[TROOPER];
  if (cop) cop.pos = { edge: 0, s, d: d + 0.9, dir: 1 };
  return { s, d };
}

describe('the law props are met by the one rule', () => {
  it('the END OF JURISDICTION sign: ridden through with one wobble, never a crash, and it stays standing; switched off or passed wide, nothing', () => {
    const on = live(1);
    const at = { s: on.st.lineS, d: on.st.lineD };
    const before = { x: on.sign.x, z: on.sign.z };
    const evOn = ride(on, at, 15, 15, 90);
    expect(on.me.pos.s, 'the rider rode past the sign').toBeGreaterThan(at.s + 1);
    expect(wobblesFrom(evOn, 'sign')).toHaveLength(1);
    expect(wobblesFrom(evOn, 'sign')[0]?.data['piece']).toBe('base:test-law');
    expect(crashed(evOn)).toBe(false);
    const after = propNow(on, LAW_PROP_ID_BASE);
    expect(after).toMatchObject({ moving: false, tilt: 0, ...before });
    // Walking over a sign is no riot: no heat for it (a set piece's wobble costs some; this sign is the law's).
    expect(lawSnapshot(on.world, on.cfg).heat).toBe(0);
    // Negative controls: the switch off, and the same ride a lane's width past the post.
    const off = live(0);
    expect(wobblesFrom(ride(off, { s: off.st.lineS, d: off.st.lineD }, 15, 15, 90), 'sign')).toHaveLength(0);
    expect(off.me.pos.s, 'switched off, the rider rode past the sign').toBeGreaterThan(off.st.lineS + 1);
    const wide = live(1);
    expect(
      wobblesFrom(ride(wide, { s: wide.st.lineS, d: wide.st.lineD - 3 }, 15, 15, 90), 'sign'),
    ).toHaveLength(0);
    expect(wide.me.pos.s, 'wide, the rider rode past the sign').toBeGreaterThan(wide.st.lineS + 1);
    console.log(
      `[examined] END OF JURISDICTION sign at s ${on.st.lineS.toFixed(1)} d ${on.st.lineD.toFixed(2)}: on ${wobblesFrom(evOn, 'sign').length} wobble, off 0, wide 0`,
    );
  });

  it('the radar: knocked flying with a wobble, never a crash; switched off or passed wide, nothing; its own trooper does not trip it', () => {
    const on = live(1);
    const id = LAW_PROP_ID_BASE + 1 + TROOPER;
    const at = radarAt(on);
    // The trooper stands by his radar throughout (nothing steps him off it): no wobble for him, only the rider.
    const evOn = ride(on, at, 15, 15, 90);
    expect(wobblesFrom(evOn, 'radar')).toHaveLength(1);
    expect(wobblesFrom(evOn, 'radar', TROOPER)).toHaveLength(0);
    expect(crashed(evOn)).toBe(false);
    expect(on.me.pos.s, 'the rider rode past the radar').toBeGreaterThan(at.s + 1);
    expect(propNow(on, id)?.tilt).toBeGreaterThan(0);
    const off = live(0);
    const evOff = ride(off, radarAt(off), 15, 15, 90);
    expect(wobblesFrom(evOff, 'radar')).toHaveLength(0);
    expect(propNow(off, id)).toMatchObject({ moving: false, tilt: 0 });
    expect(off.me.pos.s, 'switched off, the rider rode past the radar').toBeGreaterThan(at.s + 1);
    const wide = live(1);
    const there = radarAt(wide);
    const evWide = ride(wide, { s: there.s, d: there.d - 3 }, 15, 15, 90);
    expect(wobblesFrom(evWide, 'radar')).toHaveLength(0);
    expect(propNow(wide, id)).toMatchObject({ moving: false, tilt: 0 });
  });

  it('the wobble kicks the heading away from the prop, whichever side the rider is on', () => {
    for (const [offset, name] of [
      [-0.3, 'the sign on his right'],
      [0.3, 'the sign on his left'],
    ] as const) {
      const r = live(1);
      const { sim, me } = r;
      me.pos.s = r.st.lineS - 4;
      me.pos.d = r.st.lineD + offset;
      me.pos.dir = 1;
      me.yaw = 0;
      me.speed = 15;
      me.mode = 'Road';
      me.h = 0;
      let kicked: number | null = null;
      for (let t = 0; t < 60 && kicked === null; t++) {
        sim.step([input(0)]);
        if (sim.events().some((e) => e.type === 'wobble' && e.actor === me.id)) kicked = me.yaw;
      }
      expect(kicked, `${name}: met`).not.toBeNull();
      // Positive yaw turns right: the sign on his right kicks him left (negative), and the other way round.
      expect(Math.sign(kicked ?? 0), name).toBe(offset < 0 ? -1 : 1);
    }
  });
});
