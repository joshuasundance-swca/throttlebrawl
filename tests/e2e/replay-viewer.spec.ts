import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import type { AppHandle } from '../../src/app';
import type { TestHandle } from '../../src/dev/handle';
import { fastForwardDone } from './lockstep';

type ReplayWindow = Window & { __app?: AppHandle; __game?: TestHandle; __GAME_TEST__?: boolean };
const inspect = (page: Page) => page.evaluate(() => (window as ReplayWindow).__app!.replayPlayback());
const receipt = (page: Page) =>
  page.evaluate(() => {
    const app = (window as ReplayWindow).__app!;
    return JSON.stringify({
      profile: app.career().profile,
      replay: app.replayFile(),
      settings: app.getReplayAndSettings().settings,
      storage: Object.keys(localStorage)
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    });
  });

async function riderVisible(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as ReplayWindow).__app!.replayPlayback()?.frame);
  const frame = (await inspect(page))?.frame;
  expect(frame, 'the viewer has a camera and interpolated rider').toBeTruthy();
  if (!frame) throw new Error('Missing replay frame');
  const viewport = page.viewportSize()!;
  const pose = frame.camera;
  const camera = new PerspectiveCamera(pose.fov, viewport.width / viewport.height, 0.3, 760);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.up.set(pose.upX, pose.upY, pose.upZ);
  camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  camera.updateMatrixWorld();
  // Rider torso, one metre above the interpolated support position. Project through the actual
  // pose supplied to render, then ask the rendered DOM whether the canvas is visible there.
  const torso = new Vector3(frame.player.x, frame.player.y + 1, frame.player.z).project(camera);
  expect(Math.abs(torso.x)).toBeLessThan(1);
  expect(Math.abs(torso.y)).toBeLessThan(1);
  expect(torso.z).toBeGreaterThan(-1);
  expect(torso.z).toBeLessThan(1);
  const point = { x: ((torso.x + 1) * viewport.width) / 2, y: ((1 - torso.y) * viewport.height) / 2 };
  const visible = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y) instanceof HTMLCanvasElement,
    point,
  );
  expect(visible, 'replay controls leave the rider visible').toBe(true);
  // Positive detection control: cover that actual world-projected point, not a guessed UI region.
  const covered = await page.evaluate(({ x, y }) => {
    const cover = document.createElement('div');
    cover.style.cssText = `position:fixed;left:${x - 2}px;top:${y - 2}px;width:4px;height:4px;z-index:2147483647;pointer-events:auto`;
    document.body.append(cover);
    try {
      return !(document.elementFromPoint(x, y) instanceof HTMLCanvasElement);
    } finally {
      cover.remove();
    }
  }, point);
  expect(covered).toBe(true);
}

async function hitTargets(page: Page): Promise<void> {
  for (const id of ['replay-toggle', 'replay-restart', 'replay-camera', 'replay-return']) {
    const button = page.locator(`#${id}`);
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        hit: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
      };
    });
    expect(hit.width, id).toBeGreaterThanOrEqual(44);
    expect(hit.height, id).toBeGreaterThanOrEqual(44);
    expect(hit.hit, id).toBe(true);
  }
  // The same rendered hit check must detect a real occluder, rather than only checking DOM presence.
  const missed = await page.locator('#replay-return').evaluate((node) => {
    const r = node.getBoundingClientRect();
    const cover = document.createElement('div');
    cover.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;pointer-events:auto`;
    document.body.append(cover);
    try {
      return !node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    } finally {
      cover.remove();
    }
  });
  expect(missed).toBe(true);
}

for (const kind of ['quick', 'career'] as const) {
  test(`${kind} result replays independently and returns without changing its receipt`, async ({ page }) => {
    test.setTimeout(420_000); // hang guard; all playback waits below are simulation conditions
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(() => {
      (window as ReplayWindow).__GAME_TEST__ = true;
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    // Largest is a real saved setting, selected through the UI before recording the receipt.
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-access').click();
    await page.locator('#settings-textSize [data-value="largest"]').click();
    await page.locator('#settings-back').click();
    if (kind === 'career') {
      await page.locator('#menu-career').click();
      await page.locator('.career-node.suggested').click();
      await page.locator('#career-ride').click();
    } else {
      await page.locator('#menu-quick-play').click();
      await page.locator('#menu-race').click();
    }
    await page.waitForFunction(() => (window as ReplayWindow).__game?.state() === 'race');
    await page.evaluate(() => {
      const game = (window as ReplayWindow).__game!;
      game.setBot(true);
      game.fastForward((s) => s.race.over, { perFrame: 1200, then: 1 });
    });
    await fastForwardDone(page, `${kind} recording`);
    const screen = kind === 'career' ? '#career-results' : '#results';
    const watch = kind === 'career' ? '#career-results-watch-replay' : '#results-watch-replay';
    await expect(page.locator(screen)).toBeVisible({ timeout: 60_000 });
    const text = await page.locator(screen).innerText();
    const before = await receipt(page);
    // Lockstep belongs to the test clock, selected before viewer ownership. Viewer code ignores
    // the live tick driver and consumes only the completed recording.
    await page.evaluate(() => (window as ReplayWindow).__game!.lockstep(1));
    await page.locator(watch).click();
    await expect(page.locator('#replay-return')).toBeVisible();
    await page.waitForFunction(() => (window as ReplayWindow).__app!.replayPlayback()?.playing);
    await page.locator('#replay-toggle').click();
    await expect(page.locator('#replay-status')).toHaveText('Paused');
    const paused = await inspect(page);
    expect(paused?.complete).toBe(false);
    await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
    await page.setViewportSize({ width: 568, height: 320 });
    await riderVisible(page);
    await page.locator('#replay-toggle').click();
    await page.evaluate(() => (window as ReplayWindow).__game!.lockstep(12));
    await page.waitForFunction(() => {
      const p = (window as ReplayWindow).__app!.replayPlayback();
      return p && p.tick >= Math.min(300, p.durationTicks / 4);
    });
    await page.locator('#replay-toggle').click();
    const mid = await inspect(page);
    expect(mid?.playing).toBe(false);
    await riderVisible(page);
    const trackside = (await inspect(page))?.frame?.camera;
    await page.keyboard.down('KeyW');
    await page.locator('#replay-camera').click();
    await page.waitForFunction(() => {
      const p = (window as ReplayWindow).__app!.replayPlayback();
      return p?.frame && Math.abs(p.frame.camera.x - p.frame.player.x) > 0;
    });
    expect((await inspect(page))?.mode).toBe('orbit');
    await riderVisible(page);
    expect((await inspect(page))?.frame?.camera).not.toEqual(trackside);
    for (const size of [
      { width: 915, height: 412 },
      { width: 568, height: 320 },
    ]) {
      await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
      await page.setViewportSize(size);
      await hitTargets(page);
      await riderVisible(page);
      expect((await inspect(page))?.tick).toBe(mid?.tick);
      await page.screenshot({ path: test.info().outputPath(`${kind}-orbit-${size.width}.png`) });
    }
    await page.locator('#replay-camera').click();
    await riderVisible(page);
    await page.screenshot({ path: test.info().outputPath(`${kind}-trackside.png`) });
    expect((await inspect(page))?.mode).toBe('trackside');
    await page.locator('#replay-return').click();
    await page.keyboard.up('KeyW');
    await expect(page.locator(screen)).toBeVisible();
    expect(await page.locator(screen).innerText()).toBe(text);
    expect(await receipt(page)).toBe(before);

    await page.evaluate(() => (window as ReplayWindow).__game!.lockstep(240));
    await page.locator(watch).click();
    await page.waitForFunction(() => (window as ReplayWindow).__app!.replayPlayback()?.complete, null, {
      timeout: 240_000,
    });
    await expect(page.locator('#replay-status')).toHaveText('Replay complete');
    const complete = await inspect(page);
    expect(complete?.tick).toBe(complete?.durationTicks);
    const encoded = JSON.parse(before) as { replay: { hashes: unknown[] } };
    expect(complete?.checked).toBe(encoded.replay.hashes.length + 1);
    await page.locator('#replay-restart').click();
    // Return during a restart also exercises late preparation ownership; fresh-sim restart
    // equality is covered directly in replay-playback.test.ts without racing a render frame.
    await page.locator('#replay-return').click();
    await expect(page.locator(screen)).toBeVisible();
    expect(await receipt(page)).toBe(before);
    expect(errors).toEqual([]);
  });
}
