// Region palettes (playtest 1c integration, render item 3): the renderer reads the race's
// `env.palette` (docs/content-packs.md, "Region packs at runtime", Palette), so the Pacific
// Northwest is grey-green and foggy, San Francisco foggy, and the Keys look exactly as before. The
// palettes are the real region files', merged the way app/ merges them (the region's palette,
// overridden key by key by the event's time-of-day option).
import { Color, Fog, MeshLambertMaterial, Scene, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { CLASSIC_PALETTE, createFlatLook, SKY_BY_TIME, type LookEnv, type MaterialKind } from '../look';
import { defaultRenderParams } from '../tuning';
import { createLookSet, INK_RECIPES, LOOK_IDS, type LookSet } from '.';

interface RegionFile {
  id: string;
  palette?: Record<string, string>;
  timeOfDayOptions: { id: string; palette?: Record<string, string> }[];
}
interface EventFile {
  region: string;
  timeOfDay: string;
}
const regionFiles = import.meta.glob<RegionFile>('../../../packs/*/regions/*/region.json', {
  eager: true,
  import: 'default',
});
const eventFiles = import.meta.glob<EventFile>('../../../packs/*/events/*.json', {
  eager: true,
  import: 'default',
});

/** The race env app/ hands the renderer for a region's first event (app/regions.ts racePalette). */
function envOf(regionId: string): LookEnv & { palette: Record<string, string> } {
  const region = Object.values(regionFiles).find((r) => r.id === regionId);
  if (!region) throw new Error(`no region ${regionId}`);
  const event = Object.values(eventFiles).find(
    (e) => e.region === regionId || e.region?.endsWith(`:${regionId}`),
  );
  const timeOfDay = event?.timeOfDay ?? region.timeOfDayOptions[0]?.id ?? 'noon';
  const option = region.timeOfDayOptions.find((o) => o.id === timeOfDay);
  return { timeOfDay, palette: { ...(region.palette ?? {}), ...(option?.palette ?? {}) } };
}

const WORLD: MaterialKind[] = ['road', 'shoulder', 'land', 'water', 'rail', 'deck', 'markingCenter', 'post'];
const hex = (m: Material) => `#${(m as MeshLambertMaterial).color.getHexString()}`;

function fresh(): { look: LookSet; scene: Scene; mats: Map<MaterialKind, Material> } {
  const look = createLookSet(createFlatLook());
  const mats = new Map(WORLD.map((k) => [k, look.material(k)]));
  return { look, scene: new Scene(), mats };
}

/** What the scene draws in one look, for one env. */
function drawn(id: string, env: LookEnv) {
  const { look, scene, mats } = fresh();
  look.select(id);
  look.setupScene(scene, env);
  const fog = scene.fog as Fog;
  return {
    colours: Object.fromEntries([...mats].map(([k, m]) => [k, hex(m)])),
    sky: `#${(scene.background as Color).getHexString()}`,
    fog: `#${fog.color.getHexString()}`,
    post: look.post({ ...defaultRenderParams() }),
  };
}

describe('the Keys look as they did (their palette is the classic look)', () => {
  const keys = envOf('florida-keys');

  it('draws every look exactly as with no palette at all', () => {
    console.log(`[examined] Keys env: ${JSON.stringify(keys)}`);
    for (const id of LOOK_IDS) {
      const before = drawn(id, { timeOfDay: keys.timeOfDay });
      const after = drawn(id, keys);
      expect(after.colours, id).toEqual(before.colours);
      expect(after.sky, id).toBe(before.sky);
      expect(after.fog, id).toBe(before.fog);
      expect(after.post?.skyHorizon, id).toEqual(before.post?.skyHorizon);
    }
  });
});

describe.each(['pacific-northwest', 'san-francisco'])('the %s palette', (regionId) => {
  const env = envOf(regionId);

  it('recolours the classic look to the region exactly: sea, ground, road, sky and fog', () => {
    const d = drawn('classic', env);
    console.log(
      `[examined] ${regionId} (${env.timeOfDay}): classic ${JSON.stringify(d.colours)}, sky ${d.sky}, fog ${d.fog}`,
    );
    for (const k of WORLD) {
      const want = env.palette[k] ?? CLASSIC_PALETTE[k];
      expect(d.colours[k], k).toBe(want.toLowerCase());
    }
    expect(d.sky).toBe(env.palette['sky']?.toLowerCase());
    expect(d.fog).toBe((env.palette['fog'] ?? env.palette['sky'])?.toLowerCase());
  });

  it('carries the region colours into every ink look, which keeps its own for the rest', () => {
    const named = WORLD.filter(
      (w) => env.palette[w] && env.palette[w]?.toLowerCase() !== CLASSIC_PALETTE[w].toLowerCase(),
    );
    expect(named.length).toBeGreaterThanOrEqual(3);
    for (const id of LOOK_IDS.filter((l) => l !== 'classic')) {
      const plain = drawn(id, { timeOfDay: env.timeOfDay });
      const region = drawn(id, env);
      for (const k of WORLD) {
        const want = named.includes(k) ? env.palette[k]!.toLowerCase() : plain.colours[k];
        expect(region.colours[k], `${id} ${k}`).toBe(want);
      }
      const sky = new Color(env.palette['sky']);
      expect(region.sky, id).toBe(`#${sky.getHexString()}`);
      expect(region.post?.skyHorizon, id).toEqual([sky.r, sky.g, sky.b]);
      expect(region.post?.skyTop, id).not.toEqual(plain.post?.skyTop);
      expect(region.fog, id).toBe((env.palette['fog'] ?? env.palette['sky'])!.toLowerCase());
    }
    console.log(`[examined] ${regionId}: ${named.join(', ')} carried into ${LOOK_IDS.length - 1} ink looks`);
  });
});

describe('the Pacific Northwest reads grey-green, its fog closes in', () => {
  it('has green land and a grey sky, and switching back to the Keys restores the classic colours', () => {
    const { look, scene, mats } = fresh();
    const pnw = envOf('pacific-northwest');
    look.setupScene(scene, pnw);
    const land = (mats.get('land') as MeshLambertMaterial).color;
    expect(land.g).toBeGreaterThan(land.r);
    expect(land.g).toBeGreaterThan(land.b);
    const sky = scene.background as Color;
    const spread = Math.max(sky.r, sky.g, sky.b) - Math.min(sky.r, sky.g, sky.b);
    expect(spread).toBeLessThan(0.08); // grey, not the classic peach dawn
    // The same materials, back on the Keys: the classic colours again.
    const keys = envOf('florida-keys');
    const next = new Scene();
    look.setupScene(next, keys);
    for (const k of WORLD) expect(hex(mats.get(k)!), k).toBe(CLASSIC_PALETTE[k].toLowerCase());
    expect(`#${(next.background as Color).getHexString()}`).toBe(SKY_BY_TIME[keys.timeOfDay]);
  });

  it('keeps each ink recipe unchanged on the Keys', () => {
    for (const [id, r] of Object.entries(INK_RECIPES)) {
      const d = drawn(id, envOf('florida-keys'));
      for (const k of WORLD) {
        const want = r.palette[k] ?? CLASSIC_PALETTE[k];
        expect(d.colours[k], `${id} ${k}`).toBe(want.toLowerCase());
      }
    }
  });
});
