import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../../content';
import type { SimSnapshot } from '../../sim/api';
import type { ShownBark } from './director';
import { createNarrative } from './index';

const all = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const localId = 'region-clinton:mara-vale';

describe('Iowa local bark selection', () => {
  it('selects the loaded local lines for a start and a pass of the player', () => {
    const shown: ShownBark[] = [];
    const narrative = createNarrative({
      barkSets: all.barkSets,
      riders: all.riders,
      bikes: all.bikes,
      view: { show: (bark) => shown.push(bark), hide: () => {} },
      radioLines: null,
    });
    const snapshot = {
      tick: 0,
      entities: [
        { id: 0, kind: 'rider', contentId: 'base:player', name: 'You', slot: 0, faction: 'rider' },
        {
          id: 1,
          kind: 'rider',
          contentId: localId,
          name: all.riders[localId]!.name,
          slot: -1,
          faction: 'rider',
        },
      ],
    } as unknown as SimSnapshot;
    const context = { snapshot, seed: 1, raceId: 'iowa-test' };

    narrative.onEvents([{ tick: 0, type: 'raceStart', actor: -1, data: {} }], context);
    narrative.onEvents([{ tick: 600, type: 'overtake', actor: 1, target: 0, data: {} }], context);

    const localLines = Object.entries(all.barkSets)
      .filter(([, set]) => set.defaults?.speaker === 'mara-vale')
      .flatMap(([key, set]) =>
        set.lines.map((line) => ({
          trigger: line.trigger,
          ref: `${key.split(':')[0]}:bark-set/${set.id}#${line.id}`,
        })),
      );
    expect(shown).toHaveLength(2);
    expect(localLines.filter((line) => line.trigger === 'race-start').map((line) => line.ref)).toContain(
      shown[0]?.contentRef,
    );
    expect(localLines.filter((line) => line.trigger === 'overtake').map((line) => line.ref)).toContain(
      shown[1]?.contentRef,
    );
    expect(
      shown.every((bark) => bark.speakerName === all.riders[localId]!.name && bark.text.length > 0),
    ).toBe(true);
  });
});
