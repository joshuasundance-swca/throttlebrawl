import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bakePart, RIDER_BONES, type BakedPart } from '../../src/render/riders/bake';
import { readGlb } from '../../src/render/glb';
import { riderLookOf } from '../../src/render/rider-looks';
import { startRace } from './ui-layout-helpers';
import { openQuickPlay } from './menu-navigation';
import type { AppHandle } from '../../src/app';
import type { TestHandle } from '../../src/dev';

interface RiderFile {
  id: string;
  role: 'player-preset' | 'rival' | 'cop' | 'extra';
  bike: string;
  look?: unknown;
}
interface Raster {
  entityId: number;
  visible: number;
  hidden: number;
  unobstructed: number;
  width: number;
  height: number;
  attributes: Record<'position' | 'normal' | 'skinIndex' | 'skinWeight', number[]>;
}
type Browser = Window & {
  __game?: TestHandle;
  __app?: AppHandle;
  __riderRaster?: (entityId: number) => Raster;
  __riderReady?: number;
};
const files = readdirSync('packs/base/riders').filter((f) => f.endsWith('.json'));
const riders = new Map<string, RiderFile>(
  files.map((f) => {
    const rider = JSON.parse(readFileSync(`packs/base/riders/${f}`, 'utf8')) as RiderFile;
    return [`base:${rider.id}`, rider] as const;
  }),
);
const lock = JSON.parse(readFileSync('assets.lock.json', 'utf8')) as {
  files: { path: string; bytes: number; sha256: string }[];
};
function part(model: string, kind: 'rider' | 'bike'): BakedPart {
  const packed = `packs/base/assets/${model}.glb`;
  const pinned = lock.files.find((f) => f.path === `base/${model}.glb`);
  const bytes = readFileSync(pinned ? `.cache/assets/${pinned.path}` : packed);
  if (pinned) {
    expect(bytes.length, pinned.path).toBe(pinned.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'), pinned.path).toBe(pinned.sha256);
  } else expect(existsSync(packed), model).toBe(true);
  return bakePart(readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), kind);
}
function expectPart(raster: Raster, expected: BakedPart, bike: boolean) {
  const a = raster.attributes;
  let vertex = 0;
  let badWeights = 0,
    badBones = 0;
  const errors = { position: { mismatches: 0, maximum: 0 }, normal: { mismatches: 0, maximum: 0 } };
  for (let i = 0; i < a.position.length / 3; i++) {
    const bone = a.skinIndex[i * 4] ?? -1;
    if (bone >= RIDER_BONES.length !== bike) continue;
    if (a.skinWeight[i * 4] !== 1 || [1, 2, 3].some((k) => a.skinWeight[i * 4 + k] !== 0)) badWeights++;
    if (
      bone - (bike ? RIDER_BONES.length : 0) !== expected.boneOf[vertex] ||
      [1, 2, 3].some((k) => a.skinIndex[i * 4 + k] !== 0)
    )
      badBones++;
    for (const [key, values] of [
      ['position', expected.positions],
      ['normal', expected.normals],
    ] as const)
      for (let axis = 0; axis < 3; axis++) {
        const error = Math.abs((a[key][i * 3 + axis] ?? Infinity) - (values[vertex * 3 + axis] ?? -Infinity));
        errors[key].maximum = Math.max(errors[key].maximum, error);
        if (!Number.isFinite(error) || error > 1e-6) errors[key].mismatches++;
      }
    vertex++;
  }
  expect(vertex).toBe(expected.positions.length / 3);
  expect(badWeights, 'rigid weights').toBe(0);
  expect(badBones, 'actual part bone pairing').toBe(0);
  expect(errors.position, 'ordered rest positions').toEqual({ mismatches: 0, maximum: expect.any(Number) });
  expect(errors.normal, 'ordered rest normals').toEqual({ mismatches: 0, maximum: expect.any(Number) });
  return errors;
}
async function choose(page: Page, id: string, value: string) {
  const row = page.locator(`#race-option-${id}`),
    seen = new Set();
  while ((await row.getAttribute('data-value')) !== value) {
    const current = await row.getAttribute('data-value');
    expect(seen.has(current), `${id} offers ${value}`).toBe(false);
    seen.add(current);
    await page.locator(`#race-option-${id}-next`).click();
  }
}

// A bounded first-seed search of SIM preconditions, never successful pixels: a missing/wrong rig
// or an empty contribution fails immediately on the selected encounter. This is visibility, not
// a claim that the small normal/grayscale figure is recognizable to a person.
test('selected base riders contribute their own moving production geometry and pixels', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await startRace(page);
  expect(
    await page.evaluate(() => typeof (window as Browser).__riderRaster),
    'per-entity production raster observation exists',
  ).toBe('function');
  const observed = new Set<string>(),
    selected = new Set<string>();
  const evidence: unknown[] = [];
  // Artifact names alone are unique across retries/workers/reruns; randomness never selects sim state.
  const artifactStem = `test-results/screenshots/rider-visibility-${randomUUID()}`;
  mkdirSync('test-results/screenshots', { recursive: true });
  for (let seed = 1; seed <= 4; seed++) {
    if (await page.locator('#pause-screen').isVisible()) await page.locator('#pause-quit').click();
    else {
      await page.locator('#hud-pause').click();
      await page.locator('#pause-quit').click();
    }
    await openQuickPlay(page);
    await expect(page.locator('#menu-options')).toBeVisible();
    await page.locator('#menu-options').click();
    const choices: number[] = [],
      seen = new Set<string | null>();
    for (;;) {
      const value = await page.locator('#race-option-rivals').getAttribute('data-value');
      if (seen.has(value)) break;
      seen.add(value);
      if (value && /^\d+$/.test(value)) choices.push(Number(value));
      await page.locator('#race-option-rivals-next').click();
    }
    const expectedRivals = Math.max(...choices);
    await choose(page, 'rivals', String(expectedRivals));
    await choose(page, 'bike', 'base:superbike-1000');
    await choose(page, 'cops', 'false');
    await choose(page, 'weather', 'dry');
    await page.evaluate((seed) => {
      const g = (window as Browser).__game;
      if (!g) throw new Error('No game test handle during race setup');
      g.setSeed(seed);
      g.setBot(true);
      g.lockstep(1);
    }, seed);
    await expect(page.locator('#race-options-race')).toBeVisible();
    await page.locator('#race-options-race').click();
    await page.waitForFunction(() => ((window as Browser).__game?.snapshot()?.tick ?? 0) > 0);
    const initial = await page.evaluate(() => {
      const g = (window as Browser).__game;
      if (!g) throw new Error('No game test handle after race start');
      const snapshot = g.snapshot();
      if (!snapshot) throw new Error('No race snapshot after start');
      return { ...snapshot, playerId: g.playerId() };
    });
    const cohort = initial.entities.filter((e) => {
      const content = riders.get(e.contentId);
      return e.kind === 'rider' && content && (e.id === initial.playerId || content.role === 'rival');
    });
    for (const e of cohort) selected.add(e.contentId);
    expect(
      cohort.some((e) => e.id === initial.playerId),
      'selected cohort includes the actual player',
    ).toBe(true);
    expect(
      cohort.filter((e) => e.id !== initial.playerId).length,
      'the requested content-derived rival field spawned',
    ).toBe(expectedRivals);
    const initialPlayer = initial.entities.find((e) => e.id === initial.playerId);
    if (!initialPlayer) throw new Error('No player in initial race snapshot');
    const deadline = initial.tick + 600;
    for (let encounter = 0; encounter <= cohort.length; encounter++) {
      await page.evaluate(
        ({ done, deadline, startProgress, wanted }) => {
          const w = window as Browser,
            g = w.__game;
          if (!g) throw new Error('No game test handle during encounter search');
          delete w.__riderReady;
          g.fastForward(
            (s) => {
              const me = s.entities.find((e) => e.id === g.playerId());
              if (!me) throw new Error('No player');
              const target = s.entities.find((e) => {
                if (done.includes(e.contentId) || !wanted.includes(e.contentId)) return false;
                if (
                  e.mode !== 'Road' ||
                  e.speed <= 0 ||
                  me.mode !== 'Road' ||
                  me.speed <= 0 ||
                  me.progress < startProgress + 10
                )
                  return false;
                const dx = e.x - me.x,
                  dz = e.z - me.z;
                return (
                  Math.hypot(dx, e.y - me.y, dz) <= 25 &&
                  -Math.sin(me.heading) * dx - Math.cos(me.heading) * dz >= -2
                );
              });
              const stop = !!target || s.tick >= deadline || s.race.over;
              if (target) w.__riderReady = target.id;
              if (stop) document.getElementById('hud-pause')?.click();
              return stop;
            },
            { perFrame: 12, then: 1 },
          );
        },
        {
          done: [...observed],
          deadline,
          wanted: cohort.map((e) => e.contentId),
          startProgress: initialPlayer.progress,
        },
      );
      await page.waitForFunction(() => {
        const game = (window as Browser).__game;
        if (!game) throw new Error('No game test handle while waiting for encounter');
        return !game.fastForwarding();
      });
      await expect(page.locator('#pause-screen')).toBeVisible();
      const targetId = await page.evaluate(() => (window as Browser).__riderReady);
      if (targetId === undefined) break;
      const state = await page.evaluate((id) => {
        const w = window as Browser,
          game = w.__game,
          app = w.__app;
        if (!game || !app) throw new Error('No game or app handle during rider observation');
        const s = game.snapshot();
        if (!s) throw new Error('No race snapshot during rider observation');
        return {
          snapshot: s,
          target: s.entities.find((e) => e.id === id),
          playerId: game.playerId(),
          presentation: app.presentation(),
          stats: game.rendererStats(),
          device: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
          raster: w.__riderRaster?.(id),
        };
      }, targetId);
      const target = state.target,
        raster = state.raster;
      expect(target).toBeDefined();
      expect(raster).toBeDefined();
      if (!target || !raster) throw new Error('Missing target observation');
      const content = riders.get(target.contentId);
      if (!content) throw new Error('Observed rider not in selected base content');
      const role = target.id === state.playerId ? 'player' : 'rival';
      const look = riderLookOf({
        contentId: target.contentId,
        role,
        bikeId: target.id === state.playerId ? 'base:superbike-1000' : `base:${content.bike}`,
        look: content.look,
      });
      const riderAssets = state.presentation.riders;
      if (!riderAssets) throw new Error('No rider asset presentation during observation');
      expect(riderAssets.loaded).toEqual(expect.arrayContaining([look.riderModel, look.bikeModel]));
      const geometry = {
        rider: expectPart(raster, part(look.riderModel, 'rider'), false),
        bike: expectPart(raster, part(look.bikeModel, 'bike'), true),
      };
      expect(raster.visible, target.contentId).toBeGreaterThan(0);
      expect(raster.hidden).toBe(0);
      expect(raster.unobstructed).toBeGreaterThanOrEqual(raster.visible);
      const stationStem = `${artifactStem}-seed-${seed}-entity-${target.id}`;
      const normalPath = `${stationStem}-normal.png`,
        grayscalePath = `${stationStem}-grayscale.png`;
      const style = await page.addStyleTag({ content: '#pause-screen{visibility:hidden!important}' });
      try {
        const png = await page.locator('canvas#game').screenshot({ path: normalPath });
        await info.attach(`${target.contentId}-normal`, { path: normalPath, contentType: 'image/png' });
        const gray = await page.evaluate(async (data) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No grayscale canvas');
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < pixels.data.length; i += 4) {
            const v = Math.round(
              0.2126 * pixels.data[i]! + 0.7152 * pixels.data[i + 1]! + 0.0722 * pixels.data[i + 2]!,
            );
            pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
          }
          ctx.putImageData(pixels, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1]!;
        }, png.toString('base64'));
        writeFileSync(grayscalePath, Buffer.from(gray, 'base64'));
        await info.attach(`${target.contentId}-grayscale`, { path: grayscalePath, contentType: 'image/png' });
      } finally {
        await style.evaluate((s) => (s as HTMLElement).remove());
      }
      const player = state.snapshot.entities.find((e) => e.id === state.playerId);
      if (!player) throw new Error('No player in rider observation snapshot');
      evidence.push({
        ...state,
        raster: { ...raster, attributes: undefined },
        geometry,
        screenshots: { normal: normalPath, grayscale: grayscalePath },
        field: { requestedRivals: expectedRivals, selectedContent: cohort.map((e) => e.contentId) },
        distanceMetres: Math.hypot(target.x - player.x, target.y - player.y, target.z - player.z),
        seed,
        geometryScope:
          'Rest geometry pairing; aliases and intended starter/fallback geometry cannot establish asset-file identity',
      });
      observed.add(target.contentId);
      if ([...selected].every((id) => observed.has(id))) break;
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
    }
    if ([...selected].every((id) => observed.has(id))) break;
  }
  const evidencePath = `${artifactStem}-evidence.json`;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  await info.attach('moving-rider-evidence', { path: evidencePath, contentType: 'application/json' });
  expect(
    [...selected].filter((id) => !observed.has(id)),
    'selected content without a moving visibility observation',
  ).toEqual([]);
  expect(errors).toEqual([]);
});
