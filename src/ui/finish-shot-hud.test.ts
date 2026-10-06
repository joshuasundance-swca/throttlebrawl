import { describe, expect, it } from 'vitest';
import { FINISH_SHOT_CSS, FINISH_SHOT_HIDDEN, finishShotHudOn, setFinishShotFlag } from './finish-shot-hud';

// Playtest 4, run C's fix check: "The touch buttons, the heat badge and the position stay on screen over Coit
// Tower." During the finish shot the race HUD and the touch buttons are hidden; they are back after.
describe('the race screen over the finish shot', () => {
  it('hides the HUD (and with it the heat badge, position, ticker and objective), the touch buttons and the offer', () => {
    // The heat badge, the position, the objective and the ticker are children of #hud (ui/index.ts builds them
    // there), so hiding #hud hides them; the touch buttons are children of #touch-surface.
    expect(FINISH_SHOT_HIDDEN).toEqual(expect.arrayContaining(['#hud', '#touch-surface']));
    for (const id of FINISH_SHOT_HIDDEN) {
      expect(FINISH_SHOT_CSS).toContain(`#ui[data-finish-shot='on'] ${id}`);
    }
    expect(FINISH_SHOT_CSS).toMatch(/\{ visibility: hidden !important; pointer-events: none !important; \}/);
    // Nothing is hidden without the flag: every selector in the sheet needs it.
    const selectors = FINISH_SHOT_CSS.split('{')[0]!
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    expect(selectors.length).toBe(FINISH_SHOT_HIDDEN.length);
    for (const sel of selectors) expect(sel.startsWith("#ui[data-finish-shot='on']")).toBe(true);
  });

  it('is on from the first frame of the shot in a race and off for the results and the next race', () => {
    const shot = { held: {} };
    expect(finishShotHudOn('race', null), 'before the finish: the HUD shows').toBe(false);
    expect(finishShotHudOn('race', shot), 'the shot: the HUD is hidden').toBe(true);
    for (const state of ['finished', 'results', 'menu', 'careerResults'])
      expect(finishShotHudOn(state, shot), `${state}: back`).toBe(false);
  });

  it('sets and clears the root flag, and a repeat of either changes nothing', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    setFinishShotFlag(root, false);
    expect(root.dataset).toEqual({});
    setFinishShotFlag(root, true);
    setFinishShotFlag(root, true);
    expect(root.dataset).toEqual({ finishShot: 'on' });
    setFinishShotFlag(root, false);
    expect(root.dataset).toEqual({});
    expect('finishShot' in root.dataset).toBe(false);
  });
});
