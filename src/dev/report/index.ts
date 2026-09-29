// "Copy debug report" (docs/milestones/M1.md, dev-3). Wired in from the composition root, because
// nothing imports dev/. The skeleton's body copies a few lines; dev-3 builds the full 2 KB summary
// and the "save debug file" button. Nothing is ever sent anywhere automatically.
import type { AppHandle } from '../../app';

export function reportText(app: AppHandle): string {
  const stats = app.rendererStats();
  const hashes = app.contentHashes();
  return [
    `throttlebrawl debug report`,
    `build ${app.build.id} · ${app.build.channel} · ${app.build.branch}`,
    `replay key ${app.replayKey()}`,
    `content sim ${hashes.sim} full ${hashes.full}`,
    `renderer ${stats.renderer} · ratio ${stats.pixelRatio} · ${stats.width}x${stats.height}`,
    `state ${app.state()}`,
  ].join('\n');
}

export async function copyReport(app: AppHandle): Promise<void> {
  const text = reportText(app);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    console.warn('copy debug report: the clipboard is not available here');
  }
}
