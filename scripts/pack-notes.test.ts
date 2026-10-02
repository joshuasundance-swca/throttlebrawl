import { describe, expect, it } from 'vitest';
import { isPackJsonModule, stripPackNotes, stripPackNotesPlugin } from './pack-notes.mjs';

describe('pack notes stay out of the build', () => {
  it("drops every meta object's notes, and nothing else", () => {
    const entry = {
      type: 'event',
      id: 'x',
      notes: 'a top-level field named notes is not meta: kept',
      meta: { status: 'live', notes: 'why the numbers are what they are', provenance: { origin: 'agent' } },
      lines: [{ id: 'l1', text: 'hi', meta: { notes: 'line notes' } }],
    };
    const out = stripPackNotes(JSON.stringify(entry, null, 2));
    expect(JSON.parse(out ?? '')).toEqual({
      type: 'event',
      id: 'x',
      notes: 'a top-level field named notes is not meta: kept',
      meta: { status: 'live', provenance: { origin: 'agent' } },
      lines: [{ id: 'l1', text: 'hi', meta: {} }],
    });
  });

  it('leaves a file without notes, and one that does not parse, alone', () => {
    expect(stripPackNotes('{"type":"bike","meta":{"status":"live"}}')).toBeNull();
    expect(stripPackNotes('{ not json')).toBeNull();
  });

  it('applies to bundled pack JSON only: not road data shipped as files, not other JSON', () => {
    expect(isPackJsonModule('/repo/packs/base/events/keys-t1-shakedown.json')).toBe(true);
    expect(isPackJsonModule('C:\\repo\\packs\\region-sf\\careers\\sf-circuit.json')).toBe(true);
    expect(isPackJsonModule('/repo/packs/base/regions/florida-keys/roads/osm-x.json?url')).toBe(false);
    expect(isPackJsonModule('/repo/src/save/fixtures/settings-v1-m1.json')).toBe(false);
    const plugin = stripPackNotesPlugin();
    expect(plugin).toMatchObject({ apply: 'build', enforce: 'pre' });
    const r = plugin.transform('{"meta":{"notes":"n","status":"live"}}', '/repo/packs/base/bikes/x.json');
    expect(r && JSON.parse(r.code)).toEqual({ meta: { status: 'live' } });
  });
});
