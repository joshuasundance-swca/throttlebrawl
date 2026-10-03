// Pack notes stay out of the build (run W-R, the first-load JavaScript budget). Every pack entry
// may carry `meta.notes`: the why behind its numbers, for the people and agents who edit it. The
// game never reads them, yet the pack JSON the first screen needs is bundled into the first-load
// JavaScript, notes and all (about 10 KB of its 500 KB gzip budget in run W-R). This build-only
// plugin drops each `meta` object's `notes` from the pack JSON modules the bundle imports. The
// files on disk, the pack check, the tests and the dev server keep them; the road data shipped as
// separate files (`?url`) is untouched, and no sim-facing field changes, so replay keys hold.
// The voice picks' taste log goes the same way (run W-S): each bark line's `audioNote` and each
// set's `meta.voice.review`, which only people and the voice tools read (about 3.8 KB gzip).

/** The pack JSON's text without any `meta.notes`, `audioNote` or `meta.voice.review`, or null when it does not parse (left alone). */
export function stripPackNotes(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  let dropped = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    if ('audioNote' in v) {
      delete v.audioNote;
      dropped++;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'meta' && x && typeof x === 'object' && !Array.isArray(x)) {
        if ('notes' in x) {
          delete x.notes;
          dropped++;
        }
        const voice = x.voice;
        if (voice && typeof voice === 'object' && !Array.isArray(voice) && 'review' in voice) {
          delete voice.review;
          dropped++;
        }
      }
      walk(x);
    }
  };
  walk(data);
  return dropped > 0 ? JSON.stringify(data) : null;
}

/** A pack JSON module the bundle imports (not a `?url` file, which ships on its own). */
export function isPackJsonModule(id) {
  return /[\\/]packs[\\/].+\.json$/.test(id) && !id.includes('?');
}

/** The Vite plugin: before Vite turns the JSON into a module, its notes go. Build only. */
export function stripPackNotesPlugin() {
  return {
    name: 'throttlebrawl:strip-pack-notes',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!isPackJsonModule(id)) return null;
      const out = stripPackNotes(code);
      return out === null ? null : { code: out, map: null };
    },
  };
}
