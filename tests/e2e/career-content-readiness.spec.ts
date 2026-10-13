import { expect, test, type Page, type Response, type Route } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

// Escaped-class coverage for app/openCareer's background road readiness. The expected
// transport set and career route come from the pack on disk, so adding or removing a PNW road file
// changes the test oracle without copying a count or route table into this spec.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { state(): string; debugFileText(): string };
};

interface ProfileFixture {
  data: { regions: Record<string, { finaleBeaten: boolean } & Record<string, unknown>> };
}

interface CareerFile {
  nodes: { id: string; event: string }[];
}

interface EventFile {
  id: string;
  lengths: { id: string; route: string }[];
}

const PACK = 'region-pnw';
const REGION = 'pacific-northwest';
const REGION_DIR = join('packs', PACK, 'regions', REGION);
const ROAD_DATA_DIRS = ['networks', 'roads', 'routes'] as const;
const PNW_ROAD_FILES = ROAD_DATA_DIRS.flatMap((folder) =>
  readdirSync(join(REGION_DIR, folder))
    .filter((file) => file.endsWith('.json'))
    .sort(),
).sort();
const PNW_ROAD_FILE_SET = new Set(PNW_ROAD_FILES);

if (PNW_ROAD_FILES.length === 0 || PNW_ROAD_FILE_SET.size !== PNW_ROAD_FILES.length)
  throw new Error('PNW road-data files are absent or have duplicate basenames');

const career = JSON.parse(
  readFileSync(join('packs', PACK, 'careers', 'pnw-circuit.json'), 'utf8'),
) as CareerFile;
const ferryNode = career.nodes.find((node) => node.id === 'ferry-line');
if (!ferryNode) throw new Error('PNW career has no ferry-line node');
const event = JSON.parse(
  readFileSync(join('packs', PACK, 'events', `${ferryNode.event}.json`), 'utf8'),
) as EventFile;
const standard = event.lengths.find((length) => length.id === 'standard');
if (!standard) throw new Error(`${event.id} has no standard length`);
const EXPECTED_ROUTE = `${PACK}:${standard.route}`;

const PROFILE = JSON.parse(readFileSync('tests/fixtures/save/profile-v1.json', 'utf8')) as ProfileFixture;

/** The source filename represented by a dev URL or Vite's basename-hash.json production URL. */
function pnwRoadFile(url: string): string | null {
  const requested = decodeURIComponent(basename(new URL(url).pathname));
  for (const file of PNW_ROAD_FILES) {
    const stem = file.slice(0, -'.json'.length);
    if (requested === file || (requested.startsWith(`${stem}-`) && requested.endsWith('.json'))) return file;
  }
  return null;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  return errors;
}

function replayRoute(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const text = (window as TestWindow).__game?.debugFileText() ?? '';
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const marker = lines.indexOf('===== replay (one line of JSON) =====');
    const replay = JSON.parse(lines[marker + 1] ?? 'null') as {
      header?: { config?: { event?: { routeId?: string } } };
    } | null;
    return replay?.header?.config?.event?.routeId;
  });
}

test('a successful PNW career load survives an ordinary Garage action and remains ride-ready', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const profile = structuredClone(PROFILE);
  profile.data.regions['florida-keys']!.finaleBeaten = true;

  let releaseResolve!: () => void;
  let released = false;
  const releaseGate = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const release = () => {
    if (released) return;
    released = true;
    releaseResolve();
  };

  const intercepted: string[] = [];
  const upstreamBodies = new Set<string>();
  const routeWork: Promise<void>[] = [];
  const deliveredBodies = new Set<string>();
  const responseWork: Promise<void>[] = [];

  page.on('response', (response: Response) => {
    const file = pnwRoadFile(response.url());
    if (!file) return;
    responseWork.push(
      response.finished().then((failure) => {
        expect(failure, `${file} response body finished`).toBeNull();
        expect(response.ok(), `${file} response status ${response.status()}`).toBe(true);
        deliveredBodies.add(file);
      }),
    );
  });

  await page.route(
    (url) => pnwRoadFile(url.href) !== null,
    (route: Route) => {
      const work = (async () => {
        const file = pnwRoadFile(route.request().url());
        if (!file) return route.continue();
        intercepted.push(file);
        const upstream = await route.fetch();
        const body = await upstream.body();
        upstreamBodies.add(file);
        await releaseGate;
        await route.fulfill({ response: upstream, body });
        expect(upstream.ok(), `${file} upstream status ${upstream.status()}`).toBe(true);
      })();
      routeWork.push(work);
      return work;
    },
  );

  try {
    await page.addInitScript((savedProfile) => {
      (window as TestWindow).__GAME_TEST__ = true;
      localStorage.setItem('mbrawl:profile', JSON.stringify(savedProfile));
    }, profile);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator('#menu-career').click();
    await expect(page.locator('#career')).toBeVisible();
    await page.locator('#career-region-pacific-northwest').click();
    await expect(page.locator('#career-region-pacific-northwest')).toHaveAttribute('aria-selected', 'true');

    // Negative control: this is the actual request class, and none of its held successful bodies
    // has entered the page. The PNW map therefore cannot already contain a road.
    await expect.poll(() => intercepted.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator('.career-map polyline.road')).toHaveCount(0);

    // This ordinary UI action retires the generation captured by openCareer while its load waits.
    await page.locator('#career-tab-garage').click();
    await expect(page.locator('#career-tab-garage')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.career-garage')).toBeVisible();

    // loadRoads requests every carried network, road and route concurrently. Prove the held set is
    // exactly today's pack set, and that the real host successfully supplied every response body.
    await expect.poll(() => upstreamBodies.size, { timeout: 60_000 }).toBe(PNW_ROAD_FILES.length);
    expect([...intercepted].sort()).toEqual(PNW_ROAD_FILES);
    expect([...upstreamBodies].sort()).toEqual(PNW_ROAD_FILES);

    release();
    await Promise.all(routeWork);
    await expect.poll(() => responseWork.length, { timeout: 30_000 }).toBe(PNW_ROAD_FILES.length);
    await Promise.all(responseWork);
    expect([...deliveredBodies].sort()).toEqual(PNW_ROAD_FILES);

    // A completed background load must not take over the tab selected after it began.
    await expect(page.locator('#career-tab-garage')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.career-garage')).toBeVisible();
    await expect(page.locator('.career-maps')).toBeHidden();

    // The next ordinary redraw consumes the app registry merged by the background completion.
    await page.locator('#career-tab-map').click();
    await page.locator('#career-region-pacific-northwest').click();
    await expect(page.locator('.career-map polyline.road').first()).toBeVisible();
    expect(await page.locator('.career-map polyline.road').count()).toBeGreaterThan(0);

    await page.locator('.career-node[data-node="ferry-line"]').click();
    await expect(page.locator('#career-ride')).toBeEnabled();
    await page.locator('#career-ride').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    expect(await replayRoute(page)).toBe(EXPECTED_ROUTE);
    expect(errors).toEqual([]);
  } finally {
    release();
    await Promise.allSettled(routeWork);
  }
});
