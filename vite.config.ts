import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, runnerImport, type Plugin } from 'vite';

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

const root = fileURLToPath(new URL('.', import.meta.url));

// The cross-architecture self-test (docs/architecture.md, "Testing seams"; M1 dev-2): at build
// time Node runs the fixed self-test race through Vite's module runner and bakes its result into
// the build as `virtual:selftest-expected`; `?selftest=1` runs the same race in the browser and
// compares. Until src/dev/selftest/race.ts exists the module exports null ("not built").
const SELFTEST_ID = 'virtual:selftest-expected';
const SELFTEST_RACE = '/src/dev/selftest/race.ts';
function selfTestHash(): Plugin {
  const resolved = `\0${SELFTEST_ID}`;
  return {
    name: 'throttlebrawl:selftest-hash',
    resolveId: (source) => (source === SELFTEST_ID ? resolved : null),
    async load(id) {
      if (id !== resolved) return null;
      if (!existsSync(path.join(root, SELFTEST_RACE))) return 'export default null;';
      const { module } = await runnerImport<{ runSelfTestRace(): unknown }>(SELFTEST_RACE, {
        configFile: false,
        root,
        logLevel: 'error',
      });
      return `export default ${JSON.stringify(module.runSelfTestRace())};`;
    },
  };
}

export default defineConfig({
  plugins: [selfTestHash()],
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
