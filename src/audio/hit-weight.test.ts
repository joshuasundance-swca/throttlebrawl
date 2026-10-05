// Hits sound lower and meatier as a rival weakens (playtest 2, 2026-10-02, run W-Q audio). The patch
// takes a `weight`; the mixer reads it from the target's health in the snapshot.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { CUE_PATCHES } from './cue-patches';
import { weaknessOf } from './cues';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import { createAudio } from './system';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: -id,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId: 'deacon-vane',
    name: 'x',
    faction: 'rider',
    slot: -1,
    throttle: 0.5,
    rpm: 5000,
    gear: 2,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  };
}
const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 2000, finishOrder: [] },
});
const hit = (type: string, target: number, data: SimEvent['data'] = {}): SimEvent =>
  ({ tick: 1, type, actor: 0, target, data }) as SimEvent;

/** The sources one melee cue starts, with the first and lowest frequency each oscillator begins at. */
function render(cue: 'punch' | 'kick' | 'hit', weight?: number) {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  CUE_PATCHES[cue](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 0, 1, {
    ...(weight === undefined ? {} : { weight }),
  });
  const oscs = ctx.nodes.filter((n) => n.kind === 'oscillator');
  const lowest = Math.min(...oscs.map((o) => Math.min(...o.frequency.calls.map((c) => c.value))));
  const firstBody = oscs[0]!.frequency.calls[0]!.value;
  return { count: ctx.nodes.length, lowest, firstBody };
}

describe('weaknessOf', () => {
  it('is 0 for a fresh rival and rises to 1 as health runs out', () => {
    const at = (health: number) => weaknessOf(snap([rider(0, { slot: 0 }), rider(1, { health })]), 1);
    expect(at(100)).toBe(0);
    expect(at(50)).toBeCloseTo(0.5, 5);
    expect(at(5)).toBeCloseTo(0.95, 5);
    expect(at(0)).toBe(1);
  });

  it('is 0 for the player, traffic, an unknown target and a missing snapshot', () => {
    const s = snap([rider(0, { slot: 0, health: 10 }), rider(1, { kind: 'vehicle', health: 10 })]);
    expect(weaknessOf(s, 0)).toBe(0);
    expect(weaknessOf(s, 1)).toBe(0);
    expect(weaknessOf(s, 77)).toBe(0);
    expect(weaknessOf(s, undefined)).toBe(0);
    expect(weaknessOf(null, 1)).toBe(0);
  });

  it('never divides by a zero max health', () => {
    expect(weaknessOf(snap([rider(1, { healthMax: 0, health: 0 })]), 1)).toBe(0);
  });
});

describe('the melee patches by weight', () => {
  for (const cue of ['punch', 'kick', 'hit'] as const) {
    it(`${cue}: a weakened target takes a lower body and a sub thump`, () => {
      const fresh = render(cue, 0);
      const beaten = render(cue, 1);
      expect(beaten.firstBody).toBeLessThan(fresh.firstBody);
      expect(beaten.lowest).toBeLessThan(fresh.lowest);
      expect(beaten.count).toBeGreaterThan(fresh.count);
    });

    it(`${cue}: no weight sounds exactly as before, and the weight is clamped`, () => {
      expect(render(cue)).toEqual(render(cue, 0));
      expect(render(cue, 9)).toEqual(render(cue, 1));
      expect(render(cue, Number.NaN)).toEqual(render(cue, 0));
    });

    it(`${cue}: a bit weak is in between`, () => {
      const [a, b, c] = [0, 0.5, 1].map((w) => render(cue, w).firstBody);
      expect(a! > b! && b! > c!).toBe(true);
    });
  }
});

describe('the mixer reads the target', () => {
  async function played(health: number, cue: string, data: SimEvent['data'] = {}, slot = -1) {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create });
    await audio.resume();
    ctx.currentTime = 1;
    const s = snap([rider(0, { slot: 0, contentId: 'player' }), rider(1, { health, slot })]);
    audio.frame(s, 0);
    audio.onEvents([hit(cue, 1, data)], s);
    return audio.inspect().lastCues.filter((c) => c.cue !== 'go');
  }

  it('a punch on a hurt rival carries its weight; on a fresh one it does not', async () => {
    const weak = await played(10, 'hit', { weapon: 'punch' });
    expect(weak.at(-1)?.cue).toBe('punch');
    expect(weak.at(-1)?.weight).toBeCloseTo(0.9, 5);
    const fresh = await played(100, 'hit', { weapon: 'punch' });
    expect(fresh.at(-1)?.weight).toBeUndefined();
  });

  it('kicks and weapon hits carry it too', async () => {
    expect((await played(20, 'hit', { weapon: 'kick' })).at(-1)).toMatchObject({ cue: 'kick', weight: 0.8 });
    expect((await played(20, 'kick')).at(-1)).toMatchObject({ cue: 'kick', weight: 0.8 });
    expect((await played(20, 'hit', { weapon: 'base:lead-pipe' })).at(-1)).toMatchObject({
      cue: 'hit',
      weight: 0.8,
    });
  });

  it('a crash and a hit on the player never carry a weight', async () => {
    expect((await played(10, 'crash', { cause: 'barrier', speed: 30 })).at(-1)?.weight).toBeUndefined();
    expect((await played(10, 'hit', { weapon: 'punch' }, 0)).at(-1)?.weight).toBeUndefined();
  });
});
