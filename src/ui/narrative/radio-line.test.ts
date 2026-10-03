// Pivot FM's line (run W-U; src/audio/rider-station.ts): after its dead air the radio asks the
// narrative to show one bark line of its own. It shows like any bark (so it speaks and can be cut),
// named by the station, only during a race, and never once cut.
import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../../sim/api';
import type { ShownBark } from './director';
import { createNarrative, RADIO_BARK_EVENT } from './index';

const REF = 'region-sf:bark-set/pivot-core#pivot-fm-next-chapter';
const barkSets = {
  'region-sf:pivot-core': {
    type: 'bark-set' as const,
    id: 'pivot-core',
    defaults: { speaker: 'pivot' },
    lines: [
      {
        id: 'pivot-fm-next-chapter',
        trigger: 'interlude',
        text: "We're excited to announce our next chapter.",
      },
    ],
  },
};
const snapshot = {
  tick: 300,
  timeScale: 1,
  entities: [],
  race: { over: false, routeLength: 1, finishOrder: [] },
};

function setup(vetoed: string[] = []) {
  const shown: ShownBark[] = [];
  const lines = new EventTarget();
  const n = createNarrative({
    barkSets,
    riders: {
      'region-sf:pivot': { type: 'rider', id: 'pivot', role: 'rival', bike: 'pivot-bike', name: 'Pivot' },
    },
    bikes: {},
    view: { show: (b) => shown.push(b), hide: () => {} },
    vetoed,
    radioLines: lines,
  });
  const say = (detail: Record<string, unknown>) =>
    lines.dispatchEvent(new CustomEvent(RADIO_BARK_EVENT, { detail }));
  const race = () =>
    n.onEvents([{ tick: 300, type: 'raceStart', actor: 0, data: {} }], {
      snapshot: snapshot as unknown as SimSnapshot,
      seed: 4,
      raceId: 'r1',
    });
  return { n, shown, say, race };
}

describe("a radio station's own line", () => {
  it('shows during a race, named by the station, and lands in the recently seen list', () => {
    const s = setup();
    s.race();
    s.say({ contentRef: REF, speakerName: 'Pivot FM' });
    const b = s.shown.find((x) => x.contentRef === REF);
    expect(b).toMatchObject({
      speakerName: 'Pivot FM',
      text: "We're excited to announce our next chapter.",
      tick: 300,
      raceId: 'r1',
    });
    expect(b!.durationS).toBeGreaterThanOrEqual(2);
    expect(s.n.recentlySeen().map((x) => x.contentRef)).toContain(REF);
  });

  it("falls back to the rider's name, and ignores unknown lines, a cut line, and the menus", () => {
    const s = setup();
    s.say({ contentRef: REF });
    expect(s.shown).toEqual([]);
    s.race();
    s.say({ contentRef: 'region-sf:bark-set/pivot-core#no-such-line' });
    s.say({ contentRef: 42 });
    expect(s.shown.filter((x) => x.contentRef !== REF)).toEqual(s.shown);
    s.say({ contentRef: REF });
    expect(s.shown.find((x) => x.contentRef === REF)?.speakerName).toBe('Pivot');
    const cut = setup([REF]);
    cut.race();
    cut.say({ contentRef: REF, speakerName: 'Pivot FM' });
    expect(cut.shown.find((x) => x.contentRef === REF)).toBeUndefined();
  });
});
