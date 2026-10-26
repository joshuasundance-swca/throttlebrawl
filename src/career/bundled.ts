// The career maps ride with the career's own lazy chunk, not the first load (2026-10-26: main's
// first-load JavaScript stood at 499.0 of its 500 KB gzip, and the four career files were about 9 KB
// of it). The game's registry (content/packs.ts, content/base-pack.ts) carries every pack file but
// these; the career reads its maps through careersOf, which falls back to the bundled table here
// when the registry it is handed carries none. A registry built from every pack file (the tests'
// and tools' registryFromGlob) carries its own, and those win.
import { buildRegistry, groupPackFiles, packOf, type ContentRegistry } from '../content';

const FILES = import.meta.glob<unknown>(['/packs/*/careers/*.json', '/packs/*/pack.json'], {
  eager: true,
  import: 'default',
});

type Careers = ContentRegistry['careers'];
let bundled: Careers | null = null;

/** Every pack's career files, validated as the registry validates them (once). */
function bundledCareers(): Careers {
  if (bundled) return bundled;
  const out: Record<string, Careers[string]> = {};
  for (const files of groupPackFiles(FILES).values()) {
    if (!files.some((f) => f.path.startsWith('careers/'))) continue;
    Object.assign(out, buildRegistry(files).careers);
  }
  bundled = Object.freeze<Careers>(out);
  return bundled;
}

const byRegistry = new WeakMap<ContentRegistry, Careers>();

/**
 * The career files of a registry: its own when it carries any, else the bundled career files of
 * the packs it carries (the game's registry, whose first load leaves them out).
 */
export function careersOf(reg: ContentRegistry): Careers {
  // A hand-built registry (a test's) may have no careers table at all.
  const own = reg.careers as Careers | undefined;
  if (own && Object.keys(own).length > 0) return own;
  let table = byRegistry.get(reg);
  if (!table) {
    const carried = new Set((reg.packs ?? []).map((p) => p.id));
    table = Object.freeze<Careers>(
      Object.fromEntries(Object.entries(bundledCareers()).filter(([key]) => carried.has(packOf(key)))),
    );
    byRegistry.set(reg, table);
  }
  return table;
}
