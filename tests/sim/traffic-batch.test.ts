import { beforeAll, describe, expect, it } from 'vitest';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, TRACE_EVERY_TICKS, type BatchResult } from './batch';

// traffic-1's assertions over the shared 50-race batch (docs/milestones/M1.md, traffic-1: "in the
// shared 50-race batch, no vehicle ever enters a shortcut edge"). The batch loads draft content,
// so its races carry traffic both ways. The scenario tests (spawn fairness, stopping, overlap,
// near misses, hashes) are in src/sim/traffic/traffic.test.ts.

let batch: BatchResult;
/** Edges with a shortcut lane anywhere on them, in the base race's network. */
let shortcutEdges: Set<number>;
const print = (line: string) => process.stdout.write(line + '\n');

beforeAll(async () => {
  batch = await simBatch();
  const { config } = createBatchRace(1);
  shortcutEdges = new Set(
    config.road.edges
      .filter((e) => e.sections.some((s) => s.lanes.some((l) => l.kind === 'shortcut')))
      .map((e) => e.index),
  );
}, BATCH_TIMEOUT_MS);

describe('traffic-1 over the shared seeded-race batch', () => {
  it('no vehicle ever enters a shortcut edge', () => {
    let samples = 0;
    const onShortcut: string[] = [];
    for (const race of batch.races) {
      for (const t of race.trace) {
        for (const m of t.movers) {
          if (m.kind !== 'vehicle') continue;
          samples++;
          if (shortcutEdges.has(m.edge)) onShortcut.push(`seed ${race.seed} tick ${t.tick} vehicle ${m.id}`);
        }
      }
    }
    print(
      `[traffic batch] ${samples} vehicle samples (every ${TRACE_EVERY_TICKS} ticks) over ${batch.races.length} races; ` +
        `shortcut edges in the network: ${shortcutEdges.size}${shortcutEdges.size === 0 ? ' (none yet: road-2 adds the shortcut)' : ''}; ` +
        `on a shortcut edge: ${onShortcut.length}`,
    );
    expect(samples).toBeGreaterThan(1000);
    expect(onShortcut.slice(0, 3)).toEqual([]);
  });

  it('every race has traffic both ways, and traffic contacts and near misses happen', () => {
    for (const race of batch.races) {
      expect(race.field.vehiclesByDirMax.plus, `seed ${race.seed}: traffic your way`).toBeGreaterThan(0);
      expect(race.field.vehiclesByDirMax.minus, `seed ${race.seed}: oncoming traffic`).toBeGreaterThan(0);
    }
    const count = (type: string) =>
      batch.races.reduce(
        (n, r) =>
          n +
          r.events.filter((e) => e.type === type && (type === 'nearMiss' || e.data['cause'] === 'traffic'))
            .length,
        0,
      );
    const nearMisses = count('nearMiss');
    const wobbles = count('wobble');
    const crashes = count('crash');
    print(
      `[traffic batch] vehicles up to ${Math.max(...batch.races.map((r) => r.field.vehiclesMax))} at once; ` +
        `traffic events over the batch: ${nearMisses} nearMiss, ${wobbles} wobble, ${crashes} crash`,
    );
    expect(nearMisses).toBeGreaterThan(0);
  });

  it('no rider ever crashes into a light kerb rider: a clip is a wobble with data.kerb (playtest 3)', () => {
    // A light kerb type is a bicycle, scooter, e-bike or the cooler on wheels: kerb, 0.8 m wide or less.
    const { config } = createBatchRace(1);
    const light = new Set(
      config.trafficTypes
        .filter((t) => t.behaviour?.kerb === true && t.widthM <= 0.8)
        .map((t) => t.contentId),
    );
    let crashes = 0;
    let soft = 0;
    let softWithoutFlag = 0;
    for (const race of batch.races) {
      for (const e of race.events) {
        if (e.data['cause'] !== 'traffic' || !light.has(String(e.data['vehicle']))) continue;
        if (e.type === 'crash') crashes++;
        else if (e.type === 'wobble') {
          if (e.data['kerb'] === true) soft++;
          else softWithoutFlag++;
        }
      }
    }
    print(
      `[traffic batch] light kerb types in the base pack: ${[...light].length}; rider crashes into one: ${crashes}; ` +
        `soft wobbles (data.kerb): ${soft}; other wobbles: ${softWithoutFlag}`,
    );
    expect(light.size).toBeGreaterThan(0);
    expect(crashes).toBe(0);
    expect(softWithoutFlag).toBe(0);
  });
});
