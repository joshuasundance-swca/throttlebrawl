import { expect, inject, type TestContext } from 'vitest';
import { tally } from '../../sim/landing-oracle.ts';
import { LANDING_VERSION } from '../../sim/landing-group.mjs';
import { SIDEWALK_VERSION } from '../../sim/sidewalk-group.mjs';
import { cases } from './inventory.ts';
export function runCase(i: number, { task, skip }: TestContext) {
  const scenario = process.env.LANDING_FIXTURE_SCENARIO;
  if (process.env.LANDING_FIXTURE_KIND === 'sidewalk') {
    const marker = inject('sidewalkSurvey');
    expect(marker, 'Missing complete sidewalk reporter').toBeTruthy();
    expect(marker!.version).toBe(SIDEWALK_VERSION);
    if (i === 0 && scenario === 'skipped') skip();
    if (i === 0 && scenario === 'failed') throw new Error('Injected required case failure');
    const n = scenario === 'zero-exposure' ? 0 : 10;
    const dodged = scenario === 'bad-pool' ? 8 : scenario === 'regional-band' && i === 0 ? 7 : n;
    const row = {
      ...marker!,
      key: cases[i]!.key,
      n,
      dodged,
      types: { 'fixture:thing': { n, dodged, contact: 0 } },
      hits: scenario === 'crash' && i === 0 ? ['fixture:event seed 1 crash fixture:thing'] : [],
    };
    if (i === 0 && scenario === 'malformed') row.n = NaN;
    if (i === 0 && scenario === 'unknown') row.key = 'unknown';
    if (i === 0 && scenario === 'wrong-token') row.token = 'old-run';
    if (i === 0 && scenario === 'wrong-version') row.version = -1;
    if (i === 0 && scenario === 'missing-metadata') return;
    task.meta.sidewalkSurvey = row;
    return;
  }
  const marker = inject('landingSurvey');
  expect(marker, 'Missing complete landing reporter').toBeTruthy();
  expect(marker!.version).toBe(LANDING_VERSION);
  if (i === 0 && scenario === 'skipped') skip();
  if (i === 0 && scenario === 'failed') throw new Error('Injected required case failure');
  const row = {
    ...marker!,
    key: cases[i]!.key,
    player: { ...tally(), landings: i === 0 ? 1 : 0, clean: i === 0 ? 1 : 0, airCrash: i === 2 ? 1 : 0 },
    rivals:
      i === 0
        ? { ...tally(), landings: 1, crashOnLanding: 1 }
        : i === 1
          ? { ...tally(), landings: 9, clean: 9 }
          : { ...tally(), landings: 99, crashOnLanding: 99 },
  };
  if (i === 1 && scenario === 'bad-pool') row.rivals = { ...tally(), landings: 8, clean: 8 };
  if (i === 0 && scenario === 'zero-exposure') row.player = tally();
  if (i === 2 && scenario === 'thumb-crash') row.player = { ...tally(), landings: 1, crashOnLanding: 1 };
  if (i === 0 && scenario === 'malformed') row.player.airCrash = NaN;
  if (i === 0 && scenario === 'unknown') row.key = 'unknown';
  if (i === 0 && scenario === 'wrong-token') row.token = 'old-run';
  if (i === 0 && scenario === 'wrong-version') row.version = -1;
  if (i === 0 && scenario === 'missing-metadata') return;
  task.meta.landingSurvey = row;
}
