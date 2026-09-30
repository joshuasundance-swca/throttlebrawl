import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_PORT, freePort, resolvePreviewPort } from './preview-port.mjs';

// The port the browser tiers serve the build on (playwright.config.ts). Parallel lane worktrees on
// one machine must not share it, or one lane's tests run against another lane's build.

const held: Server[] = [];
function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      held.push(s);
      resolve(s);
    });
  });
}

afterEach(async () => {
  await Promise.all(held.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('resolvePreviewPort', () => {
  it('uses PREVIEW_PORT when it is set', async () => {
    const r = await resolvePreviewPort({ PREVIEW_PORT: '4400' }, () => Promise.resolve(1));
    expect(r).toEqual({ port: 4400, source: 'env' });
  });

  it('rejects a PREVIEW_PORT that is not a port number', async () => {
    for (const bad of ['abc', '0', '70000', '44.5', '-1']) {
      await expect(resolvePreviewPort({ PREVIEW_PORT: bad })).rejects.toThrow(/PREVIEW_PORT/);
    }
  });

  it('keeps the fixed port on CI, where one job runs one server', async () => {
    const r = await resolvePreviewPort({ CI: 'true' }, () => Promise.resolve(1));
    expect(r).toEqual({ port: DEFAULT_PREVIEW_PORT, source: 'ci' });
    expect(DEFAULT_PREVIEW_PORT).toBe(4173);
  });

  it('picks a free port locally when nothing is set', async () => {
    const r = await resolvePreviewPort({}, () => Promise.resolve(5123));
    expect(r).toEqual({ port: 5123, source: 'free' });
  });

  it('an empty PREVIEW_PORT counts as unset', async () => {
    const r = await resolvePreviewPort({ PREVIEW_PORT: '' }, () => Promise.resolve(5124));
    expect(r.source).toBe('free');
  });
});

describe('freePort', () => {
  it('returns a port nothing is listening on, which can then be bound', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    await expect(hold(port)).resolves.toBeDefined();
  });

  it('never returns a port that is already held (the 4173 clash between worktrees)', async () => {
    const taken = await freePort();
    await hold(taken);
    for (let i = 0; i < 5; i++) expect(await freePort()).not.toBe(taken);
  });
});
