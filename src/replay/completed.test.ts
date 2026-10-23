import { describe, expect, it } from 'vitest';
import { InputFlag, quantizeInput, type SimConfig } from '../sim/api';
import {
  createInputRecorder,
  HASH_EVERY_TICKS,
  replayHeader,
  type Recording,
  type ReplayConfig,
} from './index';
import { validateCompletedRecording } from './completed';

const KEY = 'current-code+event-content';

// A complete sim-contract config, passed through the actual header/recorder producers. Road
// handles are unused here: this preflight must never create or step a simulation.
function config(): SimConfig {
  const plain: ReplayConfig = {
    seed: 77,
    event: {
      contentId: 'test:race',
      kind: 'classic-race',
      paceMps: 28,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
      routeId: 'test:route',
      lengthId: 'standard',
    },
    riders: [
      {
        contentId: 'test:rider',
        name: 'Rider',
        role: 'player',
        faction: 'rider',
        controller: { kind: 'player', slot: 0 },
        massKg: 80,
        healthMax: 100,
        bike: {
          contentId: 'test:bike',
          topSpeedMps: 40,
          accelMps2: 8,
          brakeMps2: 10,
          steerRateMps: 5,
          massKg: 200,
        },
        law: undefined,
      },
    ],
    weapons: [],
    trafficTypes: [],
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1.4 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: true,
    playerSlots: 1,
    slots: [{ assists: { steer: 'light', autoThrottle: false, steerStyle: 'free' } }],
    speedMultiplier: 0.8,
  };
  return {
    ...plain,
    road: null as unknown as SimConfig['road'],
    route: null as unknown as SimConfig['route'],
  };
}

function fixture(ticks = 2 * HASH_EVERY_TICKS + 1, slots = 1): Recording {
  const cfg = config();
  if (slots > 1) {
    cfg.playerSlots = slots;
    cfg.riders = Array.from({ length: slots }, (_, slot) => ({
      ...cfg.riders[0]!,
      controller: { kind: 'player' as const, slot },
    }));
  }
  const rec = createInputRecorder();
  rec.begin(replayHeader(cfg, KEY, { weather: 'dry', rivals: 0, cops: false, timeOfDay: null }));
  for (let tick = 0; tick < ticks; tick++) {
    rec.record(
      tick,
      Array.from({ length: slots }, () =>
        quantizeInput({
          steer: tick % 2 ? -1 : 1,
          throttle: 1,
          brake: 0,
          flags: Object.values(InputFlag).reduce((mask, bit) => mask | bit, 0),
        }),
      ),
    );
    if (tick % HASH_EVERY_TICKS === 0) rec.checkpoint(tick, tick >>> 0);
  }
  rec.finish(ticks - 1, (ticks - 1) >>> 0);
  return rec.current()!;
}

const historicalConfig = (r: Recording) => r.header.config!;

describe('completed in-memory recording preflight', () => {
  it('accepts producer output at one tick and either side of a checkpoint boundary', () => {
    for (const ticks of [1, HASH_EVERY_TICKS, HASH_EVERY_TICKS + 1, HASH_EVERY_TICKS + 2]) {
      const rec = fixture(ticks);
      expect(validateCompletedRecording(rec, KEY)).toEqual(rec);
    }
  });

  it('accepts valid slot cardinality and ordered repeated same-tick tuning changes', () => {
    const rec = fixture(undefined, 2);
    const producer = createInputRecorder();
    producer.resume(rec);
    producer.recordParam(0, 'riders.steerScale', -10);
    producer.recordParam(0, 'riders.steerScale', 900);
    producer.recordParam(rec.inputs.length - 1, 'riders.steerScale', 2);
    producer.finish(rec.end!.tick, rec.end!.hash);
    const complete = producer.current()!;
    expect(validateCompletedRecording(complete, KEY)).toEqual(complete);
  });

  it('returns a fully independent copy and preserves legitimate optional undefined fields', () => {
    const rec = fixture();
    const safe = validateCompletedRecording(rec, KEY);
    expect(safe).toEqual(rec);
    expect(safe).not.toBe(rec);
    expect(Object.hasOwn(historicalConfig(safe).riders[0]!, 'law')).toBe(true);
    rec.inputs[0]![0]!.steer = 0;
    historicalConfig(rec).tuning = { 'riders.steerScale': 99 };
    safe.params.push({ tick: 0, id: 'riders.steerScale', value: 3 });
    expect(safe.inputs[0]![0]!.steer).toBe(127);
    expect(historicalConfig(safe).tuning['riders.steerScale']).toBe(1.4);
    expect(rec.params).toEqual([]);
  });

  it('accepts shared plain data and nested historical fields without an arbitrary depth ceiling', () => {
    const rec = fixture();
    const shared = { label: 'historical extension' };
    let nested: object = shared;
    for (let depth = 0; depth < 64; depth++) nested = { nested };
    Reflect.set(historicalConfig(rec), 'extension', { first: shared, second: shared, nested });
    expect(validateCompletedRecording(rec, KEY)).toEqual(rec);
  });

  it('requires a nonempty matching current key before inspecting the recording body', () => {
    const raw = { header: { replayKey: 'old' }, inputs: null };
    expect(() => validateCompletedRecording(raw, KEY)).toThrow(/key/i);
    expect(() => validateCompletedRecording(fixture(), '')).toThrow(/key/i);
  });

  it('requires optional recorded race picks to retain their public primitive value contract', () => {
    const rec = fixture();
    Reflect.set(rec.header, 'raceOptions', { weather: { name: 'dry' } });
    expect(() => validateCompletedRecording(rec, KEY)).toThrow(/race options/i);
  });

  it.each([
    ['absent record', () => null],
    ['encoded file', () => ({ ...fixture(), inputs: { ticks: 1, slots: [[1, 0, 255, 0, 0]] } })],
    [
      'empty inputs',
      (r: Recording) => {
        r.inputs = [];
        return r;
      },
    ],
    [
      'missing terminal',
      (r: Recording) => {
        delete r.end;
        return r;
      },
    ],
    [
      'early terminal',
      (r: Recording) => {
        r.end!.tick--;
        return r;
      },
    ],
    [
      'terminal after exhaustion',
      (r: Recording) => {
        r.end!.tick++;
        return r;
      },
    ],
    [
      'negative terminal hash',
      (r: Recording) => {
        r.end!.hash = -1;
        return r;
      },
    ],
    [
      'wide terminal hash',
      (r: Recording) => {
        r.end!.hash = 0x100000000;
        return r;
      },
    ],
    [
      'fractional terminal hash',
      (r: Recording) => {
        r.end!.hash = 0.5;
        return r;
      },
    ],
    [
      'terminal/checkpoint disagreement',
      (r: Recording) => {
        r.end!.hash++;
        return r;
      },
    ],
    [
      'old format',
      (r: Recording) => {
        r.header.formatVersion = 0;
        return r;
      },
    ],
    [
      'future format',
      (r: Recording) => {
        r.header.formatVersion++;
        return r;
      },
    ],
    [
      'wrong checkpoint interval',
      (r: Recording) => {
        r.header.hashEveryTicks!++;
        return r;
      },
    ],
    [
      'missing config',
      (r: Recording) => {
        delete r.header.config;
        return r;
      },
    ],
    [
      'seed disagreement',
      (r: Recording) => {
        historicalConfig(r).seed++;
        return r;
      },
    ],
    [
      'non-uint seed',
      (r: Recording) => {
        r.header.seed = historicalConfig(r).seed = -1;
        return r;
      },
    ],
    [
      'event disagreement',
      (r: Recording) => {
        historicalConfig(r).event.contentId += '-other';
        return r;
      },
    ],
    [
      'empty event identity',
      (r: Recording) => {
        r.header.eventId = historicalConfig(r).event.contentId = '';
        return r;
      },
    ],
    [
      'missing required config field',
      (r: Recording) => {
        Reflect.deleteProperty(historicalConfig(r), 'difficulty');
        return r;
      },
    ],
    [
      'wrong config container',
      (r: Recording) => {
        Reflect.set(historicalConfig(r), 'riders', {});
        return r;
      },
    ],
    [
      'missing rider identity',
      (r: Recording) => {
        Reflect.deleteProperty(historicalConfig(r).riders[0]!, 'contentId');
        return r;
      },
    ],
    [
      'missing bike identity',
      (r: Recording) => {
        Reflect.deleteProperty(historicalConfig(r).riders[0]!.bike, 'contentId');
        return r;
      },
    ],
    [
      'initial tuning disagreement',
      (r: Recording) => {
        historicalConfig(r).tuning = { 'riders.steerScale': 3 };
        return r;
      },
    ],
    [
      'missing tuning key',
      (r: Recording) => {
        r.header.tuning = {};
        return r;
      },
    ],
    [
      'nonfinite config',
      (r: Recording) => {
        historicalConfig(r).event.paceMps = Infinity;
        return r;
      },
    ],
    [
      'function in config',
      (r: Recording) => {
        Reflect.set(historicalConfig(r), 'extra', () => 1);
        return r;
      },
    ],
    [
      'cycle in config',
      (r: Recording) => {
        Reflect.set(historicalConfig(r), 'extra', historicalConfig(r));
        return r;
      },
    ],
    [
      'class in config',
      (r: Recording) => {
        Reflect.set(historicalConfig(r), 'extra', new Map());
        return r;
      },
    ],
    [
      'missing slot declaration',
      (r: Recording) => {
        delete r.header.playerSlots;
        return r;
      },
    ],
    [
      'slot disagreement',
      (r: Recording) => {
        historicalConfig(r).playerSlots++;
        return r;
      },
    ],
    [
      'zero slots',
      (r: Recording) => {
        r.header.playerSlots = historicalConfig(r).playerSlots = 0;
        return r;
      },
    ],
    [
      'missing player controller',
      (r: Recording) => {
        historicalConfig(r).riders[0]!.controller = { kind: 'cop' };
        return r;
      },
    ],
    [
      'out of range player slot',
      (r: Recording) => {
        historicalConfig(r).riders[0]!.controller = { kind: 'player', slot: 1 };
        return r;
      },
    ],
    [
      'sparse tick',
      (r: Recording) => {
        Reflect.deleteProperty(r.inputs, 1);
        return r;
      },
    ],
    [
      'sparse slot',
      (r: Recording) => {
        Reflect.deleteProperty(r.inputs[0]!, 0);
        return r;
      },
    ],
    [
      'extra slot',
      (r: Recording) => {
        r.inputs[0]!.push({ ...r.inputs[0]![0]! });
        return r;
      },
    ],
    [
      'fractional steer',
      (r: Recording) => {
        r.inputs[0]![0]!.steer = 0.5;
        return r;
      },
    ],
    [
      'low steer',
      (r: Recording) => {
        r.inputs[0]![0]!.steer = -128;
        return r;
      },
    ],
    [
      'high steer',
      (r: Recording) => {
        r.inputs[0]![0]!.steer = 128;
        return r;
      },
    ],
    [
      'high throttle',
      (r: Recording) => {
        r.inputs[0]![0]!.throttle = 256;
        return r;
      },
    ],
    [
      'negative brake',
      (r: Recording) => {
        r.inputs[0]![0]!.brake = -1;
        return r;
      },
    ],
    [
      'nonfinite input',
      (r: Recording) => {
        r.inputs[0]![0]!.brake = NaN;
        return r;
      },
    ],
    [
      'undeclared flag',
      (r: Recording) => {
        r.inputs[0]![0]!.flags = 0x8000;
        return r;
      },
    ],
    [
      'wrapped flags',
      (r: Recording) => {
        r.inputs[0]![0]!.flags += 0x100000000;
        return r;
      },
    ],
    [
      'missing params',
      (r: Recording) => {
        Reflect.deleteProperty(r, 'params');
        return r;
      },
    ],
    [
      'negative param tick',
      (r: Recording) => {
        r.params = [{ tick: -1, id: 'riders.steerScale', value: 1 }];
        return r;
      },
    ],
    [
      'param at exhaustion',
      (r: Recording) => {
        r.params = [{ tick: r.inputs.length, id: 'riders.steerScale', value: 1 }];
        return r;
      },
    ],
    [
      'unknown param',
      (r: Recording) => {
        r.params = [{ tick: 0, id: 'unknown', value: 1 }];
        return r;
      },
    ],
    [
      'nonfinite param',
      (r: Recording) => {
        r.params = [{ tick: 0, id: 'riders.steerScale', value: Infinity }];
        return r;
      },
    ],
    [
      'unordered params',
      (r: Recording) => {
        r.params = [
          { tick: 1, id: 'riders.steerScale', value: 1 },
          { tick: 0, id: 'riders.steerScale', value: 2 },
        ];
        return r;
      },
    ],
    [
      'sparse params',
      (r: Recording) => {
        r.params.length = 1;
        return r;
      },
    ],
    [
      'absent hashes',
      (r: Recording) => {
        Reflect.deleteProperty(r, 'hashes');
        return r;
      },
    ],
    [
      'duplicate checkpoint',
      (r: Recording) => {
        r.hashes.splice(1, 0, { ...r.hashes[0]! });
        return r;
      },
    ],
    [
      'unordered checkpoints',
      (r: Recording) => {
        r.hashes.reverse();
        return r;
      },
    ],
    [
      'extra checkpoint',
      (r: Recording) => {
        r.hashes.push({ tick: r.inputs.length, hash: 0 });
        return r;
      },
    ],
    [
      'wrong checkpoint tick',
      (r: Recording) => {
        r.hashes[1]!.tick++;
        return r;
      },
    ],
    [
      'invalid checkpoint hash',
      (r: Recording) => {
        r.hashes[0]!.hash = NaN;
        return r;
      },
    ],
  ])('refuses %s', (_name, mutate) => {
    expect(() => validateCompletedRecording(mutate(fixture()), KEY)).toThrow(/replay/i);
  });

  it.each(['first', 'middle', 'last'])('requires the %s producer checkpoint', (position) => {
    const rec = fixture();
    const index = position === 'first' ? 0 : position === 'last' ? rec.hashes.length - 1 : 1;
    rec.hashes.splice(index, 1);
    expect(() => validateCompletedRecording(rec, KEY)).toThrow(/checkpoint/i);
  });

  it('refuses duplicate player slot assignment while accepting dense multi-slot records', () => {
    const rec = fixture(undefined, 2);
    expect(validateCompletedRecording(rec, KEY)).toEqual(rec);
    historicalConfig(rec).riders[1]!.controller = { kind: 'player', slot: 0 };
    expect(() => validateCompletedRecording(rec, KEY)).toThrow(/slot/i);
  });
});
