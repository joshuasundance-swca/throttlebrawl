import { describe, expect, it } from 'vitest';
import { DEPENDABOT_EMAIL, NOTE_NAME, dependabotExempt, dependabotOnlyCommits, parseNote } from './notes.mjs';

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

  describe('the Dependabot exemption', () => {
    const bot = DEPENDABOT_EMAIL;
    const human = '12345+someone@users.noreply.github.com';

    it('exempts a PR that Dependabot opened and only Dependabot committed to', () => {
      expect(dependabotExempt('dependabot[bot]', [bot])).toBe(true);
      expect(dependabotExempt('dependabot[bot]', [bot, bot])).toBe(true);
    });

    it('does not exempt a PR opened by anyone else, even with Dependabot commits', () => {
      expect(dependabotExempt('someone', [bot])).toBe(false);
      expect(dependabotExempt('', [bot])).toBe(false);
      expect(dependabotExempt(undefined, [bot])).toBe(false);
      expect(dependabotExempt('dependabot', [bot])).toBe(false);
    });

    it('does not exempt a Dependabot PR that someone else also committed to', () => {
      expect(dependabotExempt('dependabot[bot]', [bot, human])).toBe(false);
      expect(dependabotExempt('dependabot[bot]', [human])).toBe(false);
    });

    it('does not exempt a Dependabot PR with no commits to look at', () => {
      expect(dependabotExempt('dependabot[bot]', [])).toBe(false);
    });

    it('reads the branch without merge commits and counts Dependabot commits when exempt', () => {
      const calls: string[][] = [];
      const git = (log: string) => (args: string[]) => {
        calls.push(args);
        return log;
      };
      expect(dependabotOnlyCommits(git(`${bot}\n${bot}\n`), 'abc', 'dependabot[bot]')).toBe(2);
      expect(calls[0]).toEqual(['log', '--no-merges', '--format=%ae', 'abc..HEAD']);
      expect(dependabotOnlyCommits(git(`${bot}\n${human}\n`), 'abc', 'dependabot[bot]')).toBe(0);
      expect(dependabotOnlyCommits(git(`${bot}\n`), 'abc', 'someone')).toBe(0);
      calls.length = 0;
      expect(dependabotOnlyCommits(git(`${bot}\n`), 'abc', undefined)).toBe(0);
      expect(calls).toEqual([]); // no PR author: git is not even asked
    });
  });

  it('accepts dated slug names only', () => {
    expect(NOTE_NAME.test('changes/2026-09-29-infra-scaffold.md')).toBe(true);
    expect(NOTE_NAME.test('changes/infra-scaffold.md')).toBe(false);
    expect(NOTE_NAME.test('changes/2026-09-29-Infra.md')).toBe(false);
  });
});
