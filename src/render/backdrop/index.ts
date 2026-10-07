// render/backdrop: the world past the verge (W-P "fill the world", the maintainer, 2026-10-01b:
// "the worlds just feel very empty"; "distance and skyline: hills, mountains, city skylines, water,
// bridges on the horizon"). Each region's far pieces are data in its pack
// (`assets/backdrop/<region>/`, docs/content-packs.md, "Backdrop"): the Cascades, the Olympics and
// their volcanoes, the Columbia's gorge walls and falls; San Francisco's invented skyline, its two
// big bridges, the bay's ships, Twin Peaks and the mast, the fog bank; the Keys' long bridges,
// mangrove islands, reef light, sailboats and fair-weather clouds.
//
// This file is the small static half the renderer holds. The data and the builder (builder.ts) are
// lazy chunks, fetched the first time a road with a backdrop is shown: a region's backdrop loads
// only when a race (or the menu) there needs it. One mesh, one draw call, a few thousand triangles.
import { Color, Fog, Group, type Scene } from 'three';
import { loadChunk } from '../../content';
import type { RoadNetwork } from '../../sim/api';
import type { BackdropNetworkFile, BackdropRegionFile } from './data';
import type { BackdropStats, BuiltBackdrop } from './builder';

export type { BackdropStats } from './builder';

/** Every pack's per-network backdrop files and region files, fetched on demand. */
const NETWORK_FILES = import.meta.glob<BackdropNetworkFile>('/packs/*/assets/backdrop/*/networks/*.json', {
  import: 'default',
});
const REGION_FILES = import.meta.glob<BackdropRegionFile>('/packs/*/assets/backdrop/*/region.json', {
  import: 'default',
});

/** The backdrop files for a network id, or null when no pack gives that network a backdrop. */
export function backdropFilesFor(networkId: string): { network: string; region: string } | null {
  const network = Object.keys(NETWORK_FILES).find((k) => k.endsWith(`/networks/${networkId}.json`));
  if (!network) return null;
  const region = network.replace(/networks\/[^/]+\.json$/, 'region.json');
  return REGION_FILES[region] ? { network, region } : null;
}

/**
 * The level of a network's own water above the sea at a world point (playtest 4, P4-19, C4: Lake Samish),
 * from the water floors of its backdrop file (water.ts), or null when it has none.
 */
export async function loadNetworkWater(
  networkId: string,
): Promise<((x: number, z: number) => number | null) | null> {
  const files = backdropFilesFor(networkId);
  if (!files) return null;
  // Caught and tried once more (content/'s loadChunk; polish batch F's punch item 4): no water floor.
  const loaded = await loadChunk('backdrop water', () =>
    Promise.all([NETWORK_FILES[files.network]!(), import('./water')]),
  );
  if (!loaded) return null;
  const [file, m] = loaded;
  const floors = m.waterFloors(file);
  return floors.length ? m.waterAtOf(floors) : null;
}

const WHITE = new Color('#ffffff');

export class Backdrop {
  /** Joins the scene once and stays (the renderer keeps it across roads). */
  readonly root = new Group();
  private built: BuiltBackdrop | null = null;
  private road: RoadNetwork | null = null;
  private seed = 1;
  /** Bumped on every request, so a slow load for an older road is dropped. */
  private ticket = 0;
  private failed: string | null = null;

  constructor() {
    this.root.name = 'backdrop-root';
  }

  /** Shows the backdrop of this road's network (none when its packs give it none). */
  setRoad(road: RoadNetwork): void {
    if (road === this.road) return;
    this.road = road;
    this.rebuild();
  }

  /** The race's seed: what varies between races (clouds, boats, islands, clear-cuts) follows it. */
  setSeed(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    if (this.road) this.rebuild();
  }

  private clear(): void {
    if (!this.built) return;
    this.root.remove(this.built.mesh);
    this.built.dispose();
    this.built = null;
  }

  private rebuild(): void {
    const road = this.road;
    const seed = this.seed;
    const ticket = ++this.ticket;
    const files = road ? backdropFilesFor(road.id) : null;
    if (!road || !files) {
      this.clear();
      return;
    }
    // Caught and tried once more (content/'s loadChunk; polish batch F's punch item 4).
    void loadChunk('backdrop', () =>
      Promise.all([import('./builder'), NETWORK_FILES[files.network]!(), REGION_FILES[files.region]!()]),
    )
      .then((loaded) => {
        if (ticket !== this.ticket) return;
        if (!loaded) {
          // A backdrop that will not load leaves the old horizon; the race goes on.
          this.failed = 'the backdrop chunks did not load';
          return;
        }
        const [m, network, region] = loaded;
        const next = m.buildBackdrop(region, network, m.roadPointsOf(road.edges), seed);
        this.clear();
        this.built = next;
        this.root.add(next.mesh);
        this.failed = null;
      })
      .catch((err: unknown) => {
        // A backdrop that will not load leaves the old horizon; the race goes on.
        this.failed = err instanceof Error ? err.message : String(err);
      });
  }

  /** Per frame, before drawing: follows the camera and the scene's haze. */
  update(cam: { x: number; y: number; z: number }, scene: Scene, timeS: number): void {
    if (!this.built) return;
    const fog = scene.fog instanceof Fog ? scene.fog : null;
    const haze = fog?.color ?? (scene.background instanceof Color ? scene.background : WHITE);
    this.built.update(cam, haze, fog?.far ?? 700, timeS, fog?.near ?? 0);
  }

  /** What was built (null while loading or with no backdrop), and a load error if any. */
  status(): { stats: BackdropStats | null; error: string | null } {
    return { stats: this.built?.stats ?? null, error: this.failed };
  }
}
