// Combat reads height (supports, the maintainer, 2026-10-06: riders land on vehicles and ride them).
// A punch, a kick, a swung weapon or a snatch reaches a rider only `combat.reachHeightM` (1 m) above or
// below the attacker: a rider up on a truck's roof (3.4 m) and one riding alongside on the road cannot
// fight, and two on the same roof can. Control: a race whose tuning leaves the key out (every recording
// made before) reaches any height, as before. Riders placed by hand at a height, stepped in sim ticks.
import { describe, expect, it } from 'vitest';
import { F, flags, makeHarness, ofType, type Harness, type Placement } from './harness.test-util';
import { REACH_HEIGHT_KEY } from './index';

const KICK = F.attack | F.kick;

/**
 * The player alongside a rival (1 m to his right, side by side at 20 m/s), the player at `hPlayer` and
 * the rival at `hRival` above the road, the player kicking right on tick 1.
 */
function kickAcross(hPlayer: number, hRival: number, keyLeftOut = false): Harness {
  const placements: Placement[] = [
    { s: 100, d: 0, speed: 20, role: 'player' },
    { s: 100.2, d: 1, speed: 20 },
  ];
  const h = makeHarness(placements, (t, id) =>
    id === 0 && t === 1 ? flags(KICK | F.attackSideRight) : undefined,
  );
  if (keyLeftOut) delete h.world.params[REACH_HEIGHT_KEY];
  const me = h.world.movers[0];
  const rival = h.world.movers[1];
  if (!me || !rival) throw new Error('no riders');
  me.h = hPlayer;
  rival.h = hRival;
  h.run(70);
  return h;
}

const hitsOn = (h: Harness, target: number) => ofType(h.events, 'hit').filter((e) => e.target === target);

describe('combat reads height (supports)', () => {
  it('a kick from the road at a rider up on a truck’s roof (3.4 m) misses; the same kick on the road lands', () => {
    const across = kickAcross(0, 3.4);
    const level = kickAcross(0, 0);
    console.log(
      `[examined] kick from the road at 3.4 m: ${hitsOn(across, 1).length} hits, ${ofType(across.events, 'attackMiss').length} misses; level: ${hitsOn(level, 1).length} hits`,
    );
    expect(hitsOn(across, 1)).toHaveLength(0);
    expect(hitsOn(level, 1)).toHaveLength(1);
  });

  it('two riders on the same roof fight: both 3.4 m up, the kick lands', () => {
    expect(hitsOn(kickAcross(3.4, 3.4), 1)).toHaveLength(1);
  });

  it('a gap within the reach (0.8 m: one on a pickup’s bed, one on the road) still lands', () => {
    expect(hitsOn(kickAcross(0, 0.8), 1)).toHaveLength(1);
  });

  it('control: with the key left out (a recording made before), the kick reaches the roof as before', () => {
    const before = kickAcross(0, 3.4, true);
    expect(hitsOn(before, 1)).toHaveLength(1);
  });
});
