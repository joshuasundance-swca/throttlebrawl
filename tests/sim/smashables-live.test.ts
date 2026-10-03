/// <reference types="vite/client" />
// Run W-T, the pitch deck's #4 part 2, "the road fights back": the roadside smashables on the live
// data the game loads. Every region gets its own kinds where its road tags allow (the Keys' lobster
// traps and mailboxes, the Pacific Northwest's mailboxes and firewood stands, San Francisco's
// parking meters, pop-up desks and cafe tables, never Chinatown's shops), and every one stands off
// the lanes on ground with room for it. Placement only (one tick per route): no races run.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type { SimConfig } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { KIND_SPEC, SMASH, smashState } from '../../src/sim/smash';
import { fromCorridor } from '../../src/sim/traffic/corridor';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

interface Route {
  name: string;
  event: string;
  route?: string;
}

const ROUTES: readonly Route[] = [
  { name: 'keys-m1', event: 'base:m1-skeleton-sprint' },
  { name: 'osm-keys-key-west', event: 'base:m1-skeleton-sprint', route: 'base:osm-key-west-run' },
  { name: 'pnw-c1', event: 'region-pnw:pnw-fogline-run' },
  { name: 'osm-pnw-chuckanut', event: 'region-pnw:pnw-fogline-run', route: 'region-pnw:osm-chuckanut-run' },
  { name: 'osm-pnw-gorge', event: 'region-pnw:pnw-fogline-run', route: 'region-pnw:osm-gorge-run' },
  { name: 'osm-pnw-samish', event: 'region-pnw:pnw-fogline-run', route: 'region-pnw:osm-i5-samish-run' },
  { name: 'sf-hills', event: 'region-sf:sf-hill-sprint' },
  { name: 'sf-downtown', event: 'region-sf:sf-hill-sprint', route: 'region-sf:sf-downtown-run' },
  { name: 'osm-sf-russian-hill', event: 'region-sf:sf-hill-sprint', route: 'region-sf:osm-sf-hills-run' },
  { name: 'osm-sf-twin-peaks', event: 'region-sf:sf-hill-sprint', route: 'region-sf:osm-sf-twin-peaks-run' },
];

/** The kinds each region may put out (its region file's `smashables`). */
const REGION_KINDS: Readonly<Record<string, readonly string[]>> = {
  base: ['lobster-traps', 'mailbox'],
  'region-pnw': ['mailbox', 'firewood-stand'],
  'region-sf': ['parking-meter', 'pop-up-desk', 'cafe-table'],
};

function config(r: Route, seed: number): SimConfig {
  const length = 'standard';
  return buildSimConfig(REG, STREAMS.forEvent(REG, r.event, length, r.route), {
    seed,
    eventId: r.event,
    length,
    ...(r.route ? { route: r.route } : {}),
  });
}

describe('smashables on the live routes', () => {
  const byRegion: Record<string, Set<string>> = {};
  const lines: string[] = [];

  it.each(ROUTES.map((r) => [r.name, r] as const))(
    '%s: stand off the lanes, on ground with room',
    (_n, r) => {
      const cfg = config(r, 1);
      const pack = r.event.split(':')[0] ?? 'base';
      // (A kind may carry more than one name: San Francisco's cafe tables, run W-U.)
      expect([...new Set((cfg.smashables ?? []).map((d) => d.kind))].sort()).toEqual(
        [...(REGION_KINDS[pack] ?? [])].sort(),
      );
      const { sim, world } = createSimWithWorld(cfg);
      sim.step([{ steer: 0, throttle: 0, brake: 0, flags: 0 }]);
      const st = smashState(world);
      const props = st?.props ?? [];
      const kinds = new Set(props.map((q) => cfg.smashables?.[q.def]?.kind ?? '?'));
      const seen = (byRegion[pack] ??= new Set());
      for (const k of kinds) seen.add(k);
      lines.push(`${r.name} ${props.length} (${[...kinds].join(', ') || 'none'})`);
      const pos = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
      for (const q of props) {
        if (!st) break;
        fromCorridor(st.corridor, q.u, q.cd, 1, pos);
        const half = KIND_SPEC[cfg.smashables?.[q.def]?.kind ?? 'mailbox'].halfAcross;
        // Clear of every lane (shoulders included) by the gap, and inside the band it stands on.
        for (const lane of cfg.road.lanesAt(pos.edge, pos.s)) {
          const gap = Math.abs(pos.d - lane.dCenterM) - lane.widthM / 2 - half;
          expect(gap).toBeGreaterThan(SMASH.gapM - 0.05);
        }
        const v = cfg.road.vergeAt(pos.edge, pos.s, pos.d < 0 ? 'left' : 'right');
        expect(Math.abs(pos.d - v.dOuter)).toBeGreaterThanOrEqual(half + SMASH.edgeRoomM - 0.05);
        expect(cfg.road.groundAt(pos.edge, pos.s, pos.d)).not.toBeNull();
      }
    },
  );

  it('every region puts some out, of its own kinds', () => {
    process.stdout.write(`[examined] seed 1, ${ROUTES.length} routes: ${lines.join('; ')}\n`);
    for (const [pack, kinds] of Object.entries(REGION_KINDS)) {
      const seen = byRegion[pack] ?? new Set();
      expect(seen.size, `${pack} placed none`).toBeGreaterThan(0);
      for (const k of seen) expect(kinds).toContain(k);
    }
  });
});
