// No region's cop waits in a travel lane (see tests/sim/cops-parking.ts for the check and why). This
// file holds the coverage check and every race outside the dedicated PNW and SF files, including
// new regions. The other files keep their existing region allocations.
import { describe, expect, it } from 'vitest';
import { checkParking, PARKING_TEST, RACES, racesIn, REG } from './cops-parking';

const dedicated = [...racesIn('pacific-northwest'), ...racesIn('san-francisco')];
const dedicatedRaces = new Set(dedicated);
const defaultRaces = RACES.filter((race) => !dedicatedRaces.has(race));
const raceKey = (race: (typeof RACES)[number]) => JSON.stringify(race);

describe('cops: no region parks its cop in a travel lane', () => {
  it('covers every authored race exactly once across the three files', () => {
    const regions = new Set(Object.values(REG.events).map((e) => e.region));
    console.log(
      `[examined] ${RACES.length} races in ${regions.size} regions: ${RACES.map((r) => r.filter(Boolean).join(' ')).join('; ')}`,
    );
    const scheduled = [...defaultRaces, ...dedicated].map(raceKey);
    expect(new Set(scheduled).size).toBe(scheduled.length);
    expect(scheduled.sort()).toEqual(RACES.map(raceKey).sort());
  });

  it.each(defaultRaces)(PARKING_TEST, (eventId, length, route) => checkParking(eventId, length, route));
});
