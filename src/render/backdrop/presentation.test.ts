import { Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as content from '../../content';
import { createRoadNetwork, fixtureNetwork } from '../../road';
import { deferred } from '../presentation.test-util';
import type { PresentationScope } from '../presentation';
import { Backdrop } from './index';

afterEach(() => vi.restoreAllMocks());
const files = import.meta.glob<{ network: string }>('/packs/*/assets/backdrop/*/networks/*.json', {
  eager: true,
  import: 'default',
});
function setup() {
  const bundle = fixtureNetwork([{ id: 'flat', lengthM: 30, kappa: 0 }]);
  const selected = Object.values(files)[0];
  expect(selected).toBeDefined();
  const road = createRoadNetwork({ ...bundle, network: { ...bundle.network, id: selected!.network } });
  let epoch = 0;
  const scope: PresentationScope = {
    capture: () => {
      const captured = epoch;
      return () => captured === epoch;
    },
  };
  const calls: { name: string; answer: ReturnType<typeof deferred<unknown>> }[] = [];
  vi.spyOn(content, 'loadChunk').mockImplementation((name) => {
    const answer = deferred<unknown>();
    calls.push({ name, answer });
    return answer.promise;
  });
  const backdrop = new Backdrop(scope);
  const meshes: Group[] = [];
  const dispose = vi.fn();
  const build = vi.fn(() => {
    const mesh = new Group();
    meshes.push(mesh);
    return { mesh, dispose, update: () => {}, stats: { triangles: 1 } };
  });
  const value = (name: string) =>
    name === 'backdrop builder' ? { buildBackdrop: build, roadPointsOf: () => [] } : { default: {} };
  const settle = async (slice: typeof calls) => {
    for (const c of slice) c.answer.resolve(value(c.name));
    await Promise.all(slice.map((c) => c.answer.promise));
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    backdrop,
    calls,
    road,
    advance: () => {
      epoch++;
    },
    build,
    dispose,
    meshes,
    settle,
    value,
  };
}

describe('Backdrop presentation ownership', () => {
  it.each(['backdrop builder', 'backdrop network', 'backdrop region'])(
    'drops an old %s completion even on the same road/seed, and attaches a current mesh',
    async (edge) => {
      const t = setup();
      t.backdrop.applyPresentation(t.road, 1);
      const old = [...t.calls];
      expect(old.map((c) => c.name)).toContain(edge);
      const held = old.find((c) => c.name === edge)!;
      await t.settle(old.filter((c) => c !== held));
      t.advance();
      t.backdrop.applyPresentation(t.road, 1);
      held.answer.resolve(t.value(edge));
      await held.answer.promise;
      await Promise.resolve();
      await Promise.resolve();
      expect(t.build).not.toHaveBeenCalled();
      expect(t.dispose).not.toHaveBeenCalled();
      expect(t.backdrop.root.children).toEqual([]);
      await t.settle(t.calls.slice(old.length));
      expect(t.build).toHaveBeenCalledOnce();
      expect(t.backdrop.root.children).toContain(t.meshes[0]);
      expect(t.backdrop.status().stats).not.toBeNull();
    },
  );
  it('drops a retired rejection without changing a newer report', async () => {
    const t = setup();
    t.backdrop.applyPresentation(t.road, 1);
    const old = [...t.calls];
    t.advance();
    t.backdrop.applyPresentation(t.road, 1);
    await t.settle(t.calls.slice(old.length));
    old[0]!.answer.reject(new Error('retired error'));
    await old[0]!.answer.promise.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.backdrop.status().error).toBeNull();
    expect(t.build).toHaveBeenCalledOnce();
    t.advance();
    t.backdrop.applyPresentation(t.road, 1);
    t.calls.at(-1)!.answer.reject(new Error('current error'));
    await t.calls.at(-1)!.answer.promise.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.backdrop.status().error).toContain('current error');
  });
});
