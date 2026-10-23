import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayView, type ReplayViewState } from './replay-view';
import { createUi, BARK_TUNING, HUD_TUNING } from './index';
import { createTuningRegistry } from '../tuning';

// Exercise real DOM handlers without a browser; rendered geometry belongs to the served-build check.
class NodeDouble extends EventTarget {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  parentElement: NodeDouble | null = null;
  children: NodeDouble[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { getPropertyValue: () => '', setProperty: vi.fn() };
  classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false };
  clientHeight = 320;
  scrollLeft = 0;
  scrollTop = 0;
  scrollWidth = 0;
  clientWidth = 568;
  offsetLeft = 0;
  offsetWidth = 0;
  append(...kids: unknown[]) {
    for (const child of kids)
      if (child instanceof NodeDouble) {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
      }
  }
  prepend(...kids: unknown[]) {
    this.append(...kids);
  }
  replaceChildren(...kids: unknown[]) {
    this.children = [];
    this.append(...kids);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  querySelector(selector: string): NodeDouble | null {
    return (
      this.children.find((n) => `#${n.id}` === selector) ??
      this.children.map((n) => n.querySelector(selector)).find((n) => n !== null) ??
      null
    );
  }
  querySelectorAll() {
    return [];
  }
  focus = vi.fn();
  select() {}
  scrollTo() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: 568, bottom: 320, width: 568, height: 320 };
  }
  before(...kids: unknown[]) {
    this.parentElement?.append(...kids);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
    this.parentElement = null;
  }
  insertBefore(child: NodeDouble) {
    this.append(child);
  }
}

let nodes: NodeDouble[];
let host: NodeDouble;
const get = (id: string) => {
  const node = nodes
    .slice()
    .reverse()
    .find((n) => n.id === id);
  if (!node) throw new Error(`Missing UI node: ${id}`);
  return node;
};
const click = (id: string) => get(id).dispatchEvent(new Event('click'));
const state = (status: ReplayViewState['status']): ReplayViewState => ({
  status,
  camera: 'trackside',
  elapsedSeconds: 3,
  durationSeconds: 65,
});

beforeEach(() => {
  vi.useFakeTimers();
  nodes = [];
  const node = () => {
    const n = new NodeDouble();
    nodes.push(n);
    return n;
  };
  host = node();
  vi.stubGlobal('Element', NodeDouble);
  vi.stubGlobal('HTMLElement', NodeDouble);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 568, innerHeight: 320 }));
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      createElement: node,
      head: node(),
      body: host,
      documentElement: host,
      getElementById: (id: string) => nodes.find((n) => n.id === id),
    }),
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('replay viewer controls', () => {
  it('draws all playback states and camera labels, retaining Return and retry after failure', () => {
    const action = vi.fn();
    const view = createReplayView(action);
    host.append(view.root);
    expect(get('replay-silent').textContent).toMatch(/silent/i);
    for (const status of ['loading', 'playing', 'paused', 'complete', 'failed'] as const) {
      view.update(state(status));
      expect(get('replay-status').textContent.toLowerCase()).toContain(
        status === 'complete' ? 'complete' : status === 'failed' ? 'could not' : status,
      );
      expect(get('replay-return').disabled).toBe(false);
      expect(get('replay-toggle').disabled).toBe(!['playing', 'paused'].includes(status));
      expect(get('replay-restart').disabled).toBe(status === 'loading');
      expect(get('replay-camera').disabled).toBe(['loading', 'failed'].includes(status));
      expect(get('replay-toggle').textContent).toBe(status === 'playing' ? 'Pause' : 'Play');
    }
    view.update({ ...state('paused'), camera: 'orbit' });
    expect(get('replay-camera').textContent).toContain('Orbit');
    expect(get('replay-time').textContent).toBe('0:03 / 1:05');
    view.update({ ...state('failed'), message: '<img src=x onerror=bad()>' });
    expect(get('replay-message').textContent).toBe('<img src=x onerror=bad()>');
    expect(get('replay-message').children).toEqual([]);
    click('replay-restart');
    click('replay-return');
    expect(action.mock.calls).toEqual([['restart'], ['return']]);
    view.update(state('loading'));
    click('replay-toggle');
    click('replay-restart');
    click('replay-camera');
    click('replay-return');
    expect(action.mock.calls).toEqual([['restart'], ['return'], ['return']]);
    expect(get('replay-message').hidden).toBe(true);
  });

  it.each([true, false])(
    'retains availability %s before lazy career installation and gates both result actions',
    async (available) => {
      let blocked = false;
      const gate = vi.fn((_action: unknown, deliver: () => void) => {
        if (!blocked) deliver();
      });
      const watch = vi.fn(),
        action = vi.fn(),
        race = vi.fn(),
        menu = vi.fn();
      const ui = createUi(host as unknown as HTMLElement, {
        stampText: 'game · dev · unit · build',
        layout: { id: 'unit', mirror: false, elements: [] },
        tuning: createTuningRegistry([...BARK_TUNING, ...HUD_TUNING], () => {}),
        actionGate: gate,
        callbacks: {
          onStartTap: vi.fn(),
          onRace: race,
          onBackToMenu: menu,
          onCopyReport: vi.fn(() => Promise.resolve()),
          onWatchReplay: watch,
          onReplayAction: action,
        },
      });
      expect(get('results-watch-replay').hidden).toBe(true);
      ui.setReplayAvailable(!available);
      ui.setReplayAvailable(available);
      await vi.dynamicImportSettled();
      ui.showResults({ place: 2, of: 4, prizeCash: 100, eventName: 'Fixture road' });
      ui.career.showResults({
        title: 'WON',
        eventName: 'Fixture event',
        objectives: [],
        lines: [],
        fine: 0,
        cashAfter: 100,
        news: ['Road claimed'],
        nextName: null,
      });
      for (const id of ['results-watch-replay', 'career-results-watch-replay']) {
        expect(get(id).hidden).toBe(!available);
        expect(get(id).disabled).toBe(!available);
      }
      ui.setReplayAvailable(true);
      for (const screen of ['results', 'careerResults'] as const) {
        ui.show(screen);
        const id = screen === 'results' ? 'results-watch-replay' : 'career-results-watch-replay';
        blocked = true;
        click(id);
        expect(watch).not.toHaveBeenCalled();
        blocked = false;
        click(id);
        expect(watch).toHaveBeenCalledTimes(1);
        watch.mockClear();
      }
      const quickPrize = get('results-prize').textContent;
      const careerTitle = get('career-results-title').textContent;
      expect(nodes.some((n) => n.id === 'replay')).toBe(false);
      ui.updateReplay(state('playing'));
      ui.show('replay');
      expect(get('replay').hidden).toBe(false);
      expect(get('replay-return').focus).toHaveBeenCalledOnce();
      for (const id of ['results', 'career-results', 'hud', 'touch-surface', 'pause-screen'])
        expect(get(id).hidden, id).toBe(true);
      const calls = gate.mock.calls.length;
      blocked = true;
      for (const id of ['replay-toggle', 'replay-restart', 'replay-camera', 'replay-return']) click(id);
      expect(action.mock.calls).toEqual([['toggle'], ['restart'], ['camera'], ['return']]);
      expect(gate.mock.calls).toHaveLength(calls);
      expect(race).not.toHaveBeenCalled();
      expect(menu).not.toHaveBeenCalled();
      ui.show('results');
      expect(get('replay').hidden).toBe(true);
      expect(get('results-watch-replay').focus).toHaveBeenCalledOnce();
      expect(get('results-prize').textContent).toBe(quickPrize);
      ui.show('careerResults');
      expect(get('career-results-title').textContent).toBe(careerTitle);
      ui.setReplayAvailable(false);
      for (const id of ['results-watch-replay', 'career-results-watch-replay'])
        expect(get(id).hidden).toBe(true);
      blocked = false;
      click('results-watch-replay');
      click('career-results-watch-replay');
      expect(watch).not.toHaveBeenCalled();
      action.mockClear();
      click('replay-restart');
      expect(action).not.toHaveBeenCalled();
    },
  );
});
