import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { furnitureCredits } from './furniture-credit';

const crash = (tick = 10, causeId: number | undefined = 41): SimEvent => ({
  tick,
  type: 'crash',
  actor: 2,
  data: { furniture: 'lamp' },
  ...(causeId === undefined ? {} : { causeId }),
});
const takedown = (tick = 11, causeId: number | undefined = 41, target = 2): SimEvent => ({
  tick,
  type: 'takedown',
  actor: 0,
  target,
  data: { kind: 'scenery' },
  ...(causeId === undefined ? {} : { causeId }),
});

describe('furniture fall credit identity', () => {
  it('a later unrelated kill of the same rider cannot erase an uncredited furniture fall', () => {
    const credits = furnitureCredits();
    credits.crash(crash());
    expect(credits.take(takedown(200, 99))).toBe(false);
  });

  it("a matching cause at a stale tick is not this fall's next-tick credit", () => {
    const credits = furnitureCredits();
    credits.crash(crash());
    expect(credits.take(takedown(12))).toBe(false);
  });

  it('credits only the matching victim and cause on the next tick, once', () => {
    const credits = furnitureCredits();
    credits.crash(crash());
    expect(credits.take(takedown(10))).toBe(false);
    expect(credits.take(takedown(11, 41, 3))).toBe(false);
    expect(credits.take(takedown(11, 99))).toBe(false);
    expect(credits.take(takedown())).toBe(true);
    expect(credits.take(takedown())).toBe(false);
  });

  it('missing cause identity on either event never grants a credit', () => {
    const missingCrash = furnitureCredits();
    const noCrashCause = crash();
    delete noCrashCause.causeId;
    missingCrash.crash(noCrashCause);
    expect(missingCrash.take(takedown())).toBe(false);
    const missingCredit = furnitureCredits();
    missingCredit.crash(crash());
    const noCreditCause = takedown();
    delete noCreditCause.causeId;
    expect(missingCredit.take(noCreditCause)).toBe(false);
    expect(missingCredit.take(takedown())).toBe(true);
  });

  it('a takedown without its victim or without a prior furniture fall cannot credit one', () => {
    const credits = furnitureCredits();
    expect(credits.take(takedown())).toBe(false);
    credits.crash(crash());
    const noVictim = takedown();
    delete noVictim.target;
    expect(credits.take(noVictim)).toBe(false);
    expect(credits.take(takedown())).toBe(true);
  });
});
