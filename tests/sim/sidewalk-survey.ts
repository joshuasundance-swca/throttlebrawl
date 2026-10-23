import { describe, inject, it } from 'vitest';
import { roadsideClass } from '../../src/sim/roadside';
import { SIDEWALK_FILES, SIDEWALK_VERSION } from './sidewalk-group.mjs';
import {
  sidewalkKey,
  sidewalkManifest,
  SIDEWALK_TICKS,
  SIDEWALK_TUNING,
  type SidewalkCase,
} from './sidewalk-inventory';
import type { SidewalkResult } from './sidewalk-oracle';
import { dodged, ride, tally, type Thing } from './sidewalk-ride';

const share = (things: readonly Thing[]) => {
  const rows = things.filter((t) => t.inPath);
  return { n: rows.length, dodged: rows.filter(dodged).length };
};

/** One unchanged ride; no early exposure stop or extra isolation. */
export function runSidewalk(c: SidewalkCase, run = ride): SidewalkResult {
  const options = { seed: c.seed, eventId: c.eventId, maxTicks: SIDEWALK_TICKS, tuning: SIDEWALK_TUNING };
  const result = run({ ...options, ...(c.mode === 'brake' ? { brakeAtM: 25 } : {}) });
  const hits: string[] = [];
  for (const h of result.thingHits) {
    const type = result.config.trafficTypes.find((t) => t.contentId === h.thing);
    if (type && (c.mode === 'fast' ? roadsideClass(type) === 'dodges' : roadsideClass(type) !== 'solid'))
      hits.push(`${c.mode === 'fast' ? c.region + ' ' : ''}${c.eventId} seed ${c.seed} ${h.type} ${h.thing}`);
  }
  const row: SidewalkResult = {
    ...share(result.things),
    types: Object.fromEntries(tally(result.things)),
    hits,
  };
  if (c.mode === 'fast' && process.env['SIDEWALK_BEFORE'] === '1')
    row.before = share(run({ ...options, tuning: { ...SIDEWALK_TUNING, 'traffic.kerbDeep': 0 } }).things);
  return row;
}

/** Ordinary named per-ride cases; the existing reporter alone judges the complete pooled survey. */
export function sidewalkEvent(index: number) {
  const file = SIDEWALK_FILES[index];
  if (!file) throw new Error('Unknown sidewalk event file');
  describe(
    'sidewalk things get out of a fast rider’s way: event ' + (index + 1),
    { concurrent: false, shuffle: false, retry: 0, repeats: 0 },
    () => {
      for (const c of sidewalkManifest().cases.filter((c) => c.file === file))
        it(`${c.region} ${c.eventId}, seed ${c.seed}, ${c.mode}`, ({ task }) => {
          const marker = inject('sidewalkSurvey');
          if (!marker || marker.version !== SIDEWALK_VERSION || !marker.token)
            throw new Error('Missing complete sidewalk reporter');
          task.meta.sidewalkSurvey = { ...marker, key: sidewalkKey(c), ...runSidewalk(c) };
        }, 900_000);
    },
  );
}
