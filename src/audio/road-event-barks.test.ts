// Run W-U's sound pass also writes the rivals' lines for run W-T's road events (the boat slide, the
// gator crossing, the log spill, the cable-car runaway and the three lane votes), which had none: a
// set piece came up and nobody said a word. Each pack's `road-events` bark set must give every live
// modifier at least two lines, each spoken by a rival who rides that pack's events, so most races
// with the event have someone to say one.
import { describe, expect, it } from 'vitest';

const MODIFIERS = import.meta.glob('/packs/*/modifiers/*.json', { eager: true, import: 'default' });
const BARKS = import.meta.glob('/packs/*/barks/road-events-*.json', { eager: true, import: 'default' });
const EVENTS = import.meta.glob('/packs/*/events/*.json', { eager: true, import: 'default' });

type Rec = Record<string, unknown>;
const packOf = (path: string) => path.split('/')[2]!;
const bare = (id: string) => id.slice(id.indexOf(':') + 1);
const qualify = (pack: string, id: string) => (id.includes(':') ? id : `${pack}:${id}`);

/** Every rider any event of the pack lists, qualified. */
function ridersOf(pack: string): Set<string> {
  const out = new Set<string>();
  for (const [path, e] of Object.entries(EVENTS)) {
    if (packOf(path) !== pack) continue;
    const field = (e as Rec)['field'] as Rec | undefined;
    const riders = field?.['riders'] ?? (e as Rec)['riders'];
    if (Array.isArray(riders)) for (const r of riders) if (typeof r === 'string') out.add(qualify(pack, r));
  }
  return out;
}

interface Line {
  id: string;
  trigger: string;
  speaker?: string;
  when?: { fact: string; value: unknown }[];
  text: string;
  status?: string;
}

describe('road-event barks', () => {
  const modifiers = Object.entries(MODIFIERS)
    .map(([path, m]) => ({ pack: packOf(path), m: m as Rec }))
    .filter(({ m }) => ((m['meta'] as Rec | undefined)?.['status'] ?? 'live') === 'live');

  it('finds the packs, the modifiers and the bark sets', () => {
    expect(modifiers.length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(BARKS)).toHaveLength(3);
  });

  it.each(modifiers.map(({ pack, m }) => [`${pack}:${String(m['id'])}`, pack]))(
    '%s has two or more lines from rivals who ride there',
    (modId, pack) => {
      const set = Object.entries(BARKS).find(([path]) => packOf(path) === pack)?.[1] as Rec | undefined;
      expect(set, `no road-events set in ${pack}`).toBeDefined();
      const defaults = (set!['defaults'] as Rec | undefined) ?? {};
      const lines = (set!['lines'] as Line[]).filter(
        (l) =>
          l.trigger === 'modifier-start' &&
          (l.status ?? 'live') === 'live' &&
          (l.when ?? []).some((c) => c.fact === 'modifier.id' && c.value === modId),
      );
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const riders = ridersOf(pack);
      for (const l of lines) {
        const speaker = qualify(pack, l.speaker ?? String(defaults['speaker']));
        expect(riders.has(speaker), `${l.id}: ${speaker} rides no ${pack} event`).toBe(true);
        // The tone guide: aim for 42 characters, so it reads at speed.
        expect(l.text.length, l.id).toBeLessThanOrEqual(42);
        expect(bare(speaker).length).toBeGreaterThan(0);
      }
    },
  );
});
