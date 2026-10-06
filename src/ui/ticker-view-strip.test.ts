import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTickerUi } from './ticker-view';

// What a browser spec may read off the strip (tests/e2e/ui-style-meter.spec.ts, "the style pop-ups
// setting turns the chips off mid-race"; ci-c2 found it red once, "chips with the setting off": got 1,
// expected 0). The spec cleared the strip, fed a chip with the setting off and, three drawn frames
// later, read `!root.hidden && root.dataset.cls === 'style'`. But the strip takes `up` away at once
// and sets `hidden` only after its 160 ms fade-out, a wall-clock timer, and it keeps the last item's
// `data-cls` the whole time. So the old reading saw the cleared chip's ghost whenever three frames
// took under 160 ms (a fast runner), and the spec went red; on a slow runner it passed. `up` is the
// reading that does not depend on the clock. This fakes the DOM the strip touches (the unit project
// runs in node) and the timer, so it counts time instead of waiting for it.

class FakeClassList {
  private readonly names = new Set<string>();
  add(...n: string[]) {
    for (const x of n) this.names.add(x);
  }
  remove(...n: string[]) {
    for (const x of n) this.names.delete(x);
  }
  toggle(n: string, force?: boolean) {
    if (force ?? !this.names.has(n)) this.names.add(n);
    else this.names.delete(n);
  }
  contains(n: string) {
    return this.names.has(n);
  }
}

class FakeEl {
  id = '';
  className = '';
  hidden = false;
  textContent = '';
  dataset: Record<string, string> = {};
  classList = new FakeClassList();
  scrollWidth = 0;
  clientWidth = 100;
  offsetWidth = 0;
  readonly children: FakeEl[] = [];
  append(...kids: FakeEl[]) {
    this.children.push(...kids);
  }
  setAttribute() {}
}

const FRAME_MS = 16;

describe('the ticker strip a spec reads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: () => new FakeEl() });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The strip as the spec's three-frame wait leaves it: a chip up, the strip cleared, then a chip fed with style off. */
  function clearedThenFedWithStyleOff(): FakeEl {
    const host = new FakeEl();
    const ui = createTickerUi({ host: host as unknown as HTMLElement });
    const root = host.children[0] as FakeEl;
    let now = 0;
    const frame = () => ui.update((now += FRAME_MS), false);
    frame();
    ui.push({ cls: 'style', text: 'NEAR MISS', kind: 'nearMiss', cash: 25 });
    frame();
    expect(root.classList.contains('up'), 'control: the chip is up with the setting on').toBe(true);
    // The pause and the setting: the strip's clock is frozen, the chip stays. Then the spec's feed.
    ui.replace([]);
    ui.setStyleEnabled(false);
    ui.push({ cls: 'style', text: 'NEAR MISS', kind: 'nearMiss', cash: 25 });
    for (let i = 0; i < 3; i++) frame();
    return root;
  }

  it('shows no chip, by the class that does not wait on the clock, after the clear and a feed with style off', () => {
    const root = clearedThenFedWithStyleOff();
    expect(root.classList.contains('up')).toBe(false);
  });

  it('(why the old reading flaked) keeps the cleared chip in the layout until its fade timer fires', () => {
    const root = clearedThenFedWithStyleOff();
    const oldReading = !root.hidden && root.dataset['cls'] === 'style';
    expect(oldReading, 'three fast frames: the old reading sees the ghost').toBe(true);
    vi.advanceTimersByTime(160);
    expect(!root.hidden && root.dataset['cls'] === 'style', 'after the fade the ghost is gone').toBe(false);
    expect(root.classList.contains('up')).toBe(false);
  });
});
