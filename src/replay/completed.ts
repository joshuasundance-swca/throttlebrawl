// Preflight for completed, already-expanded internal recordings. This is not a file decoder or
// a proof of deterministic playback: the caller must still compare every checkpoint and end hash.
import { InputFlag, quantizeInput, SIM_TUNING } from '../sim/api';
import { HASH_EVERY_TICKS, REPLAY_FORMAT_VERSION, type Recording } from './index';

type DataObject = Record<string, unknown>;

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`replay: ${message}`);
}

function object(value: unknown, at: string): DataObject {
  requireValid(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${at} must be an object`,
  );
  return value as DataObject;
}

function array(value: unknown, at: string): unknown[] {
  requireValid(Array.isArray(value), `${at} must be an array`);
  for (let i = 0; i < value.length; i++)
    requireValid(Object.hasOwn(value, i), `${at} has a missing entry at ${i}`);
  return value as unknown[];
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const unsigned = (value: unknown): value is number => integer(value, 0, 0xffffffff);

/** Iterative ancestor tracking rejects cycles without imposing a depth/size limit or rejecting
 * shared plain values. Undefined is legitimate in optional producer fields (for example law).
 * Accessors and exotic objects are not internal plain data and cannot be cloned faithfully.
 */
function plainData(raw: unknown): void {
  const active = new Set<object>();
  const stack: { value: unknown; leaving?: boolean }[] = [{ value: raw }];
  while (stack.length) {
    const item = stack.pop()!;
    const value = item.value;
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean')
      continue;
    if (typeof value === 'number') {
      requireValid(Number.isFinite(value), 'recording contains a nonfinite number');
      continue;
    }
    requireValid(typeof value === 'object', 'recording must contain only plain data');
    if (item.leaving) {
      active.delete(value);
      continue;
    }
    requireValid(!active.has(value), 'recording contains a cycle');
    const prototype: unknown = Object.getPrototypeOf(value);
    requireValid(
      Array.isArray(value) || prototype === Object.prototype || prototype === null,
      'recording must contain only plain objects',
    );
    active.add(value);
    stack.push({ value, leaving: true });
    for (const key of Reflect.ownKeys(value)) {
      requireValid(typeof key === 'string', 'recording contains a symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      requireValid('value' in descriptor, 'recording contains an accessor');
      stack.push({ value: descriptor.value as unknown });
    }
  }
}

function numericMap(value: unknown, at: string): DataObject {
  const map = object(value, at);
  for (const [key, entry] of Object.entries(map))
    requireValid(text(key) && finite(entry), `${at} must contain named finite numbers`);
  return map;
}

function identity(value: unknown, at: string): DataObject {
  const entry = object(value, at);
  requireValid(text(entry['contentId']), `${at} is missing its content identity`);
  return entry;
}

function validateConfig(header: DataObject): { slots: number; tuning: DataObject } {
  const config = object(header['config'], 'header config');
  requireValid(
    unsigned(header['seed']) && config['seed'] === header['seed'],
    'header/config seed must agree and be unsigned',
  );
  const slots = header['playerSlots'];
  requireValid(
    integer(slots, 1, Number.MAX_SAFE_INTEGER) && config['playerSlots'] === slots,
    'header/config player slots must agree',
  );
  const event = identity(config['event'], 'config event');
  requireValid(
    text(header['eventId']) && event['contentId'] === header['eventId'],
    'header/config event identity must agree',
  );
  requireValid(
    ['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'].includes(String(event['kind'])),
    'config event kind is missing or invalid',
  );
  requireValid(
    finite(event['paceMps']) && integer(event['raceEndTimeoutTicks'], 0, Number.MAX_SAFE_INTEGER),
    'config event pace/timeout is missing or invalid',
  );
  requireValid(
    array(event['byPlaceCash'], 'config event prizes').every(finite),
    'config event prizes must be finite numbers',
  );
  for (const id of ['routeId', 'lengthId']) {
    if (event[id] !== undefined) requireValid(text(event[id]), `config event ${id} is missing its identity`);
  }

  const tuning = numericMap(config['tuning'], 'config tuning');
  const initial = numericMap(header['tuning'], 'header tuning');
  const tuningIds = Object.keys(tuning);
  requireValid(
    tuningIds.length === Object.keys(initial).length &&
      tuningIds.every((id) => Object.hasOwn(initial, id) && initial[id] === tuning[id]),
    'header/config initial tuning must agree',
  );

  // Check the sim's required containers and entity identities, not a second copy of the content
  // pack schemas. Optional nested content remains historical plain finite data.
  const riders = array(config['riders'], 'config riders');
  const playerSlots = new Set<number>();
  for (const raw of riders) {
    const rider = identity(raw, 'config rider');
    const bike = identity(rider['bike'], 'config rider bike');
    requireValid(
      text(rider['name']) &&
        ['player', 'rival', 'cop', 'extra'].includes(String(rider['role'])) &&
        ['rider', 'law'].includes(String(rider['faction'])),
      'config rider identity is incomplete',
    );
    for (const key of ['massKg', 'healthMax'])
      requireValid(finite(rider[key]), `config rider ${key} is missing or invalid`);
    for (const key of ['topSpeedMps', 'accelMps2', 'brakeMps2', 'steerRateMps', 'massKg'])
      requireValid(finite(bike[key]), `config bike ${key} is missing or invalid`);
    const controller = object(rider['controller'], 'config rider controller');
    if (controller['kind'] === 'player') {
      const slot = controller['slot'];
      requireValid(
        integer(slot, 0, slots - 1) && !playerSlots.has(slot),
        'config player slot is missing, duplicated or out of range',
      );
      playerSlots.add(slot);
    } else {
      requireValid(
        controller['kind'] === 'cop' || (controller['kind'] === 'ai' && text(controller['style'])),
        'config rider controller is invalid',
      );
    }
  }
  requireValid(playerSlots.size === slots, 'config must provide every declared player slot');
  for (const key of ['weapons', 'trafficTypes', 'modifiers']) {
    for (const entry of array(config[key], `config ${key}`)) identity(entry, `config ${key} entry`);
  }
  for (const [id, points] of Object.entries(object(config['grudges'], 'config grudges'))) {
    requireValid(text(id), 'config grudge identity is missing');
    numericMap(points, 'config grudge points');
  }
  const difficulty = object(config['difficulty'], 'config difficulty');
  requireValid(text(difficulty['presetId']), 'config difficulty identity is missing');
  for (const key of ['riderAggression', 'copFrequency', 'rubberBand'])
    requireValid(finite(difficulty[key]), `config difficulty ${key} is missing or invalid`);
  requireValid(
    ['off', 'light', 'strong'].includes(String(config['assists'])) && typeof config['slowMo'] === 'boolean',
    'config assists/slow motion is missing or invalid',
  );
  if (config['speedMultiplier'] !== undefined)
    requireValid(
      finite(config['speedMultiplier']) && config['speedMultiplier'] > 0 && config['speedMultiplier'] <= 1,
      'config speed multiplier is invalid',
    );
  if (config['slots'] !== undefined) {
    for (const slot of array(config['slots'], 'config slots')) {
      const assists = object(object(slot, 'config slot')['assists'], 'config slot assists');
      requireValid(
        ['off', 'light', 'strong'].includes(String(assists['steer'])) &&
          typeof assists['autoThrottle'] === 'boolean',
        'config slot assists are invalid',
      );
      requireValid(
        assists['steerStyle'] === undefined ||
          assists['steerStyle'] === 'arcade' ||
          assists['steerStyle'] === 'free',
        'config slot steering style is invalid',
      );
    }
  }
  if (config['smashables'] !== undefined)
    for (const entry of array(config['smashables'], 'config smashables')) identity(entry, 'config smashable');
  return { slots, tuning };
}

/** Accept only a complete current-key internal recording, then isolate it from later mutation.
 * Compatibility is checked before config reconstruction; successful validation alone says
 * nothing about whether the stored hashes match a real replay.
 */
export function validateCompletedRecording(raw: unknown, expectedReplayKey: string): Recording {
  requireValid(text(expectedReplayKey), 'expected replay key is empty');
  const rec = object(raw, 'recording');
  const header = object(rec['header'], 'header');
  requireValid(header['replayKey'] === expectedReplayKey, 'recording replay key does not match this race');
  requireValid(
    header['formatVersion'] === REPLAY_FORMAT_VERSION,
    'recording format is not supported by this build',
  );
  requireValid(
    header['hashEveryTicks'] === HASH_EVERY_TICKS,
    'recording checkpoint interval is not supported',
  );
  plainData(raw);
  if (header['raceOptions'] !== undefined) {
    for (const [key, value] of Object.entries(object(header['raceOptions'], 'race options'))) {
      requireValid(
        text(key) &&
          (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)),
        'race options must contain named primitive values',
      );
    }
  }
  const { slots, tuning } = validateConfig(header);
  const inputs = array(rec['inputs'], 'inputs');
  requireValid(inputs.length > 0, 'completed recording has no inputs');
  const low = quantizeInput({ steer: -1, throttle: 0, brake: 0, flags: 0 });
  const high = quantizeInput({ steer: 1, throttle: 1, brake: 1, flags: 0 });
  const flagMask = Object.values(InputFlag).reduce((mask, bit) => mask | bit, 0);
  for (const [tick, rawInputs] of inputs.entries()) {
    const commands = array(rawInputs, `inputs tick ${tick}`);
    requireValid(commands.length === slots, `inputs tick ${tick} does not carry every declared slot`);
    for (const command of commands) {
      const input = object(command, `inputs tick ${tick} slot`);
      requireValid(
        integer(input['steer'], low.steer, high.steer) &&
          integer(input['throttle'], low.throttle, high.throttle) &&
          integer(input['brake'], low.brake, high.brake),
        `inputs tick ${tick} has invalid quantized levels`,
      );
      requireValid(
        integer(input['flags'], 0, 0xffff) && (input['flags'] & ~flagMask) === 0,
        `inputs tick ${tick} has undeclared flags`,
      );
    }
  }
  const lastTick = inputs.length - 1;
  const knownParams = new Set(SIM_TUNING.filter((decl) => decl.affectsSim).map((decl) => decl.id));
  let previousTick = -1;
  for (const rawParam of array(rec['params'], 'params')) {
    const param = object(rawParam, 'param');
    const tick = param['tick'],
      id = param['id'];
    requireValid(
      integer(tick, 0, lastTick) && tick >= previousTick,
      'param ticks must be ordered and within the inputs',
    );
    requireValid(
      text(id) && Object.hasOwn(tuning, id) && knownParams.has(id) && finite(param['value']),
      'param must name existing sim tuning and a finite value',
    );
    previousTick = tick;
  }
  const hashes = array(rec['hashes'], 'checkpoints');
  requireValid(
    hashes.length === Math.floor(lastTick / HASH_EVERY_TICKS) + 1,
    'completed recording is missing or has extra checkpoints',
  );
  for (const [index, rawHash] of hashes.entries()) {
    const checkpoint = object(rawHash, 'checkpoint');
    requireValid(
      checkpoint['tick'] === index * HASH_EVERY_TICKS && unsigned(checkpoint['hash']),
      'checkpoint schedule or unsigned hash is invalid',
    );
  }
  const end = object(rec['end'], 'completed terminal');
  requireValid(
    end['tick'] === lastTick && unsigned(end['hash']),
    'completed terminal must match the final input tick and carry an unsigned hash',
  );
  if (lastTick % HASH_EVERY_TICKS === 0) {
    requireValid(
      object(hashes[hashes.length - 1], 'last checkpoint')['hash'] === end['hash'],
      'terminal hash disagrees with its checkpoint',
    );
  }
  return structuredClone(raw) as Recording;
}
