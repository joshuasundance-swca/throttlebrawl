/// <reference types="vite/client" />
// The polish M live check's two places, replayed in the real races (the maintainer, 2026-10-06: "a road
// race in a physical world with honest edges"): the cops' END OF JURISDICTION sign was ridden through with
// no contact at all, in Key West (seed 4, Smathers Beach: 0.16 m from its foot at 39.7 m/s) and in Bridge
// City (seed 1, the Fir County sheriff's sign on Broadway South). Here the player is put on the sign's own
// road, in line with its post, at the speed the live ride had, and ridden through by sim ticks: one wobble
// (`lawProp`), never a crash, and the sign stands. The same ride with the switch off (`modifiers.propContact`
// 0, every race recorded before) and the same ride passing 3 m wide of it meet nothing.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type { SimConfig, SimEvent } from '../../src/sim/api';
import { copsState, lawProps } from '../../src/sim/cops';
import { createSimWithWorld } from '../../src/sim/create';
import { input } from '../../src/sim/riders/testing';
import { PROP_CONTACT_KEY } from '../../src/sim/modifiers/setpieces';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

interface Place {
  name: string;
  event: string;
  route?: string;
  seed: number;
  mps: number;
}
const PLACES: readonly Place[] = [
  {
    name: 'Key West, Smathers Beach',
    event: 'base:m1-skeleton-sprint',
    route: 'base:osm-key-west-run',
    seed: 4,
    mps: 39.7,
  },
  {
    name: 'Bridge City, Broadway South',
    event: 'region-pnw:pnw-fogline-run',
    route: 'region-pnw:osm-bridge-city-run',
    seed: 1,
    mps: 20,
  },
];

function config(p: Place, contact: 0 | 1): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, p.event, 'standard', p.route), {
    seed: p.seed,
    eventId: p.event,
    length: 'standard',
    ...(p.route ? { route: p.route } : {}),
  });
  return { ...base, tuning: { ...base.tuning, [PROP_CONTACT_KEY]: contact } };
}

/** Rides the player at the sign's post from 12 m before it, `wide` m off its line; the player's events. */
function ride(p: Place, contact: 0 | 1, wide: number) {
  const cfg = config(p, contact);
  const { sim, world } = createSimWithWorld(cfg);
  const me = world.movers[cfg.riders.findIndex((r) => r.controller.kind === 'player')];
  if (!me) throw new Error('no player');
  const st = copsState(world);
  expect(st.lineAt, `${p.name}: the sign stands`).toBeGreaterThan(0);
  const before = lawProps(world, cfg).find((q) => q.kind === 'sign');
  me.pos = { edge: st.lineEdge, s: st.lineS - 12, d: st.lineD - wide, dir: 1 };
  me.yaw = 0;
  me.speed = p.mps;
  me.mode = 'Road';
  me.h = 0;
  const events: SimEvent[] = [];
  let reached = false;
  for (let t = 0; t < 60; t++) {
    me.speed = Math.max(me.speed, Math.min(p.mps, me.speed + 0.2));
    sim.step([input(0)]);
    events.push(...sim.events().filter((e) => e.actor === me.id));
    if (me.pos.edge === st.lineEdge && me.pos.s > st.lineS + 2) {
      reached = true;
      break;
    }
    if (events.some((e) => e.type === 'crash')) break;
  }
  const after = lawProps(world, cfg).find((q) => q.kind === 'sign');
  return { events, reached, before, after, st };
}

describe('the law sign met in the real races of the live check', () => {
  for (const p of PLACES) {
    it(`${p.name}, seed ${p.seed}: ridden through with one wobble, never a crash, and it stands`, () => {
      const on = ride(p, 1, 0);
      const wobbles = on.events.filter((e) => e.type === 'wobble' && e.data['cause'] === 'lawProp');
      expect(on.reached, 'the rider rode past the sign').toBe(true);
      expect(wobbles).toHaveLength(1);
      expect(wobbles[0]?.data['cause']).toBe('lawProp');
      expect(on.events.some((e) => e.type === 'crash')).toBe(false);
      expect(on.after).toEqual(on.before);
      // The controls: the switch off, and 3 m wide of the post, ride past it and meet nothing.
      const off = ride(p, 0, 0);
      expect(off.reached, 'switched off, the rider rode past the sign').toBe(true);
      expect(off.events.filter((e) => e.type === 'wobble' && e.data['cause'] === 'lawProp')).toHaveLength(0);
      const wide = ride(p, 1, 3);
      expect(wide.reached, 'wide, the rider rode past the sign').toBe(true);
      expect(wide.events.filter((e) => e.type === 'wobble' && e.data['cause'] === 'lawProp')).toHaveLength(0);
      console.log(
        `[examined] ${p.name}: sign on edge ${on.st.lineEdge} s ${on.st.lineS.toFixed(1)} d ${on.st.lineD.toFixed(1)}: on ${wobbles.length} wobble, off 0, 3 m wide 0`,
      );
    }, 120_000);
  }
});
