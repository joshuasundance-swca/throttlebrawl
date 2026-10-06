// The height contract reaches the sim's config (docs/content-packs.md, "Heights and hitboxes"): each
// traffic type's height, each smashable's height and the contact box of a rider whose file or bike
// gives one. The checks read the real packs through the game's own config builder. Nothing in the
// sim reads these yet, so they change no race: the config's new fields are the whole change.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { SMASHABLE_HEIGHT_M, TRAFFIC_HEIGHT_DEFAULT_M } from '../sim/api';
import { buildSimConfig, streamForEvent } from './config';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const SF = 'region-sf:sf-t2-meter';
const KEYS = 'base:keys-t1-shakedown';
const build = (eventId: string, extra: { playerBike?: string } = {}) =>
  buildSimConfig(ALL, streamForEvent(ALL, eventId), { seed: 3, eventId, ...extra });

describe('buildSimConfig writes the height contract', () => {
  it('gives every traffic type its height: the file`s own, else its category`s default', () => {
    const config = build(KEYS);
    expect(config.trafficTypes.length).toBeGreaterThan(10);
    for (const t of config.trafficTypes) {
      const file = ALL.trafficTypes[t.contentId];
      expect(file, t.contentId).toBeDefined();
      expect(t.heightM, t.contentId).toBe(file?.heightM ?? TRAFFIC_HEIGHT_DEFAULT_M[t.category]);
    }
    // A shipped truck says its own height, which is not the car default (the control).
    const truck = config.trafficTypes.find((t) => t.contentId === 'base:box-truck');
    expect(truck?.heightM).toBe(3.4);
    expect(truck?.heightM).not.toBe(TRAFFIC_HEIGHT_DEFAULT_M.car);
  });

  it('gives a type that omits its height its category default', () => {
    const box = ALL.trafficTypes['base:box-truck'];
    if (!box) throw new Error('the base pack has no box truck');
    const { heightM: _dropped, ...without } = box;
    const stripped = { ...ALL, trafficTypes: { ...ALL.trafficTypes, 'base:box-truck': without } };
    const config = buildSimConfig(stripped, streamForEvent(stripped, KEYS), { seed: 3, eventId: KEYS });
    const t = config.trafficTypes.find((x) => x.contentId === 'base:box-truck');
    expect(t?.heightM).toBe(TRAFFIC_HEIGHT_DEFAULT_M.truck);
  });

  it('gives every smashable its height: the item`s own, else its kind`s', () => {
    const config = build(KEYS);
    expect((config.smashables ?? []).length).toBeGreaterThan(0);
    for (const s of config.smashables ?? []) expect(s.heightM, s.contentId).toBe(SMASHABLE_HEIGHT_M[s.kind]);
  });

  it("gives the rider whose file names a box that box, over its bike's, and nobody else", () => {
    const config = build(SF);
    // The cop is fielded several times: each copy has the box, and no other rider does.
    const withBox = new Set(config.riders.filter((r) => r.hitbox).map((r) => r.contentId));
    expect([...withBox]).toEqual(['region-sf:officer-meter']);
    expect(config.riders.length).toBeGreaterThan(withBox.size);
    expect(config.riders.find((r) => r.contentId === 'region-sf:officer-meter')?.hitbox).toEqual({
      lengthM: 1.7,
      widthM: 1.1,
    });
  });

  it('gives the player on a bike that names a box the bike`s box', () => {
    const player = (bike: string) =>
      build(KEYS, { playerBike: bike }).riders.find((r) => r.role === 'player');
    expect(player('base:lawnmower')?.hitbox).toEqual({ lengthM: 1.65, widthM: 1.15 });
    expect(player('base:mobility-scooter')?.hitbox).toEqual({ lengthM: 1.5, widthM: 0.8 });
    // The control: a bike with no box of its own leaves the default (no field).
    expect(player('base:superbike-1000')?.hitbox).toBeUndefined();
  });
});
