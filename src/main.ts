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
//
// The Keys' hand-made road data (the default race's and the menu backdrop's) ships as JSON files
// beside the build, off the first-load JavaScript (run W-S): the page fetches it first, then boots.
import { createApp, loadBootContent, type AppHandle } from './app';
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
    showStamp();
    console.error('the game could not start', err);
    return null;
  }
  return app;
}

/** The build stamp alone, when the game cannot start; `why` goes before it when known. */
function showStamp(why?: string): void {
  const note = document.createElement('div');
  note.id = 'build-stamp';
  note.textContent = `${why ? `${why} · ` : ''}throttlebrawl · ${__BUILD_CHANNEL__} · ${__BUILD_BRANCH__} · ${__BUILD_ID__}`;
  document.body.append(note);
}

/** The first screen's road data did not load, twice: say so, with the stamp. */
function contentFailed(err: unknown): void {
  showStamp('The road did not load. Check the connection and reload');
  console.error('the game could not start: its road data did not load', err);
}

installErrorCapture();
// Fetched at once; tried once more after a moment if that fails (a dropped connection on the phone).
const content = loadBootContent().catch(
  () =>
    new Promise<void>((resolve, reject) => setTimeout(() => loadBootContent().then(resolve, reject), 1500)),
);
if (testFlagSet()) {
  const pending = createPendingHandle();
  (window as unknown as { __game?: object }).__game = pending.stub;
  void Promise.all([loadDev(), content]).then(([m]) => {
    const app = boot();
    if (!app) return;
    m.installDev(app);
    // Under the test flag, the browser specs read the app's presentation view (camera, radio).
    (window as unknown as { __app?: AppHandle }).__app = app;
    if (window.__game) pending.flush(window.__game);
  }, contentFailed);
} else {
  void content.then(() => {
    const app = boot();
    if (!app) return;
    // `?debug=1` (the overlay) and `?selftest=1` need dev/ now; otherwise it loads once the first
    // screen is up, off the first load.
    if (/[?&](debug|selftest)/.test(window.location.search)) void loadDev().then((m) => m.installDev(app));
    else setTimeout(() => void loadDev().then((m) => m.installDev(app)), 1000);
  }, contentFailed);
}
