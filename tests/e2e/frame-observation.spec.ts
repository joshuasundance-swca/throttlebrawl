import { expect, test } from '@playwright/test';
import type { AppDrawnFrame, AppHandle } from '../../src/app';
import { openQuickPlay } from './menu-navigation';
import { createSoakFrameCollector } from '../../src/dev/perf/soak-frames';

type ObservationWindow = Window & {
  __GAME_TEST__?: boolean;
  __app?: AppHandle;
  __observation?: {
    samples: Readonly<AppDrawnFrame>[];
    first: number;
    second: number;
    offFirst: () => void;
    offSecond: () => void;
    offSamples: () => void;
    knownLost: boolean;
    duringLoss: number;
    ext: WEBGL_lose_context | null;
    handBackTick: number | null;
    handBack: Readonly<AppDrawnFrame> | null;
  };
};

test('built AppHandle observes real race, fast-forward hand-back, pause/menu, context and owner cleanup', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.addInitScript(() => {
    (window as ObservationWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.waitForFunction(() => !!(window as ObservationWindow).__app && !!window.__game);
  expect(
    await page.evaluate(() => !!document.querySelector<HTMLCanvasElement>('#game')?.getContext('webgl2')),
  ).toBe(true);
  await page.evaluate(() => {
    const w = window as ObservationWindow;
    const app = w.__app!;
    const observed: NonNullable<ObservationWindow['__observation']> = {
      samples: [],
      first: 0,
      second: 0,
      offFirst: () => {},
      offSecond: () => {},
      offSamples: () => {},
      knownLost: false,
      duringLoss: 0,
      ext: null,
      handBackTick: null,
      handBack: null,
    };
    w.__observation = observed;
    const errors = (error: unknown) => {
      throw error;
    };
    observed.offSamples = app.subscribeFrames((sample) => {
      if (!Object.isFrozen(sample)) throw new Error('sample was mutable');
      observed.samples.push(sample);
      if (observed.knownLost) observed.duringLoss++;
      if (
        observed.handBackTick !== null &&
        !observed.handBack &&
        (app.snapshot()?.tick ?? 0) >= observed.handBackTick &&
        app.lockstep() === null
      )
        observed.handBack = sample;
    }, errors);
    observed.offFirst = app.subscribeFrames(() => observed.first++, errors);
    observed.offSecond = app.subscribeFrames(() => observed.second++, errors);
    const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
    observed.ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', () => {
      observed.knownLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      observed.knownLost = false;
    });
  });
  await page.waitForFunction(() =>
    (window as ObservationWindow).__observation!.samples.some((f) => !f.eligible),
  );
  await page.locator('#start-screen').click();
  await page.evaluate(() => window.__game!.setBot(true));
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await page.waitForFunction(
    () => (window as ObservationWindow).__observation!.samples.at(-1)?.eligible === true,
  );
  await page.waitForFunction(() => {
    const samples = (window as ObservationWindow).__observation!.samples;
    return samples.some((sample, i) => {
      const previous = samples[i - 1];
      return (
        sample.eligible &&
        previous?.eligible &&
        sample.epoch === previous.epoch &&
        sample.timestampMs > previous.timestampMs
      );
    });
  });
  const raceEpoch = await page.evaluate(
    () => (window as ObservationWindow).__observation!.samples.at(-1)!.epoch,
  );

  await page.evaluate(() => {
    const w = window as ObservationWindow;
    const target = w.__app!.snapshot()!.tick + 2;
    w.__observation!.handBackTick = target;
    window.__game!.fastForward((snapshot) => snapshot.tick >= target, { perFrame: 8, then: null });
  });
  await page.waitForFunction(() => !!(window as ObservationWindow).__observation!.handBack);
  const handBack = await page.evaluate(() => (window as ObservationWindow).__observation!.handBack!);
  expect(handBack.eligible).toBe(false);
  expect(handBack.epoch).toBeGreaterThan(raceEpoch);
  await page.waitForFunction(() => {
    const observed = (window as ObservationWindow).__observation!;
    return (
      observed.samples.at(-1)?.eligible === true &&
      observed.samples.at(-1)!.timestampMs > observed.handBack!.timestampMs
    );
  });
  expect(await page.evaluate(() => (window as ObservationWindow).__observation!.samples.at(-1)!.epoch)).toBe(
    handBack.epoch,
  );

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.waitForFunction(
    () => (window as ObservationWindow).__observation!.samples.at(-1)?.eligible === false,
  );
  const pausedEpoch = await page.evaluate(
    () => (window as ObservationWindow).__observation!.samples.at(-1)!.epoch,
  );
  expect(pausedEpoch).toBeGreaterThan(handBack.epoch);
  await page.locator('#pause-resume').click();
  await page.waitForFunction(
    () => (window as ObservationWindow).__observation!.samples.at(-1)?.eligible === true,
  );

  const beforeLoss = await page.evaluate(() => {
    const observed = (window as ObservationWindow).__observation!;
    const epoch = observed.samples.at(-1)!.epoch;
    if (!observed.ext) throw new Error('context-loss extension unavailable');
    observed.ext.loseContext();
    return epoch;
  });
  await page.waitForFunction(() => (window as ObservationWindow).__observation!.knownLost);
  await page.evaluate(() => (window as ObservationWindow).__observation!.ext!.restoreContext());
  await page.waitForFunction((epoch) => {
    const observed = (window as ObservationWindow).__observation!;
    return (
      !observed.knownLost &&
      observed.samples.at(-1)?.eligible === true &&
      observed.samples.at(-1)!.epoch > epoch
    );
  }, beforeLoss);
  expect(await page.evaluate(() => (window as ObservationWindow).__observation!.duringLoss)).toBe(0);

  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.waitForFunction(() => {
    const w = window as ObservationWindow;
    return w.__app!.state() === 'menu' && w.__observation!.samples.at(-1)?.eligible === false;
  });
  const stopped = await page.evaluate(() => {
    const observed = (window as ObservationWindow).__observation!;
    observed.offFirst();
    observed.offFirst();
    return { first: observed.first, second: observed.second };
  });
  await page.waitForFunction(
    (before) => (window as ObservationWindow).__observation!.second > before,
    stopped.second,
  );
  expect(await page.evaluate(() => (window as ObservationWindow).__observation!.first)).toBe(stopped.first);
  const collector = createSoakFrameCollector();
  const samples = await page.evaluate(() => (window as ObservationWindow).__observation!.samples);
  for (const sample of samples) collector.record(sample);
  const report = collector.report();
  expect(report.eligibleMs).toBeGreaterThan(0);
  expect(report.epochBreaks).toBeGreaterThan(0);
  expect(report.excludedIntervals).toBeGreaterThan(0);
  expect(report.state).toBe('collecting'); // this regression is not a production 15-minute soak
  await page.evaluate(() => {
    const observed = (window as ObservationWindow).__observation!;
    observed.offSecond();
    observed.offSamples();
    window.__game!.setBot(false);
    window.__game!.lockstep(null);
  });
  expect(problems).toEqual([]);
});
