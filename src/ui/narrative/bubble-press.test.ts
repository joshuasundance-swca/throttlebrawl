// The ticker's long-press watcher, driven by a manual clock instead of wall time: the browser
// spec (tests/e2e/narrative-veto.spec.ts) rides the same clock through ui's test seam, so a
// press is "held 500 ms" by advancing the clock, never by waiting for the runner.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShownBark } from './director';
import { createManualClock } from './long-press';
import type { BarkSurface } from './surface';
import { VETO_LONG_PRESS_MS } from './veto';
import { watchBubblePresses } from './veto-ui';

const bark: ShownBark = {
  contentRef: 'base:bark-set/kevin-core#line-1',
  speakerName: 'Kevin',
  text: 'Nice bike.',
  startS: 0,
  durationS: 4,
  tick: 60,
  raceId: 'seed-1',
};

// Node has no DOM: just enough of one for the watcher (window events, `Element`, a box).
class FakeElement {
  hidden = false;
  getBoundingClientRect() {
    return { left: 100, right: 300, top: 20, bottom: 60 };
  }
}
interface PointerLike {
  pointerId: number;
  isPrimary: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
}

const g = globalThis as { window?: unknown; Element?: unknown };
let windowTarget: EventTarget;
const saved = { window: g.window, Element: g.Element };

beforeEach(() => {
  windowTarget = new EventTarget();
  g.window = windowTarget;
  g.Element = FakeElement;
});
afterEach(() => {
  g.window = saved.window;
  g.Element = saved.Element;
});

function press(type: 'pointerdown' | 'pointerup', over: Partial<PointerLike> = {}) {
  const e = new Event(type) as Event & PointerLike;
  Object.assign(e, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 200, clientY: 40 }, over);
  windowTarget.dispatchEvent(e);
}

function setup(inControlZone?: (x: number, y: number) => boolean) {
  const clock = createManualClock();
  const cut: ShownBark[] = [];
  const holds: boolean[] = [];
  const el = new FakeElement();
  const surface = {
    current: () => bark,
    element: () => el as unknown as HTMLElement,
    hold: (on: boolean) => holds.push(on),
    show: () => undefined,
    hide: () => undefined,
    cut: () => undefined,
  } as BarkSurface;
  const stop = watchBubblePresses(surface, {
    racing: () => true,
    ...(inControlZone ? { inControlZone } : {}),
    onLongPress: (b) => cut.push(b),
    schedule: clock.schedule,
  });
  return { clock, cut, holds, stop };
}

describe('the ticker long-press on a manual clock', () => {
  it('opens "cut this" exactly when the clock reaches the threshold, and not a tick before', () => {
    const s = setup();
    press('pointerdown');
    s.clock.advance(VETO_LONG_PRESS_MS - 1);
    expect(s.cut).toEqual([]);
    expect(s.holds.at(-1)).toBe(true);
    s.clock.advance(1);
    expect(s.cut).toEqual([bark]);
    s.stop();
  });

  it('negative control: a release before the threshold, or a press in a control zone, never cuts', () => {
    const early = setup();
    press('pointerdown');
    early.clock.advance(VETO_LONG_PRESS_MS - 1);
    press('pointerup');
    early.clock.advance(10_000);
    expect(early.cut).toEqual([]);
    early.stop();

    const zoned = setup(() => true);
    press('pointerdown', { pointerType: 'touch' });
    expect(zoned.clock.pending()).toBe(0);
    zoned.clock.advance(10_000);
    expect(zoned.cut).toEqual([]);
    zoned.stop();
  });

  it('the manual clock fires nothing by itself: it only moves when told', () => {
    const s = setup();
    press('pointerdown');
    expect(s.clock.pending()).toBe(1);
    expect(s.cut).toEqual([]);
    s.stop();
  });
});
