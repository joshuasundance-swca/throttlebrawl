// No region's cop waits in a travel lane: San Francisco's races (tests/sim/cops-parking.ts has the check
// and why; tests/sim/cops-parking.test.ts covers every region and runs the Florida Keys').
import { describe, it } from 'vitest';
import { checkParking, PARKING_TEST, racesIn } from './cops-parking';

describe('cops: no region parks its cop in a travel lane', () => {
  it.each(racesIn('san-francisco'))(PARKING_TEST, (eventId, length, route) =>
    checkParking(eventId, length, route),
  );
});
