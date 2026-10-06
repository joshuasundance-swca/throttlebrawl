import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX } from './offline-worker';
import {
  hostBuildOf,
  recoverStaleBuild,
  STALE_BUILD_KEY,
  WORKER_CACHE_PREFIX,
  type StaleBuildPage,
} from './stale-build';

// A tab left on a build the host no longer serves (playtest 4 run A fix batch's live check, new
// mustFix 2 and punch item 1). A deploy renames every hashed file, so the open tab's map and pack
// data, models, kits and lazy chunks answer 404, and a worker installing during the deploy fails.
// The page asks the host which build it serves (its worker file names it) and, when that is another
// build and the network is up, reloads to it once per build: at once in the menus, after the race
// and its result otherwise, never offline, never in a loop. The simulated deploy below is a static
// host serving one build at a time, as the game Space does.

const SCOPE = 'https://game.example/sub/';
const X = 'ed1d8b0';
const Y = '3f6a825';

/** The worker file a build's host serves: its config names the build (scripts/service-worker.mjs). */
const workerFile = (id: string) =>
  `self.__OFFLINE__=${JSON.stringify({ cache: `${CACHE_PREFIX}${id}-0123456789ab`, files: ['index.html'], checks: {} })};\n` +
  '(()=>{"use strict";self.addEventListener("install",()=>{})})();';

/** A static host serving one build; `deploy` replaces it. Records every URL it is asked for. */
function host(build: string) {
  let current = build;
  const asked: string[] = [];
  const fetchFn = (url: string) => {
    asked.push(url);
    return Promise.resolve(
      url === `${SCOPE}sw.js`
        ? new Response(workerFile(current), { status: 200 })
        : new Response('Not Found', { status: 404 }),
    );
  };
  return { fetchFn, asked, deploy: (id: string) => void (current = id) };
}

type Where = 'menu' | 'race' | 'results';

function page(
  opts: {
    build?: string;
    online?: boolean;
    storage?: 'ok' | 'none' | 'throws';
    net?: ReturnType<typeof host>;
  } = {},
) {
  const win = new EventTarget();
  const store = new Map<string, string>();
  const throwing = {
    getItem: (): string | null => {
      throw new Error('SecurityError');
    },
    setItem: () => undefined,
  };
  const working = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const net = opts.net ?? host(opts.build ?? X);
  let reloads = 0;
  let online = opts.online ?? true;
  let where: Where = 'menu';
  const env: StaleBuildPage = {
    win,
    scope: SCOPE,
    online: () => online,
    storage: opts.storage === 'none' ? null : opts.storage === 'throws' ? throwing : working,
    reload: () => void reloads++,
    fetch: (url) => net.fetchFn(url),
    canReload: () => where === 'menu',
  };
  const stale = recoverStaleBuild(env, opts.build ?? X);
  return {
    stale,
    net,
    store,
    reloads: () => reloads,
    probes: () => net.asked.filter((u) => u.endsWith('/sw.js')).length,
    goTo: (w: Where) => {
      where = w;
      stale.settle();
    },
    setOnline: (on: boolean) => void (online = on),
    // What Vite's import helper fires when a lazy chunk's import fails.
    chunkFails: () => win.dispatchEvent(new Event('vite:preloadError', { cancelable: true })),
  };
}

/** San Francisco's map files as build X named them (the live check's 404s). */
const SF_MAPS = [
  'assets/osm-sf-lombard-flats-C3eDycHy.json',
  'assets/osm-sf-lombard-telegraph-hill-Bq1x2a9Z.json',
  'assets/osm-sf-downtown-D0w9kL3m.json',
  'assets/sf-network-Ab12Cd34.json',
].map((rel) => `${SCOPE}${rel}`);

describe("the host's build, read from its worker file", () => {
  it('names the build the worker caches, and nothing for a file that is not a worker of ours', () => {
    expect(hostBuildOf(workerFile(Y))).toBe(Y);
    expect(hostBuildOf(workerFile('local-build'))).toBe('local-build');
    expect(hostBuildOf('Not Found')).toBeNull();
    expect(hostBuildOf('self.__OFFLINE__={"cache":"other-ed1d8b0-0123456789ab"}')).toBeNull();
    // The page names the prefix without importing the worker's code (a shared chunk would break sw.js).
    expect(WORKER_CACHE_PREFIX).toBe(CACHE_PREFIX);
  });
});

describe('(a) online, a build file the deploy renamed answers 404', () => {
  it("reloads once to the current build after San Francisco's map files 404, with one question to the host", async () => {
    const p = page();
    p.net.deploy(Y);
    for (const url of SF_MAPS) p.stale.answered(url, 404);
    await p.stale.idle();
    expect(p.reloads()).toBe(1);
    expect(p.probes()).toBe(1);
    expect(p.store.get(STALE_BUILD_KEY)).toBe(X);
    // A later 404 on the same build does nothing more: one reload per build.
    p.stale.answered(`${SCOPE}assets/models-rider-Zz.glb`, 404);
    await p.stale.idle();
    expect(p.reloads()).toBe(1);
  });

  it('covers models, kits, pack data and lazy chunks alike', async () => {
    for (const rel of [
      'assets/rider-bike-K9.glb',
      'assets/keys-landmarks-Q1.js',
      'assets/base-pack-P2.json',
    ]) {
      const p = page();
      p.net.deploy(Y);
      p.stale.answered(`${SCOPE}${rel}`, 404);
      await p.stale.idle();
      expect(p.reloads(), rel).toBe(1);
    }
    const chunk = page();
    chunk.net.deploy(Y);
    chunk.chunkFails();
    await chunk.stale.idle();
    expect(chunk.reloads()).toBe(1);
  });

  it('does not reload while the host still serves this build (a missing file is not a deploy)', async () => {
    const p = page();
    for (const url of SF_MAPS) p.stale.answered(url, 404);
    p.chunkFails();
    await p.stale.idle();
    expect(p.probes()).toBeGreaterThan(0); // it asked, so the check can see a deploy
    expect(p.reloads()).toBe(0);
    expect(p.store.has(STALE_BUILD_KEY)).toBe(false);
    // The deploy lands later: the next sign finds it.
    p.net.deploy(Y);
    p.stale.answered(SF_MAPS[0] ?? '', 404);
    await p.stale.idle();
    expect(p.reloads()).toBe(1);
  });

  it('ignores answers that are not a missing build file', async () => {
    const p = page();
    p.net.deploy(Y);
    p.stale.answered(`${SCOPE}assets/osm-sf-x.json`, 200);
    p.stale.answered(`${SCOPE}assets/osm-sf-x.json`, 500);
    p.stale.answered(`${SCOPE}changelog.json`, 404); // written after the build, outside assets/
    p.stale.answered('https://elsewhere.example/sub/assets/a.json', 404);
    p.stale.answered('https://game.example/other/assets/a.json', 404);
    await p.stale.idle();
    expect(p.probes()).toBe(0);
    expect(p.reloads()).toBe(0);
  });
});

describe('(b) an install that fails while online', () => {
  it('reloads once to the build the host serves now, so that build installs', async () => {
    const p = page();
    p.net.deploy(Y);
    p.stale.installFailed();
    await p.stale.idle();
    expect(p.reloads()).toBe(1);
  });

  it('does not reload when the host serves this build still (a dropped connection, no deploy)', async () => {
    const p = page();
    p.stale.installFailed();
    await p.stale.idle();
    expect(p.probes()).toBe(1);
    expect(p.reloads()).toBe(0);
  });
});

describe('(c) never mid-race', () => {
  it('waits out the race and its result, then reloads once on the way back to the menu', async () => {
    const p = page();
    let told = 0;
    p.stale.onWaiting(() => told++);
    p.goTo('race');
    p.net.deploy(Y);
    p.stale.installFailed();
    for (const url of SF_MAPS) p.stale.answered(url, 404);
    p.chunkFails();
    await p.stale.idle();
    expect(p.reloads()).toBe(0);
    expect(p.stale.waiting()).toBe(true);
    expect(told).toBe(1);
    p.goTo('race'); // a pause, a restart
    p.goTo('results');
    expect(p.reloads()).toBe(0);
    p.goTo('menu');
    expect(p.reloads()).toBe(1);
    expect(p.stale.waiting()).toBe(false);
    p.goTo('menu');
    expect(p.reloads()).toBe(1);
  });

  it("reloads from the result's offer when the player taps it, and not offline", async () => {
    const p = page();
    p.goTo('results');
    p.net.deploy(Y);
    p.stale.answered(SF_MAPS[0] ?? '', 404);
    await p.stale.idle();
    expect(p.stale.waiting()).toBe(true);
    p.setOnline(false);
    expect(p.stale.reloadNow()).toBe(false);
    p.goTo('menu');
    expect(p.reloads()).toBe(0);
    p.setOnline(true);
    expect(p.stale.reloadNow()).toBe(true);
    expect(p.reloads()).toBe(1);
    expect(p.stale.reloadNow()).toBe(false);
    expect(p.reloads()).toBe(1);
  });
});

describe("#584's guarantees", () => {
  it('reloads once per build and never loops: a page that already reloaded from this build stays', async () => {
    const again = page();
    again.store.set(STALE_BUILD_KEY, X);
    again.net.deploy(Y);
    again.stale.installFailed();
    again.chunkFails();
    for (const url of SF_MAPS) again.stale.answered(url, 404);
    await again.stale.idle();
    expect(again.reloads()).toBe(0);
    expect(again.probes()).toBe(0);
    expect(again.stale.reloadNow()).toBe(false);

    // The reload landed on the newer build: a later deploy there may reload once more.
    const newer = page({ build: Y });
    newer.store.set(STALE_BUILD_KEY, X);
    newer.net.deploy('9a8b7c6');
    newer.stale.answered(SF_MAPS[0] ?? '', 404);
    await newer.stale.idle();
    expect(newer.reloads()).toBe(1);
    expect(newer.store.get(STALE_BUILD_KEY)).toBe(Y);
  });

  it('never reloads offline, or where it cannot remember it did', async () => {
    for (const opts of [{ online: false }, { storage: 'none' as const }, { storage: 'throws' as const }]) {
      const p = page(opts);
      p.net.deploy(Y);
      p.stale.installFailed();
      p.chunkFails();
      p.stale.answered(SF_MAPS[0] ?? '', 404);
      await p.stale.idle();
      p.goTo('menu');
      expect(p.reloads(), JSON.stringify(opts)).toBe(0);
    }
  });

  it('asks nothing of the host and reloads nothing while the network is off', async () => {
    const p = page({ online: false });
    p.net.deploy(Y);
    p.stale.answered(SF_MAPS[0] ?? '', 404);
    await p.stale.idle();
    expect(p.probes()).toBe(0);
    // Back online, the next sign is checked.
    p.setOnline(true);
    p.stale.answered(SF_MAPS[1] ?? '', 404);
    await p.stale.idle();
    expect(p.reloads()).toBe(1);
  });
});
