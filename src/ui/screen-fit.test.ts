import { describe, expect, it } from 'vitest';
import { screenFitFindings } from './screen-fit';
import type { PaintedThing } from './transient-cards';

// A screen fits the phone (polish batch E's check, punch item 5): at 568x320 and the largest Text
// size the menu's lower row was wider than the screen ("ettings" and "Copy debug repor" cut at both
// edges), and with the menu scrolled its "build ..." footer was drawn over Start career and Race.
// ui-transient-cards.spec.ts measures every screen at every size and Text size with this judge.

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const viewport = { width: 568, height: 320 };
const control = (id: string, b: ReturnType<typeof box>): PaintedThing => ({
  name: `the control button#${id}`,
  kind: 'control',
  box: b,
});

// The live check's menu at 568x320, largest Text, scrolled 117 px: the lower row centred and 614 px
// wide, the footer's words left where the unscrolled screen's bottom was.
const settings = control('menu-settings', box(-23, 250, 94, 290));
const copy = control('menu-copy-report', box(375, 250, 591, 290));
const race = control('menu-race', box(300, 280, 420, 322));
const career = control('menu-career', box(30, 280, 225, 322));
const footerLine = box(230, 290, 338, 306);

describe('screenFitFindings', () => {
  it('names a control or a line of words that leaves the screen sideways', () => {
    expect(screenFitFindings({ wide: [settings, copy], painted: [], footer: [] }, viewport)).toEqual([
      'the control button#menu-settings leaves the screen sideways',
      'the control button#menu-copy-report leaves the screen sideways',
    ]);
  });

  it('names what the footer is drawn over', () => {
    expect(
      screenFitFindings({ wide: [], painted: [settings, race, career], footer: [footerLine] }, viewport),
    ).toEqual(['the footer covers the control button#menu-race']);
  });

  it('control: a row inside the screen and a footer under nothing are clean', () => {
    const inside = control('menu-settings', box(20, 250, 137, 290));
    const low = box(230, 300, 338, 316);
    const raised = { ...race, box: box(300, 240, 420, 282) };
    expect(screenFitFindings({ wide: [inside], painted: [inside, raised], footer: [low] }, viewport)).toEqual(
      [],
    );
  });
});
