// No region's cop waits in a travel lane (see tests/sim/cops-parking.ts for the check and why). This
// file holds the coverage check and the Florida Keys' races; cops-parking-pnw.test.ts and
// cops-parking-sf.test.ts hold the other two regions'.
import { describe, expect, it } from 'vitest';
import { checkParking, PARKING_REGIONS, PARKING_TEST, RACES, racesIn, REG } from './cops-parking';

describe('cops: no region parks its cop in a travel lane', () => {
  it('covers every region', () => {
    const regions = new Set(Object.values(REG.events).map((e) => e.region));
    console.log(
      `[examined] ${RACES.length} races in ${regions.size} regions: ${RACES.map((r) => r.filter(Boolean).join(' ')).join('; ')}`,
    );
    expect([...regions].sort()).toEqual([...PARKING_REGIONS]);
  });

  it.each(racesIn('florida-keys'))(PARKING_TEST, (eventId, length, route) =>
    checkParking(eventId, length, route),
  );
});
