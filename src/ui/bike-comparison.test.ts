import { expect, it } from 'vitest';
import { bikeNotes, type BikeNoteRow } from './career-show';

it('owned, for-sale and locked bike rows retain comparisons alongside existing price/lock/repair lines', () => {
  const base: BikeNoteRow = {
    speed: '100 mph',
    priceCash: 1000,
    current: false,
    secret: false,
    reason: 'Beat the boss.',
    state: 'owned',
    handlingNote: 'Compared with Control: quicker launch · softer brakes · same steering.',
  };
  for (const state of ['owned', 'for-sale', 'locked'] as const) {
    const lines = bikeNotes({ ...base, state }, 0, 100);
    expect(lines).toContain(base.handlingNote);
    if (state !== 'owned') expect(lines.join(' ')).toContain('about 10 races to afford');
    if (state === 'locked') expect(lines).toContain(base.reason);
  }
  expect(bikeNotes({ ...base, current: true, repairCash: 100 }, 0, 100).join(' ')).toContain(
    'a crash costs about $100 to fix',
  );
});
