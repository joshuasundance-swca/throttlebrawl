import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCareerScreens, type CareerCallbacks } from './career-screen';
import { actionScreenParts, ACTION_SCREEN_CSS } from './action-screen';

class ElementDouble extends EventTarget {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  style = {};
  children: ElementDouble[] = [];
  append(...kids: ElementDouble[]) {
    this.children.push(...kids);
  }
  replaceChildren(...kids: ElementDouble[]) {
    this.children = kids;
  }
  setAttribute() {}
}
const all = (root: ElementDouble): ElementDouble[] => [root, ...root.children.flatMap(all)];
afterEach(() => vi.unstubAllGlobals());

describe('results action frames', () => {
  it('places a quick outcome and its actions outside the details', () => {
    vi.stubGlobal('document', { createElement: () => new ElementDouble() });
    const heading = new ElementDouble();
    const detail = new ElementDouble();
    const action = new ElementDouble();
    const parts = actionScreenParts(
      'results',
      [heading as unknown as HTMLElement],
      [detail as unknown as HTMLElement],
      [action as unknown as HTMLElement],
    ) as unknown as ElementDouble[];
    expect(parts.map((n) => n.id)).toEqual(['results-heading', 'results-details', 'results-actions']);
    expect(parts[0]!.children).toContain(heading);
    expect(parts[1]!.children).not.toContain(action);
    expect(parts[2]!.children).toContain(action);
    expect(ACTION_SCREEN_CSS).toMatch(/\.action-details \{[^}]*min-height: 0;[^}]*overflow-y: auto/);
  });
  it('keeps retry, next and map outside career news/objectives and dispatches their actual callbacks', () => {
    vi.stubGlobal('document', { createElement: () => new ElementDouble() });
    const retry = vi.fn();
    const next = vi.fn();
    const map = vi.fn();
    const noop = () => undefined;
    const cb: CareerCallbacks = {
      onRegion: noop,
      onRide: noop,
      onBack: noop,
      onBuyBike: noop,
      onRideBike: noop,
      onBuyPaint: noop,
      onPaint: noop,
      onExport: () => Promise.resolve(''),
      onImport: () => Promise.resolve(''),
      onStartSeason: noop,
      onNewCareer: () => Promise.resolve(''),
      onRetry: retry,
      onNext: next,
      onMap: map,
      onNextRegion: noop,
    };
    const screens = createCareerScreens(cb, (id, cls, text, action) => {
      const b = Object.assign(new ElementDouble(), { id, className: cls, textContent: text });
      b.addEventListener('click', action);
      return b as unknown as HTMLButtonElement;
    });
    screens.showResults({
      title: 'WON',
      eventName: 'Event',
      objectives: [{ label: 'Finish first', met: true, required: true }],
      lines: [],
      fine: 0,
      cashAfter: 900,
      news: ['A road opened.'],
      nextName: 'Another event',
    });
    const nodes = all(screens.results as unknown as ElementDouble);
    const details = nodes.find((n) => n.id === 'career-results-details');
    const actions = nodes.find((n) => n.id === 'career-results-actions');
    expect(details).toBeDefined();
    expect(actions).toBeDefined();
    expect(all(details!).some((n) => n.id === 'career-results-objectives')).toBe(true);
    for (const [id, callback] of [
      ['retry', retry],
      ['next', next],
      ['map', map],
    ] as const) {
      const button = all(actions!).find((n) => n.id === `career-results-${id}`)!;
      expect(button).toBeDefined();
      expect(all(details!)).not.toContain(button);
      button.dispatchEvent(new Event('click'));
      expect(callback).toHaveBeenCalledOnce();
    }
    screens.showResults({
      title: 'LOST',
      eventName: 'Event',
      objectives: [],
      lines: [],
      fine: 0,
      cashAfter: 0,
      news: [],
      nextName: null,
    });
    expect(all(screens.results as unknown as ElementDouble).some((n) => n.id === 'career-results-next')).toBe(
      false,
    );
    screens.setObjective('Take down the target');
    screens.showPauseMap(null);
    expect(screens.pauseMap.hidden).toBe(false);
    const goal = all(screens.pauseMap as unknown as ElementDouble).find((n) => n.id === 'pause-goal');
    expect(goal?.textContent).toBe('Goal: Take down the target');
    screens.setObjective(null);
    expect(screens.pauseMap.hidden).toBe(true);
  });
});
