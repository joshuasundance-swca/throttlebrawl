// The port `vite preview` serves the browser tiers on (playwright.config.ts; docs/engineering.md,
// "Vite settings"). Parallel lane worktrees on one dev machine each run their own browser tiers,
// and a fixed port let one lane's tests reach another lane's build. So, in order:
//   1. PREVIEW_PORT, when set: an explicit choice, for example a preview you started yourself.
//   2. CI: the fixed 4173. One job runs one server, and CI logs stay comparable.
//   3. Otherwise a free port from the OS, so two local runs never share a server. [default]
import { createServer } from 'node:net';

export const DEFAULT_PREVIEW_PORT = 4173;

/**
 * Asks the OS for a free loopback port (listen on 0), then releases it for the server to bind.
 * @param {string} [host]
 * @returns {Promise<number>}
 */
export function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('freePort: no port from the OS'))));
    });
  });
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {() => Promise<number>} pick
 * @returns {Promise<{ port: number, source: 'env' | 'ci' | 'free' }>}
 */
export async function resolvePreviewPort(env = process.env, pick = freePort) {
  const raw = env.PREVIEW_PORT;
  if (raw !== undefined && raw !== '') {
    const port = Number(raw);
    if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
      throw new Error(`PREVIEW_PORT must be a port number from 1 to 65535, got "${raw}"`);
    }
    return { port, source: 'env' };
  }
  if (env.CI) return { port: DEFAULT_PREVIEW_PORT, source: 'ci' };
  return { port: await pick(), source: 'free' };
}
