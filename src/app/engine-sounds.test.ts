// Playtest 2 (2026-10-02), "a voice per bike": a rider drawn on a bike class sounds like that class,
// from the base pack's `defaults.engineSoundByClass` (pack data since run W-S, not audio's code).
import { describe, expect, it } from 'vitest';
import { loadBasePack, type ContentRegistry } from '../content';
import { engineSoundsFor } from './engine-sounds';

const reg = loadBasePack();
const byClass = reg.packs.find((p) => p.id === 'base')?.defaults.engineSoundByClass ?? {};
const starter = Object.keys(reg.bikes)[0] ?? '';
const ride = (contentId: string, bike = starter) => ({ contentId, bike: { contentId: bike } });
const classOf = (id: string) =>
  (reg.riders[id] as { look?: { bikeClass?: string } } | undefined)?.look?.bikeClass;

describe('engine sounds by rider', () => {
  it('a rider drawn on a class gets that class`s patch from the base pack, not the bike`s own', () => {
    const drawn = Object.keys(reg.riders).filter((id) => classOf(id));
    expect(drawn.length).toBeGreaterThan(0);
    const out = engineSoundsFor(
      reg,
      drawn.map((id) => ride(id)),
    );
    for (const id of drawn) expect(out[id], id).toBe(byClass[classOf(id) as keyof typeof byClass]);
    // A chopper rider on the starter bike sounds like a chopper.
    const chopper = drawn.find((id) => classOf(id) === 'chopper');
    expect(chopper).toBeDefined();
    expect(out[chopper!]?.preset).toBe('v-twin');
  });

  it('no drawn class, or a class the table lacks, keeps the bike`s own patch; an unknown bike gets none', () => {
    const plain = Object.keys(reg.riders).find((id) => !classOf(id));
    expect(plain).toBeDefined();
    const bike = reg.bikes[starter];
    expect(engineSoundsFor(reg, [ride(plain!)])[plain!]).toBe(bike?.engineSound);
    const chopper = Object.keys(reg.riders).find((id) => classOf(id) === 'chopper')!;
    const noTable = {
      ...reg,
      packs: reg.packs.map((p) => ({ ...p, defaults: { ...p.defaults, engineSoundByClass: {} } })),
    } as ContentRegistry;
    expect(engineSoundsFor(noTable, [ride(chopper)])[chopper]).toBe(bike?.engineSound);
    expect(engineSoundsFor(reg, [ride(chopper, 'no-such-bike')])).toEqual({});
  });
});
