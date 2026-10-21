import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { firstFallAccounting } from './furniture-falls';

const fall = (tick = 10, causeId = 41): SimEvent => ({
  tick,
  type: 'crash',
  actor: 2,
  causeId,
  data: { cause: 'traffic' },
});
const credit = (tick = 11, causeId = 41): SimEvent => ({
  tick,
  type: 'takedown',
  actor: 0,
  target: 2,
  causeId,
  data: { kind: 'traffic' },
});

describe('furniture comparison counts uncredited first falls', () => {
  it('retains an uncredited riding fall despite a later credited fall of the same rider', () => {
    const account = firstFallAccounting();
    account.crash(fall(), 'Road', 'Tumble');
    account.crash(fall(100, 99), 'Airborne', 'Tumble');
    account.credit(credit(101, 99));
    expect(account.totals()).toEqual({ firstFalls: 2, creditedFirstFalls: 1, uncreditedFirstFalls: 1 });
  });

  it('a credited already-down contact cannot erase an earlier uncredited fall', () => {
    const account = firstFallAccounting();
    account.crash(fall(), 'Road', 'Tumble');
    account.crash({ ...fall(100, 99), data: { contact: 'tumble' } }, 'Tumble', 'Tumble');
    account.credit(credit(101, 99));
    expect(account.totals()).toEqual({ firstFalls: 1, creditedFirstFalls: 0, uncreditedFirstFalls: 1 });
  });

  it('one transition cannot become two falls through multiple same-tick contacts', () => {
    const account = firstFallAccounting();
    account.crash(fall(), 'Road', 'Tumble');
    account.crash(fall(10, 99), 'Road', 'Tumble');
    account.credit(credit(11, 99));
    expect(account.totals()).toEqual({ firstFalls: 1, creditedFirstFalls: 0, uncreditedFirstFalls: 1 });
    account.credit(credit());
    account.credit(credit());
    expect(account.totals()).toEqual({ firstFalls: 1, creditedFirstFalls: 1, uncreditedFirstFalls: 0 });
  });

  it('missing cause identity leaves a real fall uncredited', () => {
    const account = firstFallAccounting();
    const missing = fall();
    delete missing.causeId;
    account.crash(missing, 'Road', 'Tumble');
    account.credit(credit());
    expect(account.totals()).toEqual({ firstFalls: 1, creditedFirstFalls: 0, uncreditedFirstFalls: 1 });
  });

  it('non-crashes and detached states cannot manufacture a riding fall', () => {
    const account = firstFallAccounting();
    account.crash({ ...fall(), type: 'wobble' }, 'Road', 'Road');
    account.crash(fall(), 'OnFoot', 'Tumble');
    account.credit(credit());
    expect(account.totals()).toEqual({ firstFalls: 0, creditedFirstFalls: 0, uncreditedFirstFalls: 0 });
  });

  it('a missing snapshot cannot silently erase a known rival crash from acceptance', () => {
    const account = firstFallAccounting();
    expect(() => account.crash(fall(), undefined, 'Tumble')).toThrow('missing snapshot mode');
    expect(() => account.crash(fall(), 'Road', undefined)).toThrow('missing snapshot mode');
  });
});
