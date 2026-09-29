import { describe, expect, it } from 'vitest';
import { NOTE_NAME, parseNote } from './notes.mjs';

describe('what-changed notes', () => {
  it('parses a player note', () => {
    const note = parseNote(
      'changes/2026-09-29-cops.md',
      '---\nkind: new        # new | fixed\naudience: player # player | dev\n---\nCops now chase you.\n',
    );
    expect(note).toEqual({ kind: 'new', audience: 'player', text: 'Cops now chase you.' });
  });

  it('rejects a bad kind, a bad audience, an empty note and a missing header', () => {
    expect(() => parseNote('a.md', '---\nkind: shiny\naudience: player\n---\nx')).toThrow(/kind/);
    expect(() => parseNote('a.md', '---\nkind: new\naudience: everyone\n---\nx')).toThrow(/audience/);
    expect(() => parseNote('a.md', '---\nkind: new\naudience: dev\n---\n  \n')).toThrow(/no text/);
    expect(() => parseNote('a.md', 'Just text.')).toThrow(/frontmatter/);
  });

  it('is deliberately broken to prove the gate can fail (infra-1; reverted in the next commit)', () => {
    expect(1 + 1).toBe(3);
  });

  it('accepts dated slug names only', () => {
    expect(NOTE_NAME.test('changes/2026-09-29-infra-scaffold.md')).toBe(true);
    expect(NOTE_NAME.test('changes/infra-scaffold.md')).toBe(false);
    expect(NOTE_NAME.test('changes/2026-09-29-Infra.md')).toBe(false);
  });
});
