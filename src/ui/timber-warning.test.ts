import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitySnapshot, SimSnapshot, TouchLayout } from '../sim/api';
import { createTuningRegistry } from '../tuning';
import { createUi } from './index';
import { targetOf } from './format';

// Keep the real createUi/updateRace/health widget path. Unrelated lazy panels are not part of
// this node-run DOM check; their browser specs cover their own rendering.
vi.mock('./tuning', () => ({ createTuningPanel: () => ({ toggle() {}, open: false, refreshHz: null }) }));
vi.mock('./moves-gauge', () => ({
  movesMeterCss: () => '',
  createWheelieGauge: () => ({ root: document.createElement('div'), place() {}, update() {} }),
}));
vi.mock('./radio-panel-view', () => ({
  RADIO_PANEL_CSS: '',
  createRadioPanel: () => ({ root: document.createElement('div'), setSource() {}, refresh() {} }),
}));
vi.mock('./career-screen', () => ({
  CAREER_CSS: '',
  createCareerScreens: () => ({
    map: document.createElement('div'),
    results: document.createElement('div'),
    teaser: document.createElement('div'),
    overlays: document.createElement('div'),
    pauseMap: document.createElement('div'),
  }),
}));

class ElementDouble extends EventTarget {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  title = '';
  value = '';
  dataset: Record<string, string> = {};
  children: ElementDouble[] = [];
  parent: ElementDouble | null = null;
  clientWidth = 568;
  clientHeight = 320;
  scrollWidth = 568;
  scrollHeight = 320;
  scrollTop = 0;
  readonly style = {
    width: '',
    fontSize: '',
    display: '',
    getPropertyValue: (name: string) => this.properties[name] ?? '',
    setProperty: (name: string, value: string) => {
      this.properties[name] = value;
    },
  };
  private readonly properties: Record<string, string> = {};
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
  append(...kids: (ElementDouble | string)[]) {
    for (const kid of kids)
      if (typeof kid !== 'string') {
        kid.remove();
        kid.parent = this;
        this.children.push(kid);
      }
  }
  prepend(...kids: ElementDouble[]) {
    this.append(...kids);
    this.children.splice(0, 0, ...this.children.splice(-kids.length));
  }
  replaceChildren(...kids: ElementDouble[]) {
    this.children = [];
    this.append(...kids);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  before(...kids: ElementDouble[]) {
    this.parent?.append(...kids);
  }
  insertBefore(kid: ElementDouble) {
    this.append(kid);
    return kid;
  }
  setAttribute(name: string, value: string) {
    if (name === 'title') this.title = value;
  }
  removeAttribute(name: string) {
    if (name === 'title') this.title = '';
  }
  getBoundingClientRect() {
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  }
  getClientRects() {
    return [];
  }
  querySelector(selector: string): ElementDouble | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): ElementDouble[] {
    return this.children
      .flatMap((e) => [e, ...e.querySelectorAll('*')])
      .filter(
        (e) =>
          selector === '*' ||
          (selector.startsWith('#') && e.id === selector.slice(1)) ||
          (selector.startsWith('.') && e.className.split(' ').includes(selector.slice(1))),
      );
  }
  contains(node: ElementDouble): boolean {
    return node === this || this.children.some((c) => c.contains(node));
  }
  focus() {}
}

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    lean: 0,
    contentId: `r${id}`,
    name: `Rider ${id}`,
    faction: 'rider',
    slot: -1,
    throttle: 0,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 100,
    distanceToFinish: 100,
    place: 1,
    finished: false,
    ...over,
  };
}
const player = rider(0, { slot: 0 });
const timber = (over: Partial<EntitySnapshot> = {}) =>
  rider(1, {
    name: 'A timber rival',
    progress: 72,
    health: 60,
    healthMax: 120,
    signature: { move: 'timber', phase: 'tell', targetId: player.id, seconds: 0, left: 1 },
    ...over,
  });
const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 200, finishOrder: [] },
});
const layout: TouchLayout = {
  id: 'warning-test',
  mirror: false,
  elements: [
    {
      element: 'health-target',
      visible: true,
      anchor: 'top-right',
      offset: [0.03, 0.03],
      scale: 1,
      opacity: 1,
    },
  ],
};

function setup() {
  const host = new ElementDouble();
  const head = new ElementDouble();
  const win = Object.assign(new EventTarget(), {
    innerWidth: 568,
    innerHeight: 320,
    location: { search: '' },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    head,
    documentElement: new ElementDouble(),
    createElement: () => new ElementDouble(),
  });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const ui = createUi(host as unknown as HTMLElement, {
    stampText: '',
    layout,
    tuning: createTuningRegistry([], () => undefined),
    callbacks: { onStartTap() {}, onRace() {}, onBackToMenu() {}, onCopyReport: () => Promise.resolve() },
  });
  ui.show('race');
  const widget = host.querySelector('#hud-target')!;
  const name = widget.querySelector('.hud-name')!;
  const fill = widget.querySelector('.hud-bar')!.children[0]!;
  return { ui, host, widget, name, fill };
}
afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.unstubAllGlobals();
});

describe('readable Timber warning through the real HUD update', () => {
  it.each([
    ['tell', 'WINDUP'],
    ['act', 'CHARGE'],
    ['open', 'WINDED'],
  ] as const)('shows %s despite idle combat and no ordinary target', (phase, label) => {
    const { ui, widget, name, fill } = setup();
    const rival = timber({ signature: { move: 'timber', phase, targetId: player.id, seconds: 0, left: 1 } });
    expect(targetOf(snap([player, rival]), player), 'ordinary combat semantics remain idle').toBeNull();
    ui.updateRace(snap([player, rival]), player.id, 'mph');
    expect(widget.hidden).toBe(false);
    expect(name.textContent).toBe(`${label} ${rival.name}`);
    expect(name.title).toBe(name.textContent);
    expect(fill.style.width).toBe('50%');
  });

  it('prioritises the warning, updates name/phase/health, and restores the current ordinary target without memory', () => {
    const { ui, widget, name, fill } = setup();
    const me = rider(0, { targetId: 2 });
    const ordinary = rider(2, { name: 'Ordinary target', health: 25 });
    ui.setReduceMotion(true);
    ui.updateRace(snap([me, timber(), ordinary]), 0, 'mph');
    expect(name.textContent).toBe('WINDUP A timber rival');
    const changed = timber({
      name: 'Changed name',
      health: 24,
      signature: { move: 'timber', phase: 'open', targetId: 0, seconds: 0, left: 1 },
    });
    const nextTarget = rider(3, { name: 'New ordinary target', health: 75 });
    const retargeted = rider(0, { targetId: nextTarget.id });
    ui.updateRace(snap([retargeted, changed, ordinary, nextTarget]), 0, 'mph');
    expect(name.textContent).toBe('WINDED Changed name');
    expect(fill.style.width).toBe('20%');
    ui.updateRace(snap([retargeted, timber({ signature: null }), ordinary, nextTarget]), 0, 'mph');
    expect(name.textContent).toBe(nextTarget.name);
    expect(name.title).toBe('');
    expect(fill.style.width).toBe('75%');
    ui.updateRace(snap([player, timber({ signature: null }), ordinary]), 0, 'mph');
    expect(widget.hidden).toBe(true);
    ui.show('menu');
    ui.show('race');
    ui.updateRace(snap([player, timber({ signature: null })]), 0, 'mph');
    expect(widget.hidden).toBe(true);
  });

  const rejected: [string, Partial<EntitySnapshot>][] = [
    ['another signature', { signature: { move: 'selfie', phase: 'tell', targetId: 0, seconds: 0, left: 1 } }],
    ['NPC targeting', { signature: { move: 'timber', phase: 'tell', targetId: 2, seconds: 0, left: 1 } }],
    ['far behind', { progress: 64.9 }],
    ['far ahead', { progress: 135.1 }],
    ['split edge', { road: { ...player.road, edge: 1 } }],
    ['high above road', { road: { ...player.road, h: 2.01 } }],
    ['dead', { health: 0 }],
    ['finished', { finished: true }],
    ['down', { mode: 'Tumble' }],
    ['not a rider', { kind: 'vehicle' }],
    ['missing signature', {}],
    ['idle signature', { signature: null }],
  ];
  it.each(rejected)('keeps the ordinary target for %s', (why, over) => {
    const { ui, widget, name } = setup();
    const me = rider(0, { targetId: 2 });
    const ordinary = rider(2);
    const rival = timber(over);
    if (why === 'missing signature') delete rival.signature;
    ui.updateRace(snap([me, rival, ordinary]), 0, 'mph');
    expect(widget.hidden).toBe(false);
    expect(name.textContent).toBe(ordinary.name);
    ui.updateRace(snap([player, rival, ordinary]), 0, 'mph');
    expect(widget.hidden).toBe(true);
  });

  it.each([{ mode: 'Tumble' }, { finished: true }, { health: 0 }] satisfies Partial<EntitySnapshot>[])(
    'does not warn a down, dead or finished player: %j',
    (over) => {
      const { ui, widget } = setup();
      ui.updateRace(snap([rider(0, over), timber()]), 0, 'mph');
      expect(widget.hidden).toBe(true);
    },
  );

  it('includes the distance and height boundaries and chooses closest then lowest id, independent of entity order', () => {
    const { ui, widget, name } = setup();
    const boundary = timber({ progress: 135, road: { ...player.road, h: 2 } });
    ui.updateRace(snap([player, boundary]), 0, 'mph');
    expect(widget.hidden).toBe(false);
    const close = timber({ id: 3, name: 'Nearer', progress: 99 });
    const tied = timber({ id: 2, name: 'Lower id', progress: 101 });
    for (const rivals of [
      [boundary, close, tied],
      [tied, close, boundary],
    ]) {
      ui.updateRace(snap([player, ...rivals]), 0, 'mph');
      expect(name.textContent).toBe('WINDUP Lower id');
    }
  });

  it('warns on a sloped road when ground elevations differ but both riders share its surface', () => {
    const { ui, widget, name } = setup();
    const rival = timber({ y: 8, road: { ...player.road, h: 0 } });
    ui.updateRace(snap([player, rival]), 0, 'mph');
    expect(widget.hidden).toBe(false);
    expect(name.textContent).toBe('WINDUP A timber rival');
  });

  it('respects a removed or hidden target-health widget and its restoration', () => {
    const { ui, widget } = setup();
    const s = snap([player, timber()]);
    ui.updateRace(s, 0, 'mph');
    expect(widget.hidden).toBe(false);
    ui.setLayout({ ...layout, elements: [] });
    ui.updateRace(s, 0, 'mph');
    expect(widget.hidden).toBe(true);
    ui.setLayout({ ...layout, elements: layout.elements.map((e) => ({ ...e, visible: false })) });
    ui.updateRace(s, 0, 'mph');
    expect(widget.hidden).toBe(true);
    ui.setLayout(layout);
    ui.updateRace(s, 0, 'mph');
    expect(widget.hidden).toBe(false);
  });
});
