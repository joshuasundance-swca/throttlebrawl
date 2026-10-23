import { describe, expect, it, vi } from 'vitest';
import { createReplayViewer, type ReplayViewerPrepared, type ReplayViewerPorts } from './replay-viewer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function rig() {
  let held = false;
  const inputRelease = vi.fn();
  const audioRelease = vi.fn();
  const wakeRelease = vi.fn();
  const step = vi.fn();
  const prepared = {
    playback: { curr: { tick: 0 }, durationTicks: 60, complete: false, step },
    camera: {},
  } as unknown as ReplayViewerPrepared;
  const show = vi.fn<ReplayViewerPorts['show']>();
  const ports: ReplayViewerPorts = {
    prepare: vi.fn(() => Promise.resolve(prepared)),
    acquireInput: vi.fn(() => ({ release: inputRelease })),
    acquireAudio: vi.fn(() =>
      Promise.resolve({ kind: 'acquired' as const, lease: { release: audioRelease } }),
    ),
    acquireWake: vi.fn(() => Promise.resolve({ kind: 'acquired' as const, lease: { release: wakeRelease } })),
    held: () => held,
    commit: vi.fn(),
    restore: vi.fn(),
    show,
    resetClock: vi.fn(),
    invalidatePose: vi.fn(),
    entryFailed: vi.fn(),
  };
  const viewer = createReplayViewer(ports);
  return {
    viewer,
    ports,
    prepared,
    show,
    inputRelease,
    audioRelease,
    wakeRelease,
    step,
    hold: (on: boolean) => {
      held = on;
    },
  };
}

describe('the results replay viewer owns only its playback resources', () => {
  it('quarantines input before loading and restores its owner once on return', async () => {
    const r = rig();
    expect(r.ports.acquireInput).toHaveBeenCalledOnce();
    await r.viewer.start();
    expect(r.ports.commit).toHaveBeenCalledWith(r.prepared);
    expect(r.viewer.playing).toBe(true);
    r.viewer.dispose();
    r.viewer.dispose();
    expect(r.inputRelease).toHaveBeenCalledOnce();
    expect(r.audioRelease).toHaveBeenCalledOnce();
    expect(r.wakeRelease).toHaveBeenCalledOnce();
    expect(r.ports.restore).toHaveBeenCalledOnce();
  });

  it('never commits a late preparation after Return', async () => {
    const r = rig();
    const load = deferred<ReplayViewerPrepared>();
    vi.mocked(r.ports.prepare).mockReturnValue(load.promise);
    const pending = r.viewer.start();
    r.viewer.dispose();
    load.resolve(r.prepared);
    await pending;
    expect(r.ports.commit).not.toHaveBeenCalled();
    expect(r.audioRelease).toHaveBeenCalledOnce();
    expect(r.ports.restore).toHaveBeenCalledOnce();
  });

  it('releases a late audio lease after Return without entering the scene', async () => {
    const r = rig();
    const audio = deferred<Awaited<ReturnType<ReplayViewerPorts['acquireAudio']>>>();
    vi.mocked(r.ports.acquireAudio).mockReturnValue(audio.promise);
    const pending = r.viewer.start();
    r.viewer.dispose();
    audio.resolve({ kind: 'acquired', lease: { release: r.audioRelease } });
    await pending;
    expect(r.audioRelease).toHaveBeenCalledOnce();
    expect(r.ports.commit).not.toHaveBeenCalled();
  });

  it('restores the original result if silence cannot be acquired', async () => {
    const r = rig();
    vi.mocked(r.ports.acquireAudio).mockResolvedValue({ kind: 'refused' });
    await r.viewer.start();
    expect(r.ports.commit).not.toHaveBeenCalled();
    expect(r.ports.restore).toHaveBeenCalledOnce();
    expect(r.inputRelease).toHaveBeenCalledOnce();
    expect(r.ports.entryFailed).toHaveBeenCalledOnce();
  });

  it('requires explicit Play after interruption, even when the hold disappears', async () => {
    const r = rig();
    await r.viewer.start();
    r.hold(true);
    r.viewer.pause();
    r.viewer.step();
    expect(r.viewer.playing).toBe(false);
    expect(r.step).not.toHaveBeenCalled();
    r.hold(false);
    expect(r.viewer.playing).toBe(false);
    r.viewer.toggle();
    expect(r.viewer.playing).toBe(true);
    expect(r.ports.acquireWake).toHaveBeenCalledTimes(2);
  });

  it('loads into a paused state if visibility changes during preparation', async () => {
    const r = rig();
    const load = deferred<ReplayViewerPrepared>();
    vi.mocked(r.ports.prepare).mockReturnValue(load.promise);
    const pending = r.viewer.start();
    r.hold(true);
    r.viewer.pause();
    load.resolve(r.prepared);
    await pending;
    r.hold(false);
    expect(r.viewer.playing).toBe(false);
    expect(r.show.mock.calls.at(-1)?.[0].status).toBe('paused');
    expect(r.ports.acquireWake).not.toHaveBeenCalled();
  });

  it('treats wake refusal as best effort and wake loss as an explicit pause', async () => {
    const r = rig();
    vi.mocked(r.ports.acquireWake).mockResolvedValueOnce({ kind: 'refused' });
    await r.viewer.start();
    expect(r.viewer.playing).toBe(true);
    r.viewer.pause();
    r.viewer.toggle();
    vi.mocked(r.ports.acquireWake).mock.calls.at(-1)![0].onLost();
    expect(r.viewer.playing).toBe(false);
    r.viewer.toggle();
    expect(r.viewer.playing).toBe(true);
    expect(r.ports.acquireWake).toHaveBeenCalledTimes(3);
  });

  it('ignores an obsolete wake request after restart and releases its lease', async () => {
    const r = rig();
    const wake = deferred<Awaited<ReturnType<ReplayViewerPorts['acquireWake']>>>();
    vi.mocked(r.ports.acquireWake).mockReturnValueOnce(wake.promise);
    await r.viewer.start();
    await r.viewer.restart();
    const oldRelease = vi.fn();
    wake.resolve({ kind: 'acquired', lease: { release: oldRelease } });
    await Promise.resolve();
    expect(oldRelease).toHaveBeenCalledOnce();
    expect(r.viewer.playing).toBe(true);
    expect(r.ports.commit).toHaveBeenCalledTimes(2);
    expect(r.ports.acquireInput).toHaveBeenCalledOnce();
    expect(r.ports.acquireAudio).toHaveBeenCalledOnce();
  });

  it('stops on verified completion and keeps camera choices local', async () => {
    const r = rig();
    await r.viewer.start();
    r.viewer.cycleCamera();
    expect(r.viewer.mode).toBe('orbit');
    vi.mocked(r.step).mockImplementation(() => {
      Object.defineProperty(r.prepared.playback, 'complete', { value: true });
    });
    r.viewer.step();
    r.viewer.step();
    expect(r.step).toHaveBeenCalledOnce();
    expect(r.viewer.playing).toBe(false);
    expect(r.show.mock.calls.at(-1)?.[0].status).toBe('complete');
    expect(r.ports.restore).not.toHaveBeenCalled();
    r.viewer.toggle();
    expect(r.viewer.playing).toBe(false);
  });

  it('keeps a desync stopped and recoverable by Return or a fresh restart', async () => {
    const r = rig();
    await r.viewer.start();
    vi.mocked(r.step).mockImplementation(() => {
      throw new Error('desync');
    });
    r.viewer.step();
    r.viewer.step();
    expect(r.step).toHaveBeenCalledOnce();
    expect(r.show.mock.calls.at(-1)?.[0].status).toBe('failed');
    r.viewer.toggle();
    expect(r.viewer.playing).toBe(false);
    await r.viewer.restart();
    expect(r.viewer.playing).toBe(true);
    r.viewer.dispose();
    expect(r.ports.restore).toHaveBeenCalledOnce();
  });
});
