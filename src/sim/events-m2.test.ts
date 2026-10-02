// The M2 event contract (docs/milestones/M2.md, app-3 item 1): the new event types and the
// `data.kind` values that `takedown` and `style` carry. Lanes key cues, pop-ups and barks on these
// lists, so they are pinned here against the plan's wording.
import { describe, expect, it } from 'vitest';
import { STYLE_KINDS, TAKEDOWN_KINDS, TRICK_IDS, type SimEvent, type SimEventType } from './api';

describe('the M2 SimEvent contract', () => {
  it('lists the takedown kinds the plan names', () => {
    expect([...TAKEDOWN_KINDS]).toEqual(['traffic', 'scenery', 'health']);
  });

  it('lists the five style sources the maintainer decided, and tricks (playtest 2, 2026-10-02)', () => {
    expect([...STYLE_KINDS]).toEqual([
      'nearMiss',
      'airtime',
      'oncoming',
      'takedownCombo',
      'weaponSteal',
      'trick',
    ]);
    expect([...TRICK_IDS]).toEqual(['backflip', 'frontflip', 'wheelie', 'whip']);
  });

  it('accepts every new M2 event type', () => {
    const types = [
      'takedown',
      'slowmoStart',
      'slowmoEnd',
      'railOver',
      'splash',
      'respawn',
      'getUp',
      'fistShake',
      'grudgeNoted',
      'style',
    ] as const satisfies readonly SimEventType[];
    const events: SimEvent[] = types.map((type, i) => ({ tick: i, type, actor: 0, data: {} }));
    expect(new Set(events.map((e) => e.type)).size).toBe(10);
  });
});
