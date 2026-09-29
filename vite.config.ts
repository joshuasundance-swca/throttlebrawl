import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Build stamp (docs/engineering.md, "Vite settings"). CI sets BUILD_ID, BUILD_CHANNEL and
// BUILD_BRANCH; a local build falls back to git and the `dev` channel.
function fromGit(args: string[], fallback: string): string {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

const CHANNELS = ['prod', 'staging', 'dev'];
const buildChannel = process.env.BUILD_CHANNEL ?? 'dev';
if (!CHANNELS.includes(buildChannel)) {
  throw new Error(`BUILD_CHANNEL must be one of ${CHANNELS.join(', ')}, got ${buildChannel}`);
}
const buildId = (process.env.BUILD_ID || fromGit(['rev-parse', 'HEAD'], 'unknown')).slice(0, 7);
const buildBranch = process.env.BUILD_BRANCH || fromGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');

export default defineConfig({
  // Relative asset paths, so one build works at a Space root or under any sub-path.
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_CHANNEL__: JSON.stringify(buildChannel),
    __BUILD_BRANCH__: JSON.stringify(buildBranch),
  },
  // Explicit loopback hosts and fixed ports: `npm run phone` forwards exactly these.
  // Never bind all interfaces.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022' },
});
