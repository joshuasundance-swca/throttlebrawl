// The bundled bark clips' URLs. This module is only ever imported dynamically (bark-voices.ts),
// so the table is a lazy chunk: the first load carries none of it, and each clip file is fetched
// the first time its line is said. `?no-inline` keeps even the shortest clip a file of its own
// rather than base64 in this chunk.
import { barkClipPath } from './bark-voices';

const CLIPS = import.meta.glob<string>('/packs/*/assets/audio/barks/**/*.ogg', {
  eager: true,
  query: '?no-inline',
  import: 'default',
});

/** The clip URL for a bark line's content reference, or null when the line has no clip. */
export function bundledClipUrl(contentRef: string): string | null {
  const at = barkClipPath(contentRef);
  return at ? (CLIPS[`/packs/${at.packId}/${at.path}`] ?? null) : null;
}
