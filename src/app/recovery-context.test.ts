import { describe, expect, it } from 'vitest';
import { loadBasePack } from '../content';
import { replayHeader } from '../replay';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, PROFILE_VERSION } from '../save';
import * as flow from './career-flow';
import { createHeadlessRace } from './headless';
import { quickRecoveryKey, recoveryCareer } from './recovery-context';

function fixture() {
  const reg = loadBasePack();
  const defs = flow.careerDefs(reg);
  const def = defs[0]!;
  const node = def.nodes[0]!;
  const starting = flow.startCareer(defs, structuredClone(DEFAULT_PROFILE));
  const setup = flow.careerRaceSetup(reg, defs, starting, def, node);
  const { config } = createHeadlessRace(
    {
      seed: 77,
      eventId: node.event,
      playerBike: starting.bikes.current!,
      freePlay: false,
      ...(setup.length ? { length: setup.length.id } : {}),
      ...(setup.patch ? { eventPatch: setup.patch } : {}),
      ...(setup.fieldLevel ? { fieldLevel: setup.fieldLevel } : {}),
    },
    { registry: reg },
  );
  const header = replayHeader(config, 'code+content');
  const context = {
    kind: 'career' as const,
    eventId: node.event,
    careerKey: def.key,
    nodeId: node.id,
    regionId: def.regionId,
    length: setup.length?.id ?? null,
    profileGuard: JSON.stringify({
      format: 'profile',
      version: PROFILE_VERSION,
      build: 'fixture',
      savedAt: '2026-10-12T12:00:00.000Z',
      data: starting,
    }),
  };
  return { reg, defs, def, node, starting, header, context };
}

describe('career recovery data identity', () => {
  it('binds Quick Play identity to its route and full settings as well as event rules', () => {
    const f = fixture();
    const context = {
      kind: 'quick' as const,
      eventId: f.node.event,
      route: null,
      settings: structuredClone(DEFAULT_SETTINGS),
    };
    const key = quickRecoveryKey(flow, f.reg, context);
    expect(quickRecoveryKey(flow, f.reg, structuredClone(context))).toBe(key);
    expect(quickRecoveryKey(flow, f.reg, { ...context, route: 'base:other-route' })).not.toBe(key);
    expect(
      quickRecoveryKey(flow, f.reg, {
        ...context,
        settings: { ...context.settings, difficulty: 'hard' },
      }),
    ).not.toBe(key);
  });
  it('resolves the original qualified career despite an ambiguous bare region', () => {
    const f = fixture();
    const duplicate = { ...f.def, key: 'other:career', name: 'Other chapter' };
    const recovered = recoveryCareer(flow, f.reg, [duplicate, ...f.defs], f.context, f.header);
    expect(recovered.def.key).toBe(f.def.key);
    expect(recovered.node.event).toBe(f.header.eventId);
    expect(recovered.starting).toEqual(f.starting);
    expect(recovered.bike).toBe(
      f.header.config!.riders.find((r) => r.controller.kind === 'player')!.bike.contentId,
    );
    const original = recoveryCareer(flow, f.reg, f.defs, f.context, f.header);
    // globalTier counts preceding definitions; the extra chapter legitimately changes the
    // field's fine scale even though the qualified node still resolves to the original.
    expect(recovered.setup.fieldLevel?.fineScale).not.toBe(original.setup.fieldLevel?.fineScale);
    expect(recovered.key === original.key).toBe(false);
  });

  it('refuses a changed node/event association and unsupported starting profile', () => {
    const f = fixture();
    expect(() =>
      recoveryCareer(flow, f.reg, f.defs, { ...f.context, eventId: 'base:other-event' }, f.header),
    ).toThrow();
    expect(() =>
      recoveryCareer(flow, f.reg, f.defs, { ...f.context, nodeId: 'missing' }, f.header),
    ).toThrow();
    expect(() =>
      recoveryCareer(flow, f.reg, f.defs, { ...f.context, profileGuard: '{bad' }, f.header),
    ).toThrow();
  });

  it('binds repair pricing to the recorded bike, not a subsequently chosen profile bike', () => {
    const f = fixture();
    const before = recoveryCareer(flow, f.reg, f.defs, f.context, f.header);
    const priced = { ...f.def, shop: [{ bike: before.bike, priceCash: 1234, unlockTier: 0 }, ...f.def.shop] };
    const after = recoveryCareer(flow, f.reg, [priced, ...f.defs.slice(1)], f.context, f.header);
    expect(after.bike).toBe(before.bike);
    expect(after.key).not.toBe(before.key);
    const otherBike = Object.keys(f.reg.bikes).find((id) => id !== before.bike)!;
    const switched = {
      ...f.starting,
      bikes: { ...f.starting.bikes, owned: [...f.starting.bikes.owned, otherBike], current: otherBike },
    };
    const context = {
      ...f.context,
      profileGuard: JSON.stringify({ format: 'profile', version: PROFILE_VERSION, data: switched }),
    };
    expect(recoveryCareer(flow, f.reg, f.defs, context, f.header).key === before.key).toBe(true);
  });

  it('changes identity for grant availability while ignoring unrelated presentation metadata', () => {
    const f = fixture();
    const grant = 'base:unit-grant';
    const withGrant = {
      ...f.def,
      unlocks: [...f.def.unlocks, { grant, kind: 'event-won' as const, ref: f.node.event }],
    };
    const defs = [withGrant, ...f.defs.slice(1)];
    const before = recoveryCareer(flow, f.reg, defs, f.context, f.header).key;
    const cosmetic = { ...f.reg, packs: f.reg.packs.map((p) => ({ ...p, name: 'Other presentation' })) };
    expect(recoveryCareer(flow, cosmetic, defs, f.context, f.header).key).toBe(before);
    const available = { ...f.reg, bikes: { ...f.reg.bikes, [grant]: Object.values(f.reg.bikes)[0]! } };
    expect(recoveryCareer(flow, available, defs, f.context, f.header).key).not.toBe(before);
  });
});
