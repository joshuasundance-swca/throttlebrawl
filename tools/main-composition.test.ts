import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCallbacks, AppHandle, AppOptions } from '../src/app';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('../src/app');
  vi.doUnmock('../src/dev');
  vi.doUnmock('../src/dev/boot');
});

async function bootWithDeferredDev() {
  vi.resetModules();
  vi.useFakeTimers();
  let callbacks: AppCallbacks | undefined;
  let ready!: () => void;
  const booted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let releaseDev!: () => void;
  const devGate = new Promise<void>((resolve) => {
    releaseDev = resolve;
  });
  const app = {} as AppHandle;
  const open = vi.fn();
  vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: () => ({ id: '' }) });
  vi.stubGlobal('window', { location: { search: '' } });
  for (const name of ['__BUILD_ID__', '__BUILD_CHANNEL__', '__BUILD_BRANCH__', '__SIM_CODE_HASH__'])
    vi.stubGlobal(name, 'test');
  vi.doMock('../src/app', () => ({
    loadBootContent: () => Promise.resolve(),
    createApp: (options: AppOptions) => {
      callbacks = options.callbacks;
      ready();
      return app;
    },
  }));
  vi.doMock('../src/dev/boot', () => ({ installErrorCapture: vi.fn(), testFlagSet: () => false }));
  vi.doMock('../src/dev', async () => {
    await devGate;
    return {
      openMeasurementTool: open,
      installDev: vi.fn(),
      copyReport: () => Promise.resolve(),
      saveDebugFile: () => Promise.resolve(),
    };
  });
  await vi.importActual('../src/main');
  await booted;
  return { app, open, releaseDev, callbacks: callbacks! };
}

describe('measurement tool composition', () => {
  it('opens the current menu intent once lazy DEV loading completes', async () => {
    const fixture = await bootWithDeferredDev();
    expect(fixture.callbacks.onMeasureFrames).toBeTypeOf('function');
    const pending = fixture.callbacks.onMeasureFrames!(() => true);
    expect(fixture.open).not.toHaveBeenCalled();
    fixture.releaseDev();
    await pending;
    expect(fixture.open).toHaveBeenCalledExactlyOnceWith(fixture.app);
  });

  it('drops an open superseded while its lazy DEV import was pending, then accepts a current intent', async () => {
    const fixture = await bootWithDeferredDev();
    expect(fixture.callbacks.onMeasureFrames).toBeTypeOf('function');
    let current = true;
    const pending = fixture.callbacks.onMeasureFrames!(() => current);
    current = false;
    fixture.releaseDev();
    await pending;
    expect(fixture.open).not.toHaveBeenCalled();
    await fixture.callbacks.onMeasureFrames!(() => true);
    expect(fixture.open).toHaveBeenCalledExactlyOnceWith(fixture.app);
  });
});
