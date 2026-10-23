import { SIDEWALK_FILES } from './sidewalk-group.mjs';

/** Original two busy city events per region, in the original survey order. */
const REGIONS: Record<string, readonly string[]> = {
  keys: ['base:keys-t1-last-light-duval', 'base:keys-t4-hurricane-party'],
  sf: ['region-sf:sf-t1-pier-pressure', 'region-sf:sf-t2-stair-alley'],
  pnw: ['region-pnw:pnw-t1-bridge-city', 'region-pnw:pnw-t1-ferry-line'],
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const BRAKE_SEEDS = [1];
export const SIDEWALK_TICKS = 4500;
// This is the dodge rule, not the furniture rule (tests/sim/furniture-sidewalk.test.ts).
// Furniture was already disabled in the serial survey; all other world systems stay as before.
export const SIDEWALK_TUNING = { 'riders.furniture': 0 } as const;
export interface SidewalkCase {
  region: string;
  eventId: string;
  seed: number;
  mode: 'fast' | 'brake';
}
export const sidewalkKey = (c: SidewalkCase) => JSON.stringify([c.region, c.eventId, c.seed, c.mode]);

/** The exact original fast cohort followed by its distinct braking cohort. */
export function sidewalkManifest() {
  const events = Object.values(REGIONS).flat();
  const cases = (['fast', 'brake'] as const).flatMap((mode) =>
    Object.entries(REGIONS).flatMap(([region, eventIds]) =>
      eventIds.flatMap((eventId) =>
        (mode === 'fast' ? SEEDS : BRAKE_SEEDS).map((seed) => {
          const c: SidewalkCase = { region, eventId, seed, mode };
          return { ...c, key: sidewalkKey(c), file: SIDEWALK_FILES[events.indexOf(eventId)]! };
        }),
      ),
    ),
  );
  if (
    new Set(SIDEWALK_FILES).size !== SIDEWALK_FILES.length ||
    new Set(cases.map((c) => c.key)).size !== cases.length ||
    cases.some((c) => !SIDEWALK_FILES.includes(c.file)) ||
    SIDEWALK_FILES.some((file) => !cases.some((c) => c.file === file))
  )
    throw new Error('Invalid complete sidewalk survey inventory');
  return { files: SIDEWALK_FILES, cases };
}
