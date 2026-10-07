import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoutePicker } from './routes';

// The real route picker's observer must not change the row it is delivering. Showing the arrows
// changes that row's flex width, and the saved browser reports caught undelivered notifications.
// Like ticker-view-strip.test.ts, this supplies only the DOM the UI touches; no browser or timer.
function setup() {
  let delivering = false;
  const writes: { delivery: boolean; change: string }[] = [];
  const frames: FrameRequestCallback[] = [];
  const elements: ElementDouble[] = [];
  const write = (change: string) => writes.push({ delivery: delivering, change });
  class ElementDouble extends EventTarget {
    id = '';
    className = '';
    textContent = '';
    hidden = false;
    dataset: Record<string, string> = {};
    readonly children: ElementDouble[] = [];
    scrollLeft = 0;
    clientWidth = 560;
    scrollWidth = 560;
    offsetLeft = 0;
    offsetWidth = 0;
    private off = false;
    private readonly names = new Set<string>();
    readonly classList = {
      add: (...names: string[]) => names.forEach((name) => this.names.add(name)),
      contains: (name: string) => this.names.has(name),
      toggle: (name: string, force: boolean) => {
        if (this.names.has(name) !== force) {
          write(`${this.className}.${name}=${force}`);
          if (force) this.names.add(name);
          else this.names.delete(name);
        }
        return force;
      },
    };
    get disabled() {
      return this.off;
    }
    set disabled(on: boolean) {
      if (this.off !== on) write(`${this.id}.disabled=${on}`);
      this.off = on;
    }
    append(...kids: ElementDouble[]) {
      this.children.push(...kids);
    }
    replaceChildren(...kids: ElementDouble[]) {
      this.children.splice(0, this.children.length, ...kids);
    }
    setAttribute() {}
    scrollTo({ left }: ScrollToOptions) {
      this.scrollLeft = left ?? 0;
    }
  }
  class ObserverDouble {
    readonly observed: Element[] = [];
    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }
    observe(target: Element) {
      this.observed.push(target);
    }
    disconnect() {
      this.observed.length = 0;
    }
    deliver() {
      delivering = true;
      try {
        this.callback([], this as unknown as ResizeObserver);
      } finally {
        delivering = false;
      }
    }
  }
  const observers: ObserverDouble[] = [];
  const element = () => {
    const el = new ElementDouble();
    elements.push(el);
    return el;
  };
  vi.stubGlobal('document', { createElement: element });
  vi.stubGlobal('HTMLElement', ElementDouble);
  vi.stubGlobal('ResizeObserver', ObserverDouble);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.push(run);
    return frames.length;
  });
  const picker = createRoutePicker(
    (id, text, onClick) => {
      const b = element();
      b.id = id;
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b as unknown as HTMLButtonElement;
    },
    () => undefined,
  );
  const routes = [
    { id: null, name: 'Own road' },
    { id: 'other', name: 'Other road' },
  ];
  picker.set(routes);
  const row = elements.find((e) => e.className === 'route-row')!;
  const strip = elements.find((e) => e.className === 'route-scroll')!;
  const before = elements.find((e) => e.id === 'route-before')!;
  const after = elements.find((e) => e.id === 'route-after')!;
  const observer = observers[0]!;
  expect(observer.observed).toEqual([row, ...row.children]);
  return {
    picker,
    routes,
    row,
    strip,
    before,
    after,
    observer,
    frames,
    writes,
    flush: () => {
      const run = frames.shift();
      expect(run, 'a frame was requested').toBeDefined();
      run!(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('route cue observer delivery', () => {
  it('defers real cue mutations, coalesces deliveries, and measures the latest row on the frame', () => {
    const ui = setup();
    expect(ui.strip.classList.contains('scrolls')).toBe(false);
    ui.writes.length = 0;
    ui.row.scrollWidth = 900;
    ui.observer.deliver();
    ui.observer.deliver();
    expect(
      ui.writes.filter((w) => w.delivery),
      'no layout writes inside ResizeObserver delivery',
    ).toEqual([]);
    expect(ui.frames).toHaveLength(1);
    expect(ui.strip.classList.contains('scrolls')).toBe(false);
    // The pending frame reads this newer end position, not the earlier start that queued it.
    ui.row.scrollLeft = 340;
    ui.flush();
    expect(ui.strip.classList.contains('scrolls')).toBe(true);
    expect(ui.before.disabled).toBe(false);
    expect(ui.after.disabled).toBe(true);
    expect(ui.writes.length, 'the same mutation recorder detects the deferred writes').toBeGreaterThan(0);
    expect(ui.writes.every((w) => !w.delivery)).toBe(true);
    expect(ui.frames).toHaveLength(0);
    // A later delivery can schedule again, and a fitting row removes both arrows.
    ui.row.clientWidth = 1000;
    ui.row.scrollLeft = 0;
    ui.observer.deliver();
    expect(ui.frames).toHaveLength(1);
    ui.flush();
    expect(ui.strip.classList.contains('scrolls')).toBe(false);
    expect(ui.before.disabled).toBe(true);
    expect(ui.after.disabled).toBe(true);
  });

  it('keeps draw and scroll cues synchronous', () => {
    const ui = setup();
    ui.row.scrollWidth = 900;
    ui.picker.set(ui.routes);
    expect(ui.strip.classList.contains('scrolls')).toBe(true);
    expect(ui.before.disabled).toBe(true);
    expect(ui.after.disabled).toBe(false);
    expect(ui.frames).toHaveLength(0);
    ui.row.scrollLeft = 340;
    ui.row.dispatchEvent(new Event('scroll'));
    expect(ui.before.disabled).toBe(false);
    expect(ui.after.disabled).toBe(true);
    expect(ui.frames).toHaveLength(0);
  });
});
