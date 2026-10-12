import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudio, type AudioSuspendLeaseResult } from './index';
import { createAudio as createSystem, type AudioSystem } from './system';
import { fakeContextFactory } from './fake-context';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Only promise jobs: no clock or frame waits.
async function jobs() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function held(result: AudioSuspendLeaseResult) {
  expect(result.kind).toBe('acquired');
  if (result.kind !== 'acquired') throw new Error('expected lease');
  return result.lease;
}
const quiet = { radioKeys: null, barkEvents: null, radioSeed: 1 } as const;
function rig() {
  const context = fakeContextFactory();
  const chunks: ReturnType<typeof deferred<typeof import('./system')>>[] = [];
  const systems: AudioSystem[] = [];
  const audio = createAudio({ ...quiet, createContext: context.create }, () => {
    const chunk = deferred<typeof import('./system')>();
    chunks.push(chunk);
    return chunk.promise;
  });
  const install = (
    system = createSystem({ ...quiet, createContext: context.create }),
    index = chunks.length - 1,
  ) => {
    systems.push(system);
    chunks[index]!.resolve({ createAudio: () => system } as typeof import('./system'));
    return system;
  };
  return { audio, context, chunks, systems, install };
}
afterEach(() => vi.restoreAllMocks());

describe('measurement audio suspend lease', () => {
  it.each(['none', 'suspended', 'closed'] as const)(
    'observes %s independently of stopped intent',
    async (state) => {
      const r = rig();
      if (state !== 'none') {
        r.audio.prepare();
        r.context.ctx.state = state;
      }
      const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
      expect(lease.observedState).toBe(state);
      expect(lease.wasRunningIntent).toBe(false);
      lease.release();
      lease.release();
      expect(lease.state).toBe('released');
      expect(r.audio.state()).toBe(state);
    },
  );
  it('captures running intent even when the native context is already suspended', async () => {
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    r.context.ctx.state = 'suspended';
    const resume = vi.spyOn(system, 'resume');
    const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    expect(lease.wasRunningIntent).toBe(true);
    lease.release();
    lease.release();
    await jobs();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(r.audio.state()).toBe('running');
  });
  it.each(['throw', 'reject', 'read', 'running'] as const)(
    'freezes exact refusal for %s',
    async (failure) => {
      const r = rig();
      const system = r.install();
      await jobs();
      await r.audio.resume();
      if (failure === 'throw')
        vi.spyOn(system, 'suspendForLease').mockImplementation(() => {
          throw new Error('native');
        });
      if (failure === 'reject') vi.spyOn(system, 'suspendForLease').mockRejectedValue(new Error('native'));
      if (failure === 'read')
        vi.spyOn(system, 'state').mockImplementation(() => {
          throw new Error('read');
        });
      if (failure === 'running') vi.spyOn(system, 'suspendForLease').mockResolvedValue();
      const result = await r.audio.acquireSuspendLease({ signal: new AbortController().signal });
      expect(result).toEqual({
        kind: 'refused',
        reason:
          failure === 'read'
            ? 'observation-failed'
            : failure === 'running'
              ? 'not-suspended'
              : 'suspend-failed',
        observedState: failure === 'running' ? 'running' : null,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );
  it.each([true, false])(
    'aborts a hung suspension and late completion follows current running intent %s',
    async (running) => {
      const r = rig();
      const system = r.install();
      await jobs();
      await r.audio.resume();
      const native = deferred<void>();
      vi.spyOn(system, 'suspendForLease').mockImplementation(() => native.promise);
      const abort = new AbortController();
      const result = r.audio.acquireSuspendLease({ signal: abort.signal });
      abort.abort();
      expect(await result).toEqual({ kind: 'refused', reason: 'aborted', observedState: null });
      if (!running) r.audio.suspend();
      r.context.ctx.state = 'suspended';
      native.resolve();
      await jobs();
      expect(r.audio.state()).toBe(running ? 'running' : 'suspended');
    },
  );
  it('later ordinary suspend owns intent over held release', async () => {
    const r = rig();
    r.install();
    await jobs();
    await r.audio.resume();
    const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    r.audio.suspend();
    lease.release();
    await jobs();
    expect(r.audio.state()).toBe('suspended');
  });
  it('delayed installation preserves the held generation and release resumes its engine', async () => {
    const r = rig();
    const initial = r.audio.resume();
    const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    const system = r.install();
    const suspend = vi.spyOn(system, 'suspendForLease');
    await initial;
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(r.audio.state()).not.toBe('running');
    lease.release();
    await jobs();
    expect(r.audio.state()).toBe('running');
  });
  it.each(['resume', 'suspend'] as const)(
    'retires a hung private candidate on ordinary %s and keeps its journal for retry',
    async (intent) => {
      const r = rig();
      const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
      r.audio.setEngineSounds({});
      r.audio.setRoad(null, false);
      r.audio.setRadioCut(['first']);
      const first = createSystem(quiet);
      const hang = deferred<void>();
      vi.spyOn(first, 'suspendForLease').mockReturnValue(hang.promise);
      const firstResume = vi.spyOn(first, 'resume');
      r.install(first);
      await jobs();
      r.audio.setRadioCut(['late']);
      const operation = intent === 'resume' ? r.audio.resume() : (r.audio.suspend(), Promise.resolve());
      await jobs();
      if (intent === 'suspend') {
        lease.release();
        void r.audio.resume();
        await jobs();
      }
      expect(r.chunks).toHaveLength(2);
      const second = createSystem({ ...quiet, createContext: r.context.create });
      const order: string[] = [];
      vi.spyOn(second, 'setEngineSounds').mockImplementation(() => {
        order.push('engines');
      });
      vi.spyOn(second, 'setRoad').mockImplementation(() => {
        order.push('road');
      });
      vi.spyOn(second, 'setRadioCut').mockImplementation((refs) => {
        order.push(refs[0]!);
      });
      r.install(second);
      await operation;
      await jobs();
      expect(order).toEqual(['engines', 'road', 'first', 'late']);
      hang.resolve();
      await jobs();
      expect(firstResume).not.toHaveBeenCalled();
      expect(r.audio.state()).toBe('running');
    },
  );
  it.each(['reject', 'read', 'running'] as const)(
    'failed private candidate %s cannot publish or consume configuration',
    async (failure) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const r = rig();
      const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
      r.audio.setRadioCut(['kept']);
      const first = createSystem(quiet);
      if (failure === 'reject') vi.spyOn(first, 'suspendForLease').mockRejectedValue(new Error('native'));
      if (failure === 'read')
        vi.spyOn(first, 'state').mockImplementation(() => {
          throw new Error('read');
        });
      if (failure === 'running') vi.spyOn(first, 'state').mockReturnValue('running');
      const inspect = vi.spyOn(first, 'inspect');
      r.install(first);
      await jobs();
      expect(() => r.audio.inspect()).not.toThrow();
      expect(inspect).not.toHaveBeenCalled();
      expect(r.audio.state()).toBe('none');
      lease.release();
      const operation = r.audio.resume();
      const second = createSystem({ ...quiet, createContext: r.context.create });
      const cuts = vi.spyOn(second, 'setRadioCut');
      r.install(second);
      await operation;
      expect(cuts).toHaveBeenCalledExactlyOnceWith(['kept']);
      expect(r.audio.state()).toBe('running');
    },
  );
  it('load fulfillment during pending acquisition stays private until quiet and preserves ownership', async () => {
    const r = rig();
    const start = r.audio.resume();
    const native = deferred<void>();
    vi.spyOn(r.context.ctx, 'suspend').mockImplementation(() => native.promise);
    const acquisition = r.audio.acquireSuspendLease({ signal: new AbortController().signal });
    const candidate = createSystem({ ...quiet, createContext: r.context.create });
    const candidateNative = deferred<void>();
    vi.spyOn(candidate, 'suspendForLease').mockReturnValue(candidateNative.promise);
    const inspect = vi.spyOn(candidate, 'inspect');
    r.install(candidate);
    await jobs();
    r.audio.inspect();
    expect(inspect).not.toHaveBeenCalled();
    r.context.ctx.state = 'suspended';
    native.resolve();
    const lease = held(await acquisition);
    candidateNative.resolve();
    await start;
    lease.release();
    await jobs();
    expect(r.audio.state()).toBe('running');
  });
  it('ordinary mutation promptly retires a hung acquisition without requiring caller abort', async () => {
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    const native = deferred<void>();
    vi.spyOn(system, 'suspendForLease').mockReturnValue(native.promise);
    const acquisition = r.audio.acquireSuspendLease({ signal: new AbortController().signal });
    await r.audio.resume();
    expect(await acquisition).toEqual({ kind: 'refused', reason: 'aborted', observedState: null });
    r.audio.suspend();
    native.resolve();
    await jobs();
    expect(r.audio.state()).toBe('running');
    // The mocked primitive did not change native state: logical suspend alone is never quiet evidence.
  });
  it('native resume completion after ordinary suspend reconciles stopped intent', async () => {
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    const resumeNative = deferred<void>();
    vi.spyOn(system, 'resume').mockReturnValue(resumeNative.promise);
    const operation = r.audio.resume();
    r.audio.suspend();
    r.context.ctx.state = 'running';
    resumeNative.resolve();
    await operation;
    await jobs();
    expect(r.audio.state()).toBe('suspended');
  });
  it('a reentrant state observation cannot grant an obsolete lease', async () => {
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    vi.spyOn(system, 'state').mockImplementationOnce(() => {
      r.audio.suspend();
      return 'suspended';
    });
    expect(await r.audio.acquireSuspendLease({ signal: new AbortController().signal })).toEqual({
      kind: 'refused',
      reason: 'aborted',
      observedState: null,
    });
    await jobs();
    expect(r.audio.state()).toBe('suspended');
  });
  it('the lower primitive waits for native suspend and propagates failure', async () => {
    const context = fakeContextFactory();
    const system = createSystem({ ...quiet, createContext: context.create });
    await system.resume();
    const native = deferred<void>();
    vi.spyOn(context.ctx, 'suspend').mockReturnValue(native.promise);
    let settled = false;
    const operation = system.suspendForLease().then(() => {
      settled = true;
    });
    await jobs();
    expect(settled).toBe(false);
    native.resolve();
    await operation;
    expect(settled).toBe(true);
    vi.spyOn(context.ctx, 'suspend').mockRejectedValue(new Error('native'));
    await expect(system.suspendForLease()).rejects.toThrow('native');
  });
  it('stopped logical intent with a running native context still requires actual suspension', async () => {
    const r = rig();
    r.audio.prepare();
    r.context.ctx.state = 'running';
    const native = deferred<void>();
    vi.spyOn(r.context.ctx, 'suspend').mockReturnValue(native.promise);
    let settled = false;
    const acquisition = r.audio
      .acquireSuspendLease({ signal: new AbortController().signal })
      .then((result) => {
        settled = true;
        return result;
      });
    await jobs();
    expect(settled).toBe(false);
    r.context.ctx.state = 'suspended';
    native.resolve();
    const lease = held(await acquisition);
    expect(lease.wasRunningIntent).toBe(false);
    lease.release();
    await jobs();
    expect(r.audio.state()).toBe('suspended');
  });
  it('contains rejected restoration resume and later native rejection after cancellation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    vi.spyOn(system, 'resume').mockRejectedValue(new Error('resume refused'));
    const native = deferred<void>();
    vi.spyOn(system, 'suspendForLease').mockReturnValue(native.promise);
    const abort = new AbortController();
    const acquisition = r.audio.acquireSuspendLease({ signal: abort.signal });
    abort.abort();
    expect((await acquisition).kind).toBe('refused');
    native.reject(new Error('suspend refused'));
    await jobs();
    expect(console.warn).toHaveBeenCalled();
  });
  it.each([true, false])(
    'late retired candidate native completion repairs current running intent %s',
    async (running) => {
      const r = rig();
      held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
      const first = createSystem(quiet);
      const native = deferred<void>();
      vi.spyOn(first, 'suspendForLease').mockReturnValue(native.promise);
      r.install(first);
      await jobs();
      const operation = r.audio.resume();
      const second = r.install();
      await operation;
      if (!running) r.audio.suspend();
      // The obsolete native operation acts on the shared device after the replacement has installed.
      r.context.ctx.state = 'suspended';
      native.resolve();
      await jobs();
      expect(r.audio.state()).toBe(running ? 'running' : 'suspended');
      expect(second).toBe(r.systems[1]);
    },
  );
  it('a failed candidate keeps calls appended during its native await for the retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig();
    held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    r.audio.setEngineSounds({});
    const first = createSystem(quiet);
    const native = deferred<void>();
    vi.spyOn(first, 'suspendForLease').mockReturnValue(native.promise);
    r.install(first);
    await jobs();
    r.audio.setRoad(null);
    r.audio.setRadioCut(['late']);
    native.reject(new Error('refused'));
    await jobs();
    const operation = r.audio.resume();
    const second = createSystem({ ...quiet, createContext: r.context.create });
    const order: string[] = [];
    vi.spyOn(second, 'setEngineSounds').mockImplementation(() => {
      order.push('engines');
    });
    vi.spyOn(second, 'setRoad').mockImplementation(() => {
      order.push('road');
    });
    vi.spyOn(second, 'setRadioCut').mockImplementation(() => {
      order.push('cut');
    });
    r.install(second);
    await operation;
    expect(order).toEqual(['engines', 'road', 'cut']);
    r.audio.setRadioCut(['direct']);
    expect(order).toEqual(['engines', 'road', 'cut', 'cut']);
  });
  it('release during hung candidate reconciliation retires it and restores running through a fresh load', async () => {
    const r = rig();
    const initial = r.audio.resume();
    const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    const first = createSystem(quiet);
    vi.spyOn(first, 'suspendForLease').mockReturnValue(deferred<void>().promise);
    r.install(first);
    await jobs();
    lease.release();
    await initial;
    expect(r.chunks).toHaveLength(2);
    r.install();
    await jobs();
    expect(r.audio.state()).toBe('running');
  });
  it('an already aborted request calls no native suspend and restores its captured intent', async () => {
    const r = rig();
    const system = r.install();
    await jobs();
    await r.audio.resume();
    const suspend = vi.spyOn(system, 'suspendForLease');
    const abort = new AbortController();
    abort.abort();
    expect(await r.audio.acquireSuspendLease({ signal: abort.signal })).toEqual({
      kind: 'refused',
      reason: 'aborted',
      observedState: null,
    });
    expect(suspend).not.toHaveBeenCalled();
    await jobs();
    expect(r.audio.state()).toBe('running');
  });
  it('a published but unbuilt graph cannot hide the running tap context from acquisition', async () => {
    const r = rig();
    const tap = deferred<void>();
    vi.spyOn(r.context.ctx, 'resume').mockImplementation(() => {
      r.context.ctx.state = 'running';
      return tap.promise;
    });
    const ordinary = r.audio.resume();
    r.chunks[0]!.resolve({ createAudio: (opts) => createSystem(opts) } as typeof import('./system'));
    await jobs();
    const suspend = vi.spyOn(r.context.ctx, 'suspend');
    const lease = held(await r.audio.acquireSuspendLease({ signal: new AbortController().signal }));
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(lease.observedState).toBe('suspended');
    expect(r.context.ctx.state).toBe('suspended');
    tap.resolve();
    await ordinary;
    r.audio.suspend();
    lease.release();
    await jobs();
    expect(r.context.ctx.state).toBe('suspended');
  });
});
