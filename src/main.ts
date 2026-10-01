// The composition root (docs/architecture.md, "Dependency rules"). It sits outside the module
// graph, may import app/ and dev/, and supplies the callbacks the graph does not draw: here the
// debug report from dev/ reaches the UI through app/. Nothing else imports dev/, so dev/ ships in
// production builds without any module depending on it.
import { createApp, type AppHandle } from './app';
import { copyReport, installDev, saveDebugFile, testFlagSet } from './dev';

function boot(): void {
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
        onCopyReport: () => (app ? copyReport(app) : Promise.resolve()),
        onSaveDebugFile: () => (app ? saveDebugFile(app) : Promise.resolve()),
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
    return;
  }
  installDev(app);
}

boot();
