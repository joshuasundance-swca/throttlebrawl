import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppHandle, AppMeasurementRequest } from '../app';
import { mountMeasurementTool } from './measurement-ui';

class Element {
  children: Element[] = [];
  textContent = '';
  type = '';
  disabled = false;
  style = { cssText: '' };
  removed = false;
  attrs: Record<string, string> = {};
  listeners = new Map<string, Set<() => void>>();
  append(child: Element) {
    this.children.push(child);
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  addEventListener(key: string, fn: () => void) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
  }
  removeEventListener(key: string, fn: () => void) {
    this.listeners.get(key)?.delete(fn);
  }
  remove() {
    this.removed = true;
  }
  click() {
    if (!this.disabled) for (const fn of this.listeners.get('click') ?? []) fn();
  }
}
afterEach(() => vi.useRealTimers());
describe('measurement private overlay', () => {
  it('opens without acquisition, keeps menu DOM, exports only on explicit click, and cleans pending work on Close', () => {
    vi.useFakeTimers();
    const body = new Element();
    const menu = new Element();
    body.append(menu);
    const doc = { body, createElement: () => new Element() } as unknown as Document;
    const begin = vi.fn((_request: AppMeasurementRequest) => new Promise(() => {}));
    const app = {
      build: { id: 'test', channel: 'test', branch: 'test' },
      beginMeasurement: begin,
    } as unknown as AppHandle;
    const copy = vi.fn();
    const save = vi.fn();
    const tool = mountMeasurementTool(app, { copy, save }, doc);
    expect(mountMeasurementTool(app, { copy, save }, doc)).toBe(tool);
    expect(begin).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(menu.removed).toBe(false);
    const box = body.children[1]!;
    const buttons = box.children.at(-1)!.children;
    const press = (name: string) => buttons.find((el) => el.textContent === name)!.click();
    press('Start');
    press('Start');
    expect(begin).toHaveBeenCalledTimes(1);
    press('Copy debug report');
    press('Save debug file');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    const signal = begin.mock.calls[0]![0].signal;
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    press('Close');
    expect(signal.aborted).toBe(true);
    expect(box.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    press('Start');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(menu.removed).toBe(false);
    const reopened = mountMeasurementTool(app, { copy, save }, doc);
    expect(reopened).not.toBe(tool);
    reopened.close();
  });
});
