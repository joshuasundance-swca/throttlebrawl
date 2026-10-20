import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { canvasFake, deferred, NativeRendererFake } from './presentation.test-util';
import { createRenderer, type RendererPresentationRecipe } from './index';
import * as gateModule from './chunk-gate';
import * as roadModule from './road-mesh';
import * as backdropModule from './backdrop';
import type { ChunkLoader } from './chunk-gate';
import { EntityViews } from './views';
import { riderLookOf } from './rider-looks';
import * as roadApi from '../road';
import type { SimEvent, SimSnapshot, SimTrafficTypeDef } from '../sim/api';

vi.mock('three', async (original) => {
  const { NativeRendererFake } = await import('./presentation.test-util');
  return { ...(await original<typeof import('three')>()), WebGLRenderer: NativeRendererFake };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const recipe = (): RendererPresentationRecipe => ({
  road: createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 80, kappa: 0 }])),
  env: { timeOfDay: 'day' },
  dressing: undefined,
  boards: undefined,
  trafficTypes: [],
  riderLooks: [],
  playerPaint: null,
  sceneSeed: 9,
  look: 'classic',
  quality: { tier: 'high', scale: 1 },
});
const trafficDef = (contentId: string, heightM: number): SimTrafficTypeDef => ({
  contentId,
  category: 'truck',
  lengthM: 7,
  widthM: 2.5,
  cruiseMps: 20,
  hazard: 'big',
  heightM,
});

const families = [
  'film pass',
  'race parts',
  'rider rigs',
  'verge',
  'airboats',
  'party lights',
  'Pacific Northwest places',
  'Pacific Northwest places layout',
  'waterfront',
  'waterfront layout',
  'Chinatown and North Beach',
  'mural alleys',
  'landmarks',
  'roadside scenes',
  'text surfaces',
  'models',
  'roadside',
  'downtown',
] as const;

function asyncScene(nestedFamily?: string) {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const calls: { name: string; answer: ReturnType<typeof deferred<unknown>> }[] = [];
  const installed: string[] = [];
  const disposed: string[] = [];
  const riderArrays: unknown[][] = [];
  const retries: (() => void)[] = [];
  const updates: { name: string; args: unknown[] }[] = [];
  const layers: {
    name: string;
    root: Group;
    pending: readonly SimEvent[];
    hidden: Set<string>;
    structures: unknown[];
  }[] = [];
  const constructors: { name: string; args: unknown[] }[] = [];
  const nested: { name: string; answer: ReturnType<typeof deferred<unknown>>; value: unknown }[] = [];
  const result = (name: string, value: unknown): Promise<unknown> => {
    if (name !== nestedFamily) return Promise.resolve(value);
    const answer = deferred<unknown>();
    nested.push({ name, answer, value });
    return answer.promise;
  };
  const load: ChunkLoader = (name) => {
    const answer = deferred<unknown>();
    calls.push({ name, answer });
    return answer.promise as Promise<never>;
  };
  const original = gateModule.createChunkGate;
  vi.spyOn(gateModule, 'createChunkGate').mockImplementation((_load, scope) => {
    const gate = original(load, scope);
    return {
      ...gate,
      later: (ask) => {
        retries.push(ask);
        gate.later(ask);
      },
    };
  });
  vi.spyOn(backdropModule, 'backdropFilesFor').mockReturnValue({
    network: '/probe/network',
    region: '/packs/base/assets/backdrop/probe/region.json',
  });
  // Its actual Backdrop has no files for this fixture ID; the road-water request is independently controlled.
  const waters: ReturnType<typeof deferred<((x: number, z: number) => number | null) | null>>[] = [];
  vi.spyOn(backdropModule, 'loadNetworkWater').mockImplementation(() => {
    const answer = deferred<((x: number, z: number) => number | null) | null>();
    waters.push(answer);
    return answer.promise;
  });
  vi.spyOn(roadModule, 'buildRoadScene').mockImplementation(
    () =>
      ({
        group: new Group(),
        stats: { setPieces: [] },
        spots: [],
        landReach: () => 10,
        landTop: () => 0,
        update: () => 1,
        dispose: () => disposed.push('road'),
      }) as unknown as ReturnType<typeof roadModule.buildRoadScene>,
  );
  const layer = (name: string) =>
    class {
      group = new Group();
      root = this.group;
      tint = new Group();
      ready = true;
      pending: readonly SimEvent[] = [];
      hidden = new Set<string>();
      structures: unknown[] = [];
      name = name;
      constructor(...args: unknown[]) {
        constructors.push({ name, args });
        installed.push(name);
        this.group.name = name;
        layers.push(this);
      }
      dispose() {
        disposed.push(name);
      }
      surfaces() {
        return [{}];
      }
      reserved() {
        return [];
      }
      setFronts() {}
      setRoad() {}
      setStructures(plan: unknown) {
        this.structures.push(plan);
      }
      hide(refs: Iterable<string>) {
        for (const ref of refs) this.hidden.add(ref);
      }
      pendingEvents() {
        return [...this.pending];
      }
      setCamera() {}
      setView() {}
      setPlayerPaint() {}
      setLooks(looks: readonly unknown[]) {
        riderArrays.push([...looks]);
      }
      invalidatePresentation() {}
      set() {}
      build(...args: unknown[]) {
        updates.push({ name: `${name} build`, args });
      }
      visibleContent() {
        return [];
      }
      pick() {
        return null;
      }
      fitTint() {}
      resetTransient() {
        this.pending = [];
      }
      pushEvents(events: readonly SimEvent[]) {
        this.pending = [...this.pending, ...events];
      }
      update(...args: unknown[]) {
        updates.push({ name, args });
        return 1;
      }
      sync() {}
      render() {}
      endFrame() {}
      setTreeShare() {}
      counts() {
        return {};
      }
      count() {
        return 0;
      }
      batches() {
        return { still: {} };
      }
    };
  const kit = { variants: [], roles: [] };
  const modules: Record<string, unknown> = {
    'film pass': { LookPost: layer('film pass') },
    'race parts': {
      Boards: layer('boards'),
      FeelEffects: layer('effects'),
      SpeedLines: layer('lines'),
      Rain: layer('rain'),
      EventProps: layer('events'),
      Smashables: layer('smashables'),
      AirPays: layer('air pays'),
      TerrainTrees: layer('terrain trees'),
      rainColourOf: () => null,
    },
    'rider rigs': { RiderRigs: layer('rider rigs') },
    verge: { VergeLayer: layer('verge') },
    airboats: { AirboatLayer: layer('airboats'), airboatRuns: () => [{}] },
    'party lights': { PartyLights: layer('party lights') },
    'Pacific Northwest places': {
      PnwPlacesLayer: layer('Pacific Northwest places'),
      hasPnwPlaces: () => true,
    },
    'Pacific Northwest places layout': { pnwPlacesLayout: () => ({}) },
    waterfront: { WaterfrontLayer: layer('waterfront'), hasWaterfront: () => true },
    'waterfront layout': { waterfrontLayout: () => ({}) },
    'Chinatown and North Beach': { BlocksLayer: layer('Chinatown and North Beach') },
    'mural alleys': { MissionLayer: layer('mural alleys'), raceShare: () => 0 },
    landmarks: {
      LandmarkLayer: layer('landmarks'),
      landmarkKitsFor: () => [],
      landmarkFootprints: () => [],
      loadLandmarkKits: () => result('landmarks', new Map()),
    },
    'roadside scenes': {
      ScenesLayer: layer('roadside scenes'),
      loadScenes: () => result('roadside scenes', { pack: 'base', file: {} }),
    },
    'text surfaces': { TextSurfaceLayer: layer('text surfaces') },
    models: {
      modelKindsFor: () => ['sfDowntown', 'sfRoadside'],
      retryableKinds: () => [],
      mergeModelReports: (_old: unknown, next: unknown) => next,
      paintModel: (model: unknown) => model,
      loadSceneryModels: () =>
        result('models', {
          models: { sfDowntown: kit, sfRoadside: kit },
          report: { loaded: ['sfDowntown', 'sfRoadside'], fellBack: [] },
        }),
    },
    roadside: { RoadsideLayer: layer('roadside'), kitFor: () => 'sfRoadside', KITS: { sfRoadside: {} } },
    downtown: { DowntownLayer: layer('downtown'), hasPortland: () => false, hasDowntown: () => true },
  };
  const baked = fixtureNetwork([{ id: 'flat', lengthM: 80, kappa: 0 }]);
  const nextRecipe = {
    ...recipe(),
    road: createRoadNetwork({
      ...baked,
      roads: baked.roads.map((road) => ({
        ...road,
        features: [{ id: 'probe-landmark', kind: 'landmark', s0: 0, s1: 1, d0: 0, d1: 1 }],
      })),
    }),
  };
  const pick: RendererPresentationRecipe = {
    ...nextRecipe,
    look: 'kodak',
    dressing: {
      flat: {
        tags: ['airboats', 'ferry', 'promenade', 'lanterns', 'murals'].map((tag) => ({
          tag,
          s0: 0,
          s1: 80,
          side: 'both' as const,
        })),
        features: [{ kind: 'roadsideZone', s0: 0, s1: 80, d0: 0, d1: 1, params: { dressing: 'party' } }],
      },
    },
  };
  const renderer = createRenderer(canvasFake(), { assets: {} as never });
  const resolve = async (call: (typeof calls)[number], value = modules[call.name]) => {
    call.answer.resolve(value);
    await call.answer.promise;
    // Drain dependency continuations by their promise turns, never by clock/frame count.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const settleCurrent = async (start: number) => {
    const settled = new Set<(typeof calls)[number]>();
    for (;;) {
      const next = calls.slice(start).find((c) => !settled.has(c));
      if (!next) break;
      settled.add(next);
      await resolve(next);
    }
  };
  return {
    renderer,
    pick,
    calls,
    installed,
    disposed,
    resolve,
    settleCurrent,
    waters,
    nested,
    riderArrays,
    retries,
    updates,
    layers,
    constructors,
  };
}

describe('presentation ownership at every top-level renderer chunk edge', () => {
  it('rejects stale road-water completion on the same road and permits the current rebuild', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    const old = t.waters[0]!;
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    const before = [...t.disposed];
    old.resolve(() => 2);
    await old.promise;
    await Promise.resolve();
    expect(t.disposed).toEqual(before);
    const current = t.waters[1]!;
    current.resolve(() => 3);
    await current.promise;
    await Promise.resolve();
    expect(t.disposed.length).toBeGreaterThan(before.length);
  });
  it.each(
    families.flatMap((family) => [
      { family, failed: false },
      { family, failed: true },
    ]),
  )(
    'retires delayed $family (failed=$failed) assignment/build/retry and permits the current positive control',
    async ({ family, failed }) => {
      const t = asyncScene();
      t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
      // Resolve prerequisites until the named request exists, retaining that request itself.
      const settled = new Set<(typeof t.calls)[number]>();
      while (!t.calls.some((c) => c.name === family)) {
        const next = t.calls.find((c) => c.name !== family && !settled.has(c));
        if (!next) throw new Error(`fixture failed to request ${family}`);
        settled.add(next);
        await t.resolve(next);
      }
      const old = t.calls.find((c) => c.name === family)!;
      const boundary = t.calls.length;
      t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
      const before = [...t.installed];
      const disposal = [...t.disposed];
      const retries = [...t.retries];
      await t.resolve(old, failed ? null : undefined);
      expect(t.installed).toEqual(before);
      expect(t.disposed).toEqual(disposal);
      expect(t.retries).toEqual(retries);
      await t.settleCurrent(boundary);
      const label =
        family === 'race parts'
          ? 'effects'
          : family === 'waterfront layout'
            ? 'waterfront'
            : family === 'Pacific Northwest places layout'
              ? 'Pacific Northwest places'
              : family === 'models'
                ? 'downtown'
                : family;
      expect(t.installed, family).toContain(label);
    },
  );

  it.each(['models', 'landmarks', 'roadside scenes'])(
    'rejects retired %s data after the inner await, then installs the current positive result',
    async (family) => {
      const t = asyncScene(family);
      t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
      await t.settleCurrent(0);
      expect(t.nested.length, family).toBeGreaterThan(0);
      const old = t.nested[0]!;
      const boundary = t.calls.length;
      t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
      const before = [...t.installed];
      const disposal = [...t.disposed];
      old.answer.resolve(old.value);
      await old.answer.promise;
      await Promise.resolve();
      await Promise.resolve();
      expect(t.installed).toEqual(before);
      expect(t.disposed).toEqual(disposal);
      if (family === 'models') expect(t.renderer.scenery().models).toBeNull();
      await t.settleCurrent(boundary);
      const current = t.nested.at(-1)!;
      expect(current).not.toBe(old);
      current.answer.resolve(current.value);
      await current.answer.promise;
      await Promise.resolve();
      await Promise.resolve();
      await t.settleCurrent(boundary);
      expect(t.installed).toContain(family === 'models' ? 'downtown' : family);
      if (family === 'models') expect(t.renderer.scenery().models!.loaded.length).toBeGreaterThan(0);
    },
  );
});
describe('atomic renderer presentation', () => {
  it('holds authored physical scenery until its current drawing chunk arrives, with a legacy control', async () => {
    const t = asyncScene();
    expect(t.renderer.physicalWorldReady!()).toBe(true);
    const bundle = fixtureNetwork([{ id: 'terrain', lengthM: 80, kappa: 0 }]);
    const road = createRoadNetwork({ ...bundle, network: { ...bundle.network, terrain: { patches: [] } } });
    t.renderer.applyPresentation({ ...t.pick, road }, { reset: 'preserve' });
    expect(t.renderer.physicalWorldReady!()).toBe(false);
    const pending = t.calls.filter((call) => call.name === 'race parts').at(-1)!;
    await t.resolve(pending, null);
    expect(t.renderer.physicalWorldReady!()).toBe(false);
    t.renderer.setRiderLooks([]); // the existing retry boundary
    t.renderer.render(null, null, 0, { x: 0, y: 2, z: 0, lookX: 0, lookY: 0, lookZ: -1, fov: 62 });
    await t.resolve(t.calls.filter((call) => call.name === 'race parts').at(-1)!);
    expect(t.renderer.physicalWorldReady!()).toBe(true);
    expect(t.installed).toContain('terrain trees');
  });
  it('installs late boards for the current road and catalog with pending vetoes, then keeps their root across resets', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    const retired = t.calls.filter((call) => call.name === 'race parts').at(-1)!;
    const catalog = { items: {} };
    const next = { ...recipe(), boards: catalog };
    t.renderer.applyPresentation(next, { reset: 'measurement-to-menu' });
    t.renderer.hideContent(['probe:hidden-before-load']);
    expect(t.renderer.visibleContent()).toEqual([]);
    expect(t.renderer.pickContentAt(10, 10)).toBeNull();
    await t.resolve(retired);
    expect(t.installed).not.toContain('boards');
    await t.resolve(t.calls.filter((call) => call.name === 'race parts').at(-1)!);
    const boards = t.layers.find((layer) => layer.name === 'boards')!;
    expect(boards).toBeDefined();
    expect(boards.hidden.has('probe:hidden-before-load')).toBe(true);
    expect(t.updates.filter((update) => update.name === 'boards build').at(-1)!.args).toEqual([
      next.road,
      expect.any(Function),
      catalog,
    ]);
    const scene = boards.root.parent;
    expect(scene).not.toBeNull();
    t.renderer.applyPresentation(t.pick, { reset: 'measurement-to-menu' });
    expect(boards.root.parent).toBe(scene);
    expect(t.layers.filter((layer) => layer.name === 'boards')).toEqual([boards]);
    expect(t.updates.filter((update) => update.name === 'boards build').at(-1)!.args[0]).toBe(t.pick.road);
    expect(t.updates.filter((update) => update.name === 'boards build').at(-1)!.args[2]).toBeUndefined();
    expect(boards.hidden.has('probe:hidden-before-load')).toBe(true);
  });

  it('keeps rendering without boards after chunk failure and installs them through the existing retry', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    await t.resolve(t.calls.filter((call) => call.name === 'race parts').at(-1)!, null);
    const native = NativeRendererFake.instances.at(-1)!;
    const before = native.draws.length;
    t.renderer.setRiderLooks([]);
    t.renderer.render(null, null, 0, { x: 0, y: 2, z: 0, lookX: 0, lookY: 0, lookZ: -1, fov: 60 });
    expect(native.draws.length).toBe(before + 1);
    expect(t.installed).not.toContain('boards');
    await t.resolve(t.calls.filter((call) => call.name === 'race parts').at(-1)!);
    expect(t.installed).toContain('boards');
  });

  it('gives a late race-parts landing layer the current roof plan and its queued newspaper crash', async () => {
    const t = asyncScene();
    const plan = {} as NonNullable<ReturnType<typeof roadApi.structuresOf>>;
    vi.spyOn(roadApi, 'structuresOf').mockReturnValue(plan);
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    const snap: SimSnapshot = {
      tick: 1,
      entities: [],
      timeScale: 1,
      race: { over: false, routeLength: 1, finishOrder: [] },
    };
    t.renderer.render(snap, snap, 1, { x: 0, y: 2, z: 0, lookX: 0, lookY: 0, lookZ: -1, fov: 60 });
    const crash: SimEvent = {
      tick: 1,
      type: 'crash',
      actor: 0,
      data: { attempt: 'newspaper' },
    };
    t.renderer.pushEvents([crash]);
    await t.resolve(t.calls.filter((call) => call.name === 'race parts').at(-1)!);

    const air = t.layers.filter((layer) => layer.name === 'air pays').at(-1)!;
    expect(air.structures).toEqual([plan]);
    expect(air.pending).toEqual([crash]);
    t.renderer.applyPresentation(t.pick, { reset: 'measurement-to-menu' });
    expect(air.structures).toEqual([plan, null]);
    expect(air.pending).toEqual([]);
  });

  it('retains warmed modules, veto refs, render tuning and reduce-motion through reset', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    await t.settleCurrent(0);
    const param = t.constructors.find((c) => c.name === 'effects')!.args[1] as {
      sceneryDrawM: number;
      reduceMotion?: boolean;
    };
    t.renderer.setParam('render.sceneryDrawM', 321);
    t.renderer.setReduceMotion(true);
    expect(param.sceneryDrawM).toBe(321);
    expect(param.reduceMotion).toBe(true);
    t.renderer.hideContent(['probe:veto']);
    expect(
      t.layers
        .filter((l) => l.name === 'roadside scenes')
        .at(-1)!
        .hidden.has('probe:veto'),
    ).toBe(true);
    const boundary = t.calls.length;
    t.renderer.applyPresentation(t.pick, { reset: 'measurement-to-menu' });
    expect(param.sceneryDrawM).toBe(321);
    expect(param.reduceMotion).toBe(true);
    expect(t.calls.slice(boundary).map((c) => c.name)).not.toContain('race parts');
    expect(t.calls.slice(boundary).map((c) => c.name)).not.toContain('rider rigs');
    expect(t.calls.slice(boundary).map((c) => c.name)).not.toContain('film pass');
    expect(t.calls.slice(boundary).map((c) => c.name)).not.toContain('verge');
    const text = t.constructors.filter((c) => c.name === 'text surfaces').at(-1)!;
    expect((text.args[2] as { hidden: Set<string> }).hidden.has('probe:veto')).toBe(true);
  });
  it('preserves a queued verge event through coherent rebuild, while menu reset clears it', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    await t.settleCurrent(0);
    const event: SimEvent = { tick: 1, type: 'wobble', actor: 7, data: { cause: 'fence' } };
    t.renderer.pushEvents([event]);
    expect(t.layers.filter((l) => l.name === 'verge').at(-1)!.pending).toEqual([event]);
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    expect(t.layers.filter((l) => l.name === 'verge').at(-1)!.pending).toEqual([event]);
    t.renderer.applyPresentation(t.pick, { reset: 'measurement-to-menu' });
    expect(t.layers.filter((l) => l.name === 'verge').at(-1)!.pending).toEqual([]);
  });
  it('resets frame and downtown/mission clocks, scenery counts and the plan pointer before the restored CPU draw', async () => {
    const t = asyncScene();
    t.renderer.applyPresentation(t.pick, { reset: 'preserve' });
    await t.settleCurrent(0);
    t.renderer.setLook('classic');
    const plan = {} as NonNullable<ReturnType<typeof roadApi.structuresOf>>;
    vi.spyOn(roadApi, 'structuresOf').mockReturnValue(plan);
    let at = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => at);
    const snap: SimSnapshot = {
      tick: 1,
      entities: [],
      timeScale: 1,
      race: { over: false, routeLength: 1, finishOrder: [] },
    };
    const pose = { x: 0, y: 2, z: 0, lookX: 0, lookY: 0, lookZ: -1, fov: 60 };
    const draw = (ms: number) => {
      at = ms;
      t.renderer.render(snap, snap, 1, pose);
    };
    draw(0);
    draw(100);
    draw(200);
    draw(300);
    draw(400);
    expect(t.renderer.structures()).toBe(plan);
    expect(t.renderer.scenery().visible).toBeGreaterThan(0);
    expect(t.updates.filter((u) => u.name === 'downtown').at(-1)!.args[2]).toBe(0);
    expect(t.updates.filter((u) => u.name === 'mural alleys').at(-1)!.args[2]).toBe(0);
    t.renderer.applyPresentation({ ...t.pick, look: 'classic' }, { reset: 'measurement-to-menu' });
    expect(t.renderer.structures()).toBeNull();
    expect(t.renderer.scenery().visible).toBe(0);
    draw(1000);
    expect(t.updates.filter((u) => u.name === 'lines').at(-1)!.args[1]).toBe(0);
    expect(t.renderer.structures()).toBe(plan);
    draw(1100);
    expect(t.updates.filter((u) => u.name === 'downtown').at(-1)!.args[2]).toBeGreaterThan(0);
    expect(t.updates.filter((u) => u.name === 'mural alleys').at(-1)!.args[2]).toBeGreaterThan(0);
  });
  it('owns both recipe arrays and installs every recipe field with one synchronous road build', async () => {
    const t = asyncScene();
    const traffic = [trafficDef('test:short', 2.5), trafficDef('test:tall', 4)];
    const riders = [...t.pick.riderLooks];
    const seen = vi.spyOn(EntityViews.prototype, 'setTrafficTypes');
    const build = vi.mocked(roadModule.buildRoadScene);
    build.mockClear();
    const token = t.renderer.applyPresentation(
      { ...t.pick, trafficTypes: traffic, riderLooks: riders },
      { reset: 'preserve' },
    );
    expect(build).toHaveBeenCalledOnce();
    expect(build.mock.calls[0]![0]).toBe(t.pick.road);
    expect(build.mock.calls[0]![3]).toMatchObject({ trafficClearanceM: 4 });
    expect(seen.mock.calls[0]![0]).not.toBe(traffic);
    expect(t.renderer.scenery().seed).toBe(t.pick.sceneSeed);
    expect(t.renderer.look).toBe(t.pick.look);
    expect(t.renderer.setPresentationQuality(token, 'high', 1)).toBe(true);
    riders.push(riderLookOf({ contentId: 'base:probe', role: 'rival', bikeId: 'base:probe' }));
    const pending = t.calls.filter((c) => c.name === 'rider rigs').at(-1)!;
    await t.resolve(pending);
    expect(t.riderArrays).toEqual([[]]);
  });
  it('rebuilds cap clearance only when a legacy traffic catalog changes its tallest body', () => {
    const t = asyncScene();
    const build = vi.mocked(roadModule.buildRoadScene);
    t.renderer.applyPresentation(
      { ...t.pick, trafficTypes: [trafficDef('test:tall', 4)] },
      { reset: 'preserve' },
    );
    build.mockClear();

    t.renderer.setTrafficTypes([trafficDef('test:also-tall', 4), trafficDef('test:short', 2.5)]);
    expect(build).not.toHaveBeenCalled();
    t.renderer.setTrafficTypes([trafficDef('test:short', 2.5)]);
    expect(build).toHaveBeenCalledOnce();
    expect(build.mock.calls[0]![3]).toMatchObject({ trafficClearanceM: 2.5 });

    build.mockClear();
    t.renderer.setTrafficTypes([]);
    expect(build).toHaveBeenCalledOnce();
    expect(build.mock.calls[0]![3]).not.toHaveProperty('trafficClearanceM');
  });
  it('retires prior tokens and accepts quality only for the current receipt', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const renderer = createRenderer(canvasFake());
    const a = renderer.applyPresentation(recipe(), { reset: 'preserve' });
    expect(renderer.setPresentationQuality(a, 'low', 0.7)).toBe(true);
    const b = renderer.applyPresentation(recipe(), { reset: 'measurement-to-menu' });
    const before = renderer.stats().pixelRatio;
    expect(renderer.setPresentationQuality(a, 'low', 0.1)).toBe(false);
    expect(renderer.stats().pixelRatio).toBe(before);
    expect(renderer.setPresentationQuality(b, 'high', 0.9)).toBe(true);
    expect(renderer.setPresentationQuality(b, 'high', 0.8)).toBe(true);
  });
});
