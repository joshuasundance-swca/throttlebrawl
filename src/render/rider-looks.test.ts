import { describe, expect, it } from 'vitest';
import { BIKE_CLASSES } from '../content';
import { BIKE_CLASS_MODELS, riderLookOf, withPlayerPaint } from './rider-looks';

describe('riderLookOf: which models a rider draws with (run W-R)', () => {
  it('the rider model is the rider id, without its pack', () => {
    const l = riderLookOf({
      contentId: 'region-pnw:juniper-moss',
      role: 'rival',
      bikeId: 'base:rustbucket-400',
    });
    expect(l.riderModel).toBe('models/riders/juniper-moss');
    expect(l.contentId).toBe('region-pnw:juniper-moss');
  });

  it('a named bike model wins over the class, the class over the sim bike', () => {
    const base = { contentId: 'base:x', role: 'rival' as const, bikeId: 'base:rustbucket-400' };
    expect(riderLookOf({ ...base, look: { bikeClass: 'chopper', bikeModel: 'bagger' } }).bikeModel).toBe(
      'models/bikes/bagger',
    );
    expect(riderLookOf({ ...base, look: { bikeClass: 'chopper' } }).bikeModel).toBe('models/bikes/chopper');
    expect(riderLookOf({ ...base, look: { bikeClass: 'not-a-class' } }).bikeModel).toBe(
      'models/bikes/rustbucket-400',
    );
    expect(riderLookOf(base).bikeModel).toBe('models/bikes/rustbucket-400');
  });

  it('a cop with no named bike rides the police motorcycle and is the law', () => {
    const l = riderLookOf({ contentId: 'base:sgt-pruitt', role: 'cop', bikeId: 'base:rustbucket-400' });
    expect(l.bikeModel).toBe('models/bikes/cop-moto');
    expect(l.law).toBe(true);
    expect(
      riderLookOf({ contentId: 'base:p', role: 'player', bikeId: 'base:streetfighter-750' }),
    ).toMatchObject({
      bikeModel: 'models/bikes/streetfighter-750',
      law: false,
    });
  });

  it('the palette repaints the bike; bad colours are dropped, none keeps the bike its own', () => {
    const l = riderLookOf({
      contentId: 'base:x',
      role: 'rival',
      bikeId: 'base:rustbucket-400',
      look: { palette: ['#ff3d7f', 'pink', 3, '#F4F4F4'] },
    });
    expect(l.paint).toEqual(['#ff3d7f', '#F4F4F4']);
    expect(riderLookOf({ contentId: 'base:x', role: 'rival', bikeId: 'b', look: null }).paint).toBeNull();
  });

  it('every content bike class has a bike model', () => {
    expect(Object.keys(BIKE_CLASS_MODELS).sort()).toEqual([...BIKE_CLASSES].sort());
  });

  it("the player rides their sim bike's model (the garage's), whatever the look names", () => {
    const l = riderLookOf({
      contentId: 'base:player',
      role: 'player',
      bikeId: 'base:superbike-1000',
      look: { bikeModel: 'chopper', bikeClass: 'dirt' },
    });
    expect(l).toMatchObject({ bikeModel: 'models/bikes/superbike-1000', player: true, law: false });
    expect(riderLookOf({ contentId: 'base:x', role: 'rival', bikeId: 'base:moped' }).player).toBe(false);
  });

  it("withPlayerPaint puts the career paint first on the player's palette, and only there", () => {
    const player = riderLookOf({
      contentId: 'base:player',
      role: 'player',
      bikeId: 'base:moped',
      look: { palette: ['#b8322a', '#fff3c4', '#2a3550'] },
    });
    expect(withPlayerPaint(player, '#00aa55').paint).toEqual(['#00aa55', '#fff3c4', '#2a3550']);
    expect(withPlayerPaint(player, null)).toBe(player);
    expect(withPlayerPaint(player, 'teal')).toBe(player);
    const bare = riderLookOf({ contentId: 'base:player', role: 'player', bikeId: 'base:moped' });
    expect(withPlayerPaint(bare, '#00aa55').paint).toEqual(['#00aa55']);
    const rival = riderLookOf({
      contentId: 'base:x',
      role: 'rival',
      bikeId: 'base:moped',
      look: { palette: ['#111111'] },
    });
    expect(withPlayerPaint(rival, '#00aa55')).toBe(rival);
  });
});
