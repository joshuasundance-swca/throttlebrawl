// riders-5 style scoring over the shared seeded batch (docs/milestones/M2.md, riders-5): the
// scoring fires through the real pipeline (traffic's near misses, the riders' jumps, combat's
// steals), every scored near miss links to exactly one style event, points are positive whole
// cash, and the races still replay to identical hashes. The per-kind counts are printed.
import { beforeAll, describe, expect, it } from 'vitest';
import { STYLE_KINDS, type SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, simBatch, type BatchResult } from './batch';

const print = (line: string) => process.stdout.write(line + '\n');

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

const styles = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'style');

describe('riders-5: style cash in the shared batch', () => {
  it('scores style in real races and prints the counts by kind', () => {
    const all: Record<string, number> = Object.fromEntries(STYLE_KINDS.map((k) => [k, 0]));
    const player: Record<string, number> = Object.fromEntries(STYLE_KINDS.map((k) => [k, 0]));
    let playerCash = 0;
    let races = 0;
    for (const race of batch.races) {
      let scored = false;
      for (const e of styles(race.events)) {
        const kind = String(e.data['kind']);
        all[kind] = (all[kind] ?? 0) + 1;
        if (e.actor === race.playerId) {
          player[kind] = (player[kind] ?? 0) + 1;
          playerCash += Number(e.data['points']);
          scored = true;
        }
      }
      if (scored) races++;
    }
    const fmt = (r: Record<string, number>) => STYLE_KINDS.map((k) => `${k} ${r[k] ?? 0}`).join(', ');
    print(`riders-5 style over ${batch.races.length} races: all riders: ${fmt(all)}`);
    print(`riders-5 style, the player (bot): ${fmt(player)}; $${playerCash} in total; ${races} races scored`);
    expect(batch.races.length).toBeGreaterThan(0);
    expect(Object.values(all).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(all['nearMiss']).toBeGreaterThan(0);
  });

  it('every style event is a known kind worth positive whole cash', () => {
    let n = 0;
    for (const race of batch.races) {
      for (const e of styles(race.events)) {
        n++;
        expect(STYLE_KINDS).toContain(e.data['kind']);
        const points = Number(e.data['points']);
        expect(Number.isInteger(points) && points > 0).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('a racer’s near miss scores exactly once, linked by its cause id; the law’s scores nothing', () => {
    let checked = 0;
    for (const race of batch.races) {
      const law = new Set<number>();
      // Riders who finished, were busted or went down stop scoring from that tick on.
      const stoppedAt = new Map<number, number>();
      for (const e of race.events) {
        if ((e.type === 'finish' || e.type === 'bust') && !stoppedAt.has(e.target ?? e.actor)) {
          stoppedAt.set(e.type === 'bust' ? (e.target ?? e.actor) : e.actor, e.tick);
        }
      }
      for (const m of race.trace[0]?.movers ?? []) if (m.faction === 'law') law.add(m.id);
      const byCause = new Map<number, SimEvent[]>();
      for (const e of styles(race.events)) {
        if (e.data['kind'] !== 'nearMiss' || e.causeId === undefined) continue;
        byCause.set(e.causeId, [...(byCause.get(e.causeId) ?? []), e]);
      }
      for (const e of race.events) {
        if (e.type !== 'nearMiss' || e.causeId === undefined) continue;
        const stop = stoppedAt.get(e.actor);
        if (stop !== undefined && e.tick >= stop) continue;
        const scored = byCause.get(e.causeId) ?? [];
        if (law.has(e.actor)) {
          expect(scored).toHaveLength(0);
          continue;
        }
        expect(scored).toHaveLength(1);
        expect(scored[0]?.actor).toBe(e.actor);
        expect(scored[0]?.tick).toBe(e.tick);
        checked++;
      }
    }
    print(`riders-5: ${checked} racer near misses checked against their style events`);
    expect(checked).toBeGreaterThan(0);
  });

  it('races with style scoring still replay to identical hashes', () => {
    for (const race of batch.races) expect(race.firstMismatch).toBe(-1);
  });
});
