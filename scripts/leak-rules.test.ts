import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAllowedEmail, scanFileName, scanText } from './leak-rules.mjs';

// The must-match samples are assembled at runtime, so this file's own text never trips the
// scanner that `leakscan:all` runs over it. The names in them are made up.
const join = (...parts: string[]): string => parts.join('');
const rulesIn = (text: string): string[] => scanText(text).map((f) => f.rule);

describe('leak scan: must match', () => {
  it.each([
    ['a Windows home path', join('C:', '\\Users\\', 'jdoe', '\\code\\game'), 'home-path'],
    ['a Windows home path with forward slashes', join('C:', '/Users/', 'jdoe', '/code'), 'home-path'],
    ['an escaped Windows home path', join('"C:', '\\\\Users\\\\', 'jdoe', '\\\\code"'), 'home-path'],
    ['a macOS home path', join('/Us', 'ers/', 'jdoe', '/code'), 'home-path'],
    ['a Linux home path', join('/ho', 'me/', 'jdoe', '/.config'), 'home-path'],
    ['a Git Bash home path', join('/c/Us', 'ers/', 'jdoe', '/code'), 'home-path'],
    ['a real-looking email', join('jane.doe', '@', 'acme-widgets.io'), 'email'],
    ['a 10.x address', join('10.', '1.2.3'), 'private-address'],
    ['a 192.168.x address', join('192.', '168.0.12'), 'private-address'],
    ['a 172.16-31.x address', join('172.', '20.4.5'), 'private-address'],
    ['a default Windows machine name', join('DESKTOP', '-A1B2C3D'), 'machine-name'],
    ['an internal hostname', join('build01', '.corp'), 'machine-name'],
  ])('flags %s', (_name, text, rule) => {
    expect(rulesIn(text)).toContain(rule);
  });

  it('flags env and key files by name', () => {
    for (const file of ['.env', 'app/.env.local', 'certs/server.pem', 'deploy.key', 'id_ed25519']) {
      expect(scanFileName(file), file).toHaveLength(1);
    }
  });

  it('rejects emails that are not no-reply addresses', () => {
    expect(isAllowedEmail(join('someone', '@', 'mail-provider.net'))).toBe(false);
  });

  it('applies a private deny pattern and never prints what it matched', () => {
    const findings = scanText(join('built at Glo', 'bex Corp'), { deny: [/globex/i] });
    expect(findings).toEqual([{ rule: 'private-denylist#1', line: 1, excerpt: '' }]);
  });

  it('masks what it found', () => {
    const [finding] = scanText(join('C:', '\\Users\\', 'jdoe'));
    expect(finding?.excerpt).not.toContain('jdoe');
  });

  it('reports the line number', () => {
    expect(scanText(join('ok\nok\n', 'jane', '@', 'acme-widgets.io'))[0]?.line).toBe(3);
  });
});

describe('leak scan: must not match', () => {
  it.each([
    ['the docs placeholder Windows path', 'C:\\Users\\<name>\\'],
    ['the docs placeholder macOS path', '/Users/<name>/'],
    ['the docs placeholder Linux path', '/home/<name>/'],
    ['the no-reply placeholder', '<id>+<login>@users.noreply.github.com'],
    ['a numeric no-reply address', '12345+someone@users.noreply.github.com'],
    ['the commit trailer address', 'Co-Authored-By: Claude <noreply@anthropic.com>'],
    ['the GitHub squash committer', 'GitHub <noreply@github.com>'],
    ['an example.com address', 'player@example.com'],
    ['the public users folder', 'C:\\Users\\Public\\Desktop'],
    ['the loopback address', "host: '127.0.0.1'"],
    ['version numbers', 'Windows 10.0.22631, three 0.186.1, node 22.20.0'],
    ['an npm scoped package', '"@types/three": "0.186.0"'],
    ['local notes files', 'checkpoint.local.md and *.local.md are ignored'],
    ['a local env file name', 'app/.env.local is git-ignored'],
    ['a URL path that contains /home/', 'https://example.com/home/page'],
    ['angle-bracket placeholders', 'hf upload <hf-user>/<space> and <github-owner>/throttlebrawl'],
  ])('passes %s', (_name, text) => {
    expect(scanText(text)).toEqual([]);
  });

  it('passes safe file names', () => {
    for (const file of ['.env.example', 'src/main.ts', 'docs/engineering.md', 'keys.json']) {
      expect(scanFileName(file), file).toEqual([]);
    }
  });

  it('passes the docs that describe the rules, with their own examples', () => {
    for (const doc of ['../docs/engineering.md', '../AGENTS.md', '../docs/milestones/M1.md']) {
      const text = readFileSync(new URL(doc, import.meta.url), 'utf8');
      expect(scanText(text), doc).toEqual([]);
    }
  });
});
