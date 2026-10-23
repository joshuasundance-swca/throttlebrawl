import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateUiEvent, registerUiActions, guardUiCompletion } from './action-gate';
import { createSettingsScreen } from './settings-screen';
import { createRoutePicker } from './routes';
import { createRadioPanel } from './radio-panel-view';
import { createChangelogScreen, createWhatsNewCard } from './changelog-screen';
import { createCutMenu } from './narrative/veto-ui';
import { DEFAULT_SETTINGS } from '../save';
import { createTuningPanel } from './tuning';
import { createTuningRegistry, FRAME_DIVISOR_ID } from '../tuning';
import { createCareerScreens } from './career-screen';
import { createPackLibrary } from '../content';
import type { CareerView } from '../career';
import { createUi, BARK_TUNING, HUD_TUNING } from './index';

class NodeDouble extends EventTarget {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  value = '';
  checked = false;
  disabled = false;
  parentElement: NodeDouble | null = null;
  children: NodeDouble[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { getPropertyValue: () => '', setProperty: vi.fn() };
  clientHeight = 450;
  scrollLeft = 0;
  scrollTop = 0;
  scrollWidth = 0;
  clientWidth = 0;
  offsetLeft = 0;
  offsetWidth = 0;
  classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false };
  append(...kids: unknown[]) {
    for (const child of kids)
      if (child instanceof NodeDouble) {
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
  scrollTo(options: ScrollToOptions) {
    this.scrollLeft = options.left ?? 0;
  }
  focus() {}
  select() {}
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 };
  }
  before(...kids: unknown[]) {
    this.parentElement?.append(...kids);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  insertBefore(child: NodeDouble, before: NodeDouble | null) {
    child.remove();
    child.parentElement = this;
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}
describe('concrete UI pre-mutation deliveries', () => {
  let root: NodeDouble;
  let nodes: NodeDouble[];
  let phase: 'normal' | 'pending' | 'active';
  let generation: number;
  let order: string[];
  const node = () => {
    const n = new NodeDouble();
    nodes.push(n);
    return n;
  };
  const get = (id: string) => {
    const n = nodes.find((n) => n.id === id);
    if (!n) throw new Error(`Missing concrete UI control: ${id}`);
    return n;
  };
  const button = (id: string, text: string, click: () => void) => {
    const n = Object.assign(node(), { id, textContent: text });
    n.addEventListener('click', gateUiEvent(click));
    return n as unknown as HTMLButtonElement;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    nodes = [];
    order = [];
    phase = 'normal';
    generation = 0;
    root = node();
    vi.stubGlobal('Element', NodeDouble);
    vi.stubGlobal('HTMLElement', NodeDouble);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 450 }));
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), {
        createElement: node,
        head: node(),
        body: root,
        documentElement: root,
        getElementById: (id: string) => nodes.find((n) => n.id === id),
      }),
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    registerUiActions(root, {
      actionGate(_action, deliver) {
        order.push('gate');
        if (phase === 'active') return;
        if (phase === 'pending') {
          order.push('cancel');
          phase = 'normal';
        }
        generation++;
        deliver();
      },
      captureNormal() {
        const captured = generation;
        return () => captured === generation && phase === 'normal';
      },
    });
  });
  afterEach(async () => {
    await vi.dynamicImportSettled();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('route selection, redraw and callback share the entry closure, with a normal positive control', () => {
    const change = vi.fn();
    const draw = vi.fn();
    const picker = createRoutePicker(button, change, draw);
    root.append(picker.root);
    picker.set([
      { id: null, name: 'Default' },
      { id: 'base:alternate', name: 'Alternate' },
    ]);
    draw.mockClear();
    phase = 'active';
    get('route-base-alternate').dispatchEvent(new Event('click'));
    expect(picker.route).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    phase = 'pending';
    get('route-base-alternate').dispatchEvent(new Event('click'));
    expect(picker.route).toBe('base:alternate');
    expect(change).toHaveBeenCalledExactlyOnceWith('base:alternate');
    expect(order.slice(0, 3)).toEqual(['gate', 'gate', 'cancel']);
    phase = 'normal';
    get('route-own').dispatchEvent(new Event('click'));
    expect(picker.route).toBeNull();
  });
  it('settings output and persistent callback are both behind the gate', () => {
    const change = vi.fn();
    const settings = createSettingsScreen({ onChange: change, onBack: vi.fn() });
    root.append(settings.root);
    settings.sync(DEFAULT_SETTINGS);
    const slider = get('settings-volume-master'),
      out = get('settings-volume-master-value');
    const before = out.textContent;
    slider.value = '23';
    phase = 'active';
    slider.dispatchEvent(new Event('input'));
    expect(out.textContent).toBe(before);
    expect(change).not.toHaveBeenCalled();
    phase = 'pending';
    slider.dispatchEvent(new Event('input'));
    expect(out.textContent).toBe('23%');
    expect(change).toHaveBeenCalledExactlyOnceWith({ kind: 'volume', bus: 'master', value: 0.23 });
    phase = 'normal';
    slider.value = '44';
    slider.dispatchEvent(new Event('input'));
    expect(out.textContent).toBe('44%');
  });
  it('settings tab/remap state cannot mutate before the entry gate', () => {
    const settings = createSettingsScreen({ onChange: vi.fn(), onBack: vi.fn() });
    root.append(settings.root);
    settings.sync(DEFAULT_SETTINGS);
    settings.setRemap(true);
    settings.open('menu', 'sound');
    phase = 'active';
    get('settings-tab-keys').dispatchEvent(new Event('click'));
    expect(get('settings-tab-sound').getAttribute('aria-selected')).toBe('true');
    phase = 'normal';
    get('settings-tab-keys').dispatchEvent(new Event('click'));
    expect(get('settings-tab-keys').getAttribute('aria-selected')).toBe('true');
  });
  it('radio confirmation, retune and cut callbacks have current and blocked controls', () => {
    const tune = vi.fn(),
      cut = vi.fn(),
      skip = vi.fn();
    const panel = createRadioPanel({ tune, onCut: cut });
    root.append(panel.root);
    panel.setSource({
      state: () => ({
        choice: 2,
        tunedTo: 'station',
        stations: ['station'],
        nowPlaying: { stationId: 'station', stationName: 'Station', title: 'Song', ref: 'base:track' },
      }),
      skip,
      cut: () => ({ contentRef: 'base:track', kind: 'song', raceId: 'race', tick: 1 }),
    });
    phase = 'active';
    get('radio-cut').dispatchEvent(new Event('click'));
    expect(get('radio-cut-confirm').hidden).toBe(true);
    get('radio-next').dispatchEvent(new Event('click'));
    get('radio-skip').dispatchEvent(new Event('click'));
    expect(tune).not.toHaveBeenCalled();
    expect(skip).not.toHaveBeenCalled();
    phase = 'normal';
    get('radio-cut').dispatchEvent(new Event('click'));
    expect(get('radio-cut-confirm').hidden).toBe(false);
    get('radio-cut-yes').dispatchEvent(new Event('click'));
    expect(cut).toHaveBeenCalledTimes(1);
    get('radio-next').dispatchEvent(new Event('click'));
    get('radio-skip').dispatchEvent(new Event('click'));
    expect(tune).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledTimes(1);
  });
  it('changelog audience and dismissal mutate only inside one allowed closure', () => {
    const back = vi.fn(),
      hide = vi.fn();
    const changelog = createChangelogScreen({ onBack: back });
    const news = createWhatsNewCard({ onHide: hide, onOpenChangelog: vi.fn() });
    root.append(changelog.root, news.root);
    news.show({ kind: 'welcome' });
    phase = 'active';
    get('changelog-dev').dispatchEvent(new Event('click'));
    get('whats-new-ok').dispatchEvent(new Event('click'));
    expect(get('changelog-dev').textContent).toBe('Developer notes');
    expect(news.root.hidden).toBe(false);
    expect(hide).not.toHaveBeenCalled();
    phase = 'normal';
    get('changelog-dev').dispatchEvent(new Event('click'));
    get('whats-new-ok').dispatchEvent(new Event('click'));
    expect(get('changelog-dev').textContent).toBe('Player notes');
    expect(news.root.hidden).toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);
  });
  it('veto closes its local card and persists only after one allowed delivery', () => {
    const menu = createCutMenu(() => root as unknown as HTMLElement),
      cut = vi.fn();
    menu.offer({ contentRef: 'base:line', kind: 'sign', label: 'Line', raceId: 'unit', tick: 1 }, cut);
    phase = 'active';
    get('cut-confirm').dispatchEvent(new Event('click'));
    expect(menu.open).toBe(true);
    expect(cut).not.toHaveBeenCalled();
    phase = 'normal';
    get('cut-confirm').dispatchEvent(new Event('click'));
    expect(menu.open).toBe(false);
    expect(cut).toHaveBeenCalledTimes(1);
  });
  it('guarded async status completion is inert after supersession, with a current positive control', () => {
    const stale = vi.fn(),
      current = vi.fn();
    const finishStale = guardUiCompletion(root, stale);
    generation++;
    finishStale('late');
    expect(stale).not.toHaveBeenCalled();
    guardUiCompletion(root, current)('now');
    expect(current).toHaveBeenCalledExactlyOnceWith('now');
  });
  it('real tuning cap/save/copy/reset and Backquote handlers gate both registry and local presentation', () => {
    const registry = createTuningRegistry([], () => {});
    const set = vi.spyOn(registry, 'set'),
      reset = vi.spyOn(registry, 'reset');
    const panel = createTuningPanel(root as unknown as HTMLElement, registry);
    const cap = nodes.find((n) => n.dataset['divisor'] === '2')!;
    phase = 'active';
    cap.dispatchEvent(new Event('click'));
    get('tuning-save').dispatchEvent(new Event('click'));
    get('tuning-copy').dispatchEvent(new Event('click'));
    get('tuning-reset').dispatchEvent(new Event('click'));
    window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Backquote', repeat: false }));
    expect(set).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(get('tuning-status').textContent).toBe('');
    expect(get('tuning-json').hidden).toBe(true);
    expect(panel.open).toBe(false);
    phase = 'normal';
    cap.dispatchEvent(new Event('click'));
    expect(set).toHaveBeenCalledExactlyOnceWith(FRAME_DIVISOR_ID, 2);
    get('tuning-save').dispatchEvent(new Event('click'));
    expect(get('tuning-status').textContent).not.toBe('');
    get('tuning-copy').dispatchEvent(new Event('click'));
    expect(get('tuning-json').hidden).toBe(false);
    get('tuning-reset').dispatchEvent(new Event('click'));
    expect(reset).toHaveBeenCalledTimes(1);
    window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Backquote', repeat: false }));
    expect(panel.open).toBe(true);
  });
  it('career two-tap, backup and export handlers gate their own local state; stale export cannot fill the code box', async () => {
    const back = vi.fn(),
      importCode = vi.fn(() => Promise.resolve('loaded')),
      start = vi.fn(() => Promise.resolve('new'));
    let fulfill!: (value: string) => void;
    const exported = new Promise<string>((resolve) => {
      fulfill = resolve;
    });
    const screens = createCareerScreens(
      {
        onRegion: vi.fn(),
        onRide: vi.fn(),
        onBack: back,
        onBuyBike: vi.fn(),
        onRideBike: vi.fn(),
        onBuyPaint: vi.fn(),
        onPaint: vi.fn(),
        onExport: () => exported,
        onImport: importCode,
        onStartSeason: vi.fn(),
        onNewCareer: start,
        onRetry: vi.fn(),
        onMap: vi.fn(),
        onNext: vi.fn(),
        onNextRegion: vi.fn(),
      },
      (id, _cls, text, click) => button(id, text, click),
    );
    root.append(screens.map);
    const view: CareerView = {
      season: { n: 1, label: 'Season 1' },
      seasonCard: null,
      cash: 0,
      bike: { key: 'fixture:bike', name: 'Bike', paint: null },
      regions: [],
      region: {
        id: 'fixture',
        name: 'Fixture',
        careerName: 'Circuit',
        tierName: 'Tier',
        tally: { won: 0, nodes: 0, claimed: 0, secretsFound: 0, secrets: 0, shortcutsFound: 0, shortcuts: 0 },
        finaleBeaten: false,
      },
      tiers: [],
      suggested: null,
      map: [],
    };
    screens.showMap(
      { ...view, regions: [], tiers: [], map: [], seasonCard: null },
      { cash: 0, bikes: [], paints: [], paint: null, backups: [{ label: 'Kept', code: 'old-code' }] },
      'garage',
    );
    phase = 'active';
    get('career-new').dispatchEvent(new Event('click'));
    get('career-backup-show-0').dispatchEvent(new Event('click'));
    expect(get('career-new').textContent).toBe('New career');
    expect(get('career-code').value).toBe('');
    phase = 'normal';
    get('career-new').dispatchEvent(new Event('click'));
    expect(get('career-new').textContent).toBe('Tap again to start over');
    get('career-new').dispatchEvent(new Event('click'));
    expect(start).toHaveBeenCalledTimes(1);
    get('career-backup-show-0').dispatchEvent(new Event('click'));
    expect(get('career-code').value).toBe('old-code');
    get('career-code-copy').dispatchEvent(new Event('click'));
    generation++;
    fulfill('late-code');
    await Promise.resolve();
    expect(get('career-code').value).toBe('old-code');
    get('career-code-load').dispatchEvent(new Event('click'));
    expect(importCode).toHaveBeenCalledExactlyOnceWith('old-code');
  });
  it.each([true, false])(
    'real menu handlers gate local changes with optional measurement tool %s',
    async (withTool) => {
      vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }));
      const region = vi.fn(),
        race = vi.fn(),
        tap = vi.fn(),
        install = vi.fn(),
        debug = vi.fn(() => Promise.resolve());
      const settings = vi.fn(),
        measure = vi.fn();
      const registry = createPackLibrary({ includeDrafts: true }).registry();
      const ui = createUi(root as unknown as HTMLElement, {
        stampText: 'game · dev · unit · build',
        layout: { id: 'unit', mirror: false, elements: [] },
        tuning: createTuningRegistry([...BARK_TUNING, ...HUD_TUNING], () => {}),
        settings: structuredClone(DEFAULT_SETTINGS),
        regions: [
          { id: 'one', name: 'One' },
          { id: 'two', name: 'Two' },
        ],
        region: 'one',
        actionGate(_action, deliver) {
          order.push('gate');
          if (phase === 'active') return;
          generation++;
          deliver();
        },
        captureNormal() {
          const captured = generation;
          return () => captured === generation && phase === 'normal';
        },
        callbacks: {
          onStartTap: tap,
          onRace: race,
          onBackToMenu: vi.fn(),
          onWatchReplay: vi.fn(),
          onReplayAction: vi.fn(),
          onCopyReport: debug,
          ...(withTool ? { onMeasureFrames: measure } : {}),
          onRegionChange: region,
          onSettingsChange: settings,
          install: { available: () => true, prompt: install, onChange: () => {} },
          raceOptions: () => ({
            where: 'Fixture road',
            bikes: [
              { value: null, label: 'Garage' },
              { value: Object.keys(registry.bikes)[0]!, label: 'Bike' },
            ],
            times: [{ value: null, label: 'Any' }],
            rivals: [{ value: null, label: 'Default' }],
            lengths: [],
          }),
        },
      });
      await vi.dynamicImportSettled();
      ui.show('menu');
      const tools = nodes.filter((n) => n.id === 'menu-measure-frames');
      expect(tools).toHaveLength(withTool ? 1 : 0);
      if (withTool) {
        expect(tools[0]!.parentElement?.parentElement?.id).toBe('menu-more');
        tools[0]!.dispatchEvent(new Event('click'));
        expect(measure).toHaveBeenCalledTimes(1);
        measure.mockClear();
      }
      settings.mockClear();
      phase = 'active';
      for (const id of [
        'region-two',
        'menu-settings',
        'menu-options',
        'menu-race',
        'menu-install',
        'menu-copy-report',
      ])
        get(id).dispatchEvent(new Event('click'));
      expect(ui.region).toBe('one');
      expect(ui.screen()).toBe('menu');
      expect(region).not.toHaveBeenCalled();
      expect(race).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
      if (withTool) get('menu-measure-frames').dispatchEvent(new Event('click'));
      expect(measure).not.toHaveBeenCalled();
      phase = 'normal';
      get('region-two').dispatchEvent(new Event('click'));
      expect(ui.region).toBe('two');
      expect(region).toHaveBeenCalledExactlyOnceWith('two');
      get('menu-race').dispatchEvent(new Event('click'));
      get('menu-install').dispatchEvent(new Event('click'));
      get('menu-copy-report').dispatchEvent(new Event('click'));
      expect(race).toHaveBeenCalledTimes(1);
      expect(install).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledTimes(1);
      get('menu-settings').dispatchEvent(new Event('click'));
      expect(ui.screen()).toBe('settings');
      ui.show('menu');
      get('menu-options').dispatchEvent(new Event('click'));
      expect(ui.screen()).toBe('raceOptions');
      settings.mockClear();
      const before = JSON.stringify(ui.settings);
      phase = 'active';
      get('race-option-bike-next').dispatchEvent(new Event('click'));
      expect(JSON.stringify(ui.settings)).toBe(before);
      expect(settings).not.toHaveBeenCalled();
      phase = 'normal';
      get('race-option-bike-next').dispatchEvent(new Event('click'));
      expect(settings).toHaveBeenCalledTimes(1);
    },
  );
});
