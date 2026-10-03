/// <reference types="vite/client" />
// The road events as the packs ship them (W-P, the maintainer, 2026-10-01b: "unique regional flavor
// everywhere"). Each region's race opts into its own region's set pieces through
// `modifiers: { pool: "region-default", maxPerRace: 2 }`, and buildSimConfig resolves exactly that
// region's entries, with every vehicle they name present in the race's traffic catalog and never in
// its traffic mix. Over many seeds every piece of each region turns up somewhere, at most two a
// race, and most races get at least one.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createSimWithWorld } from '../../src/sim/create';
import { setPieceState } from '../../src/sim/modifiers';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

// Run W-T (the pitch deck's #9) adds the moving pieces: the Keys' boat slide and gator crossing, the
// PNW's log spill, SF's cable-car runaway (on a cable street only), and a lane vote in each region.
const REGIONS = [
  {
    event: 'base:m1-skeleton-sprint',
    pack: 'base',
    pieces: ['roadwork', 'crash-scene', 'parade', 'speed-trap', 'boat-slide', 'animal-crossing', 'lane-vote'],
  },
  {
    event: 'region-pnw:pnw-fogline-run',
    pack: 'region-pnw',
    pieces: ['roadwork', 'crash-scene', 'parade', 'hay-spill', 'speed-trap', 'log-spill', 'lane-vote'],
  },
  {
    event: 'region-sf:sf-hill-sprint',
    pack: 'region-sf',
    pieces: ['roadwork', 'crash-scene', 'parade', 'speed-trap', 'cable-runaway', 'lane-vote'],
  },
] as const;

function config(event: string, seed: number, route?: string) {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event, 'standard', route), {
    seed,
    eventId: event,
    length: 'standard',
    ...(route ? { route } : {}),
  });
}

describe('road events in the shipped packs', () => {
  it("event vehicles are never larger than each race's other vehicles (the rival AI sizes every vehicle by the largest)", () => {
    for (const r of REGIONS) {
      const cfg = config(r.event, 1);
      const isEvent = (id: string) =>
        cfg.modifiers.some((m) =>
          m.effects.some((e) =>
            [
              e['vehicle'],
              e['vehicle2'],
              ...(Array.isArray(e['floats']) ? (e['floats'] as readonly unknown[]) : []),
            ].includes(id),
          ),
        );
      const road = cfg.trafficTypes.filter((t) => t.category !== 'pedestrian' && t.category !== 'animal');
      const own = road.filter((t) => !isEvent(t.contentId));
      const maxL = Math.max(...own.map((t) => t.lengthM));
      const maxW = Math.max(...own.map((t) => t.widthM));
      for (const t of road.filter((x) => isEvent(x.contentId))) {
        expect(t.lengthM, `${r.event} ${t.contentId}`).toBeLessThanOrEqual(maxL);
        expect(t.widthM, `${r.event} ${t.contentId}`).toBeLessThanOrEqual(maxW);
      }
    }
  });

  for (const r of REGIONS) {
    it(`${r.event}: resolves its own region's set pieces, their vehicles in the catalog and out of the mix`, () => {
      const cfg = config(r.event, 1);
      expect(cfg.event.modifiersPerRace).toBe(2);
      const ids = cfg.modifiers.map((m) => m.contentId);
      expect(ids.length).toBe(r.pieces.length);
      for (const id of ids) expect(id.startsWith(`${r.pack}:`), id).toBe(true);
      const pieces = cfg.modifiers.flatMap((m) => m.effects.map((e) => String(e['piece'])));
      expect(new Set(pieces)).toEqual(new Set(r.pieces));
      for (const m of cfg.modifiers) {
        expect(m.chance).toBeGreaterThan(0);
        expect(m.chance).toBeLessThanOrEqual(1);
        for (const e of m.effects) {
          expect(e.kind).toBe('set-piece');
          expect(typeof e['signText']).toBe('string');
          const floats: readonly unknown[] = Array.isArray(e['floats'])
            ? (e['floats'] as readonly unknown[])
            : [];
          const refs = [e['vehicle'], e['vehicle2'], ...floats].filter(
            (v): v is string => typeof v === 'string',
          );
          for (const ref of refs) {
            const t = cfg.trafficTypes.find((x) => x.contentId === ref);
            expect(t, `${m.contentId} names ${ref}`).toBeDefined();
            // Placed by the event, never rolled by traffic.
            expect(t?.weight, ref).toBe(0);
          }
        }
      }
    });

    it(`${r.event}: over 40 seeds every piece turns up, at most two a race, on the hand-made and real roads`, () => {
      const seen = new Map<string, number>();
      let withAny = 0;
      let races = 0;
      const routes: (string | undefined)[] = [undefined, ...realRoutes(REG, r.event)];
      for (const route of routes) {
        for (let seed = 1; seed <= 40; seed++) {
          const { world } = createSimWithWorld(config(r.event, seed, route));
          const placed = setPieceState(world).pieces;
          races++;
          expect(placed.length).toBeLessThanOrEqual(2);
          if (placed.length > 0) withAny++;
          for (const p of placed) seen.set(p.piece, (seen.get(p.piece) ?? 0) + 1);
        }
      }
      console.log(
        `[print] ${r.event}: ${withAny} of ${races} races have a road event; by piece ${JSON.stringify(Object.fromEntries(seen))}`,
      );
      for (const piece of r.pieces) expect(seen.get(piece) ?? 0, piece).toBeGreaterThan(0);
      expect(withAny / races).toBeGreaterThan(0.6);
    });
  }
});
