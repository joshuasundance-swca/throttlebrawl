import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuFlow } from './menu-flow';

class ElementDouble extends EventTarget {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  open = false;
  children: ElementDouble[] = [];
  focused = false;
  append(...kids: ElementDouble[]) {
    this.children.push(...kids);
  }
  setAttribute() {}
  focus() {
    this.focused = true;
  }
}
afterEach(() => vi.unstubAllGlobals());

describe('the menu navigation and Quick Play setup', () => {
  it('keeps setup off the main entry, restores it without rebuilding picks, and returns focus', () => {
    vi.stubGlobal('document', { createElement: () => new ElementDouble() });
    const node = (id: string) => Object.assign(new ElementDouble(), { id }) as unknown as HTMLElement;
    const buttons = new Map<string, ElementDouble>();
    const make = (id: string, cls: 'big' | 'small', text: string, action: () => void) => {
      const b = Object.assign(new ElementDouble(), { id, className: cls, textContent: text });
      b.addEventListener('click', action);
      buttons.set(id, b);
      return b as unknown as HTMLButtonElement;
    };
    const region = node('region-picker');
    const route = node('route-picker');
    const race = node('menu-race');
    const flow = createMenuFlow(make, {
      career: node('menu-career'),
      settings: node('menu-settings'),
      region,
      route,
      race,
      options: node('menu-options'),
      secondary: [node('menu-credits')],
      onChange: () => undefined,
    });
    expect(flow.home.hidden).toBe(false);
    expect(flow.quick.hidden).toBe(true);
    expect((flow.home as unknown as ElementDouble).children.map((n) => n.id)).toContain('menu-quick-play');
    expect((flow.home as unknown as ElementDouble).children).not.toContain(region);
    const more = (flow.home as unknown as ElementDouble).children.find((n) => n.id === 'menu-more');
    expect(more?.children[0]?.textContent).toBe('More');
    expect(more?.children[1]?.children.map((n) => n.id)).toContain('menu-credits');
    buttons.get('menu-quick-play')!.dispatchEvent(new Event('click'));
    expect(flow.isQuick).toBe(true);
    expect(flow.home.hidden).toBe(true);
    expect(flow.quick.hidden).toBe(false);
    expect((flow.details as unknown as ElementDouble).children).toEqual([region, route]);
    expect((flow.actions as unknown as ElementDouble).children).toContain(race);
    expect((flow.details as unknown as ElementDouble).children).not.toContain(race);
    flow.back();
    expect(flow.isQuick).toBe(false);
    expect(flow.home.hidden).toBe(false);
    expect(buttons.get('menu-quick-play')!.focused).toBe(true);
    flow.open(false);
    expect((flow.details as unknown as ElementDouble).children).toContain(route);
  });
});
