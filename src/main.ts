// The composition root (docs/architecture.md, "Dependency rules"). It sits outside the module
// graph, may import app/ and dev/, and supplies the callbacks the graph does not draw: here the
// debug report from dev/ reaches the UI through app/. Nothing else imports dev/, so dev/ ships in
// production builds without any module depending on it.
//
// dev/ loads as a lazy chunk, off the first-load JavaScript budget (docs/engineering.md, perf
// check): only dev/boot.ts (the test flag and the error capture) comes with the first screen.
// - A player's page fetches the chunk once the game is up, so "copy debug report" finds it loaded;
//   a tap before then waits for it.
// - Under the test flag the page boots only once the chunk is in, and installs the test handle in
//   the same step, so the handle exists before any screen does (dev/boot.ts says how calls made
//   before that are kept).
import { createApp, type AppHandle } from './app';
import { createPendingHandle, installErrorCapture, testFlagSet } from './dev/boot';

type Dev = typeof import('./dev');

let dev: Dev | null = null;
let devLoading: Promise<Dev> | null = null;
function loadDev(): Promise<Dev> {
  devLoading ??= import('./dev').then((m) => (dev = m));
  return devLoading;
}

function boot(): AppHandle | null {
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.append(canvas);
  let app: AppHandle | null = null;
  try {
    app = createApp({
      host: document.body,
      canvas,
      build: {
        id: __BUILD_ID__,
        channel: __BUILD_CHANNEL__,
        branch: __BUILD_BRANCH__,
        simCodeHash: __SIM_CODE_HASH__,
      },
      callbacks: {
        // Once the chunk is in, the copy starts inside the tap, before any await, as it always has.
        onCopyReport: () =>
          !app
            ? Promise.resolve()
            : dev
              ? dev.copyReport(app)
              : loadDev().then((m) => (app ? m.copyReport(app) : undefined)),
        onSaveDebugFile: () =>
          !app
            ? Promise.resolve()
            : dev
              ? dev.saveDebugFile(app)
              : loadDev().then((m) => (app ? m.saveDebugFile(app) : undefined)),
      },
      // Tests pin seed 1; players get a fresh seed every race (playtest 1c item 2, app/seed.ts).
      ...(testFlagSet() ? { seed: 1 } : {}),
    });
  } catch (err) {
    const note = document.createElement('div');
    note.id = 'build-stamp';
    note.textContent = `throttlebrawl · ${__BUILD_CHANNEL__} · ${__BUILD_BRANCH__} · ${__BUILD_ID__}`;
    document.body.append(note);
    console.error('the game could not start', err);
    return null;
  }
  return app;
}

installErrorCapture();
if (testFlagSet()) {
  const pending = createPendingHandle();
  (window as unknown as { __game?: object }).__game = pending.stub;
  void loadDev().then((m) => {
    const app = boot();
    if (!app) return;
    m.installDev(app);
    // Under the test flag, the browser specs read the app's presentation view (camera, radio).
    (window as unknown as { __app?: AppHandle }).__app = app;
    if (window.__game) pending.flush(window.__game);
  });
} else {
  const app = boot();
  if (app) {
    // `?debug=1` (the overlay) and `?selftest=1` need dev/ now; otherwise it loads once the first
    // screen is up, off the first load.
    if (/[?&](debug|selftest)/.test(window.location.search)) void loadDev().then((m) => m.installDev(app));
    else setTimeout(() => void loadDev().then((m) => m.installDev(app)), 1000);
  }
}
