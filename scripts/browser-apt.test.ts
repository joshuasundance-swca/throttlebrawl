import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APT_TRANSPORT_CONFIG, prepareBrowserApt, rewriteUbuntuMirror } from './browser-apt.mjs';

const oldMirror = 'http://azure.archive.ubuntu.com/ubuntu';
const newMirror = 'https://archive.ubuntu.com/ubuntu';

describe('browser dependency APT preparation', () => {
  it('changes only active traditional source URI fields, preserving options and security', () => {
    const before = [
      `deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] ${oldMirror} noble main`,
      `deb-src ${oldMirror}/ noble-updates universe`,
      'deb http://security.ubuntu.com/ubuntu noble-security main',
      `# deb ${oldMirror} noble main`,
      `deb https://example.org/ubuntu noble main # ${oldMirror}`,
      `deb ${oldMirror}-other noble main`,
      `deb ${oldMirror}/extra noble main`,
    ].join('\n');
    const expected = before
      .replace(`] ${oldMirror} noble`, `] ${newMirror} noble`)
      .replace(`deb-src ${oldMirror}/`, `deb-src ${newMirror}/`);
    expect(rewriteUbuntuMirror(before, 'list')).toBe(expected);
  });

  it('changes deb822 URI tokens including folded multi-mirror fields, leaving signatures intact', () => {
    const before = [
      'Types: deb deb-src',
      `URIs: ${oldMirror} https://example.org/ubuntu`,
      ` ${oldMirror}/ http://security.ubuntu.com/ubuntu`,
      'Suites: noble noble-updates',
      'Components: main universe',
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
      '',
      `# URIs: ${oldMirror}`,
      'Types: deb',
      'URIs: http://security.ubuntu.com/ubuntu',
      'Suites: noble-security',
      `X-Comment: ${oldMirror}`,
      'Signed-By:',
      ' -----BEGIN PGP PUBLIC KEY BLOCK-----',
      ` ${oldMirror}`,
      ' -----END PGP PUBLIC KEY BLOCK-----',
      '',
    ].join('\r\n');
    const expected = before
      .replace(`URIs: ${oldMirror} https`, `URIs: ${newMirror} https`)
      .replace(` ${oldMirror}/ http`, ` ${newMirror}/ http`);
    expect(rewriteUbuntuMirror(before, 'sources')).toBe(expected);
  });

  it('leaves similar hosts, paths and HTTPS Azure sources untouched', () => {
    const before = [
      `URIs: ${oldMirror}/extra`,
      ` ${oldMirror}-other`,
      ' https://azure.archive.ubuntu.com/ubuntu',
      ' http://azure.archive.ubuntu.com.example/ubuntu',
    ].join('\n');
    expect(rewriteUbuntuMirror(before, 'sources')).toBe(before);
  });

  it('accepts a deb822 URI field without whitespace after its colon', () => {
    expect(rewriteUbuntuMirror(`URIs:${oldMirror}\n`, 'sources')).toBe(`URIs:${newMirror}\n`);
  });

  it('rewrites only mirrorlist URI tokens and preserves comments, blanks and tab metadata', () => {
    const before = [
      `# ${oldMirror}`,
      `  # ${oldMirror}`,
      '',
      `${oldMirror}\tpriority:1 arch:amd64`,
      `${oldMirror}/`,
      'https://archive.ubuntu.com/ubuntu\tpriority:2',
      `https://example.org/ubuntu\tcomment:${oldMirror}`,
      `${oldMirror}/other`,
      `${oldMirror}#other`,
      'http://security.ubuntu.com/ubuntu',
      '',
    ].join('\r\n');
    const expected = before
      .replace(`${oldMirror}\tpriority:1`, `${newMirror}\tpriority:1`)
      .replace(`${oldMirror}/\r\n`, `${newMirror}/\r\n`);
    expect(rewriteUbuntuMirror(before, 'mirrorlist')).toBe(expected);
    expect(rewriteUbuntuMirror(expected, 'mirrorlist')).toBe(expected);
  });

  it('prepares the observed apt-mirrors.txt while preserving mirror+file sources and other files', async () => {
    await mkdir('scratch', { recursive: true });
    const root = await mkdtemp(join('scratch', 'browser-apt-'));
    try {
      await mkdir(join(root, 'sources.list.d'));
      const source = [
        'Types: deb',
        'URIs: mirror+file:/etc/apt/apt-mirrors.txt',
        'Suites: noble noble-updates noble-security',
        'Components: main universe',
        'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
        '',
      ].join('\n');
      const mirrorlist = `${oldMirror}\tpriority:1\nhttps://archive.ubuntu.com/ubuntu\tpriority:2\n`;
      const otherSource = 'deb mirror+file:/etc/apt/custom-mirrors.txt noble main\n';
      await writeFile(join(root, 'sources.list.d', 'ubuntu.sources'), source);
      await writeFile(join(root, 'sources.list.d', 'other.list'), otherSource);
      await writeFile(join(root, 'apt-mirrors.txt'), mirrorlist);
      await writeFile(join(root, 'custom-mirrors.txt'), mirrorlist);
      expect(await prepareBrowserApt(root)).toBe(1);
      expect(await readFile(join(root, 'apt-mirrors.txt'), 'utf8')).toBe(
        mirrorlist.replace(oldMirror, newMirror),
      );
      expect(await readFile(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8')).toBe(source);
      expect(await readFile(join(root, 'sources.list.d', 'other.list'), 'utf8')).toBe(otherSource);
      expect(await readFile(join(root, 'custom-mirrors.txt'), 'utf8')).toBe(mirrorlist);
      expect(await prepareBrowserApt(root)).toBe(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('is idempotent in both source formats', () => {
    for (const format of ['list', 'sources'] as const) {
      const before = format === 'list' ? `deb ${oldMirror} noble main\n` : `URIs: ${oldMirror}\n`;
      const once = rewriteUbuntuMirror(before, format);
      expect(rewriteUbuntuMirror(once, format)).toBe(once);
    }
  });

  it('bounds HTTP and HTTPS transport waits and retry count with standard APT options', () => {
    expect(APT_TRANSPORT_CONFIG).toBe(
      'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "2";\n',
    );
  });

  it('prepares both source locations and config in a fixture directory without touching backups', async () => {
    await mkdir('scratch', { recursive: true });
    const root = await mkdtemp(join('scratch', 'browser-apt-'));
    try {
      await mkdir(join(root, 'sources.list.d'));
      const list = `deb ${oldMirror} noble main\n`;
      const sources = `Types: deb\nURIs: ${oldMirror}\nSuites: noble\nSigned-By: /keyring.gpg\n`;
      await writeFile(join(root, 'sources.list'), list);
      await writeFile(join(root, 'sources.list.d', 'extra.list'), list);
      await writeFile(join(root, 'sources.list.d', 'ubuntu.sources'), sources);
      await writeFile(join(root, 'sources.list.d', 'ubuntu.sources.save'), sources);
      expect(await prepareBrowserApt(root)).toBe(3);
      expect(await readFile(join(root, 'sources.list'), 'utf8')).toBe(list.replace(oldMirror, newMirror));
      expect(await readFile(join(root, 'sources.list.d', 'extra.list'), 'utf8')).toBe(
        list.replace(oldMirror, newMirror),
      );
      expect(await readFile(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8')).toBe(
        sources.replace(oldMirror, newMirror),
      );
      expect(await readFile(join(root, 'sources.list.d', 'ubuntu.sources.save'), 'utf8')).toBe(sources);
      expect(await readFile(join(root, 'apt.conf.d', '99browser-transport'), 'utf8')).toBe(
        APT_TRANSPORT_CONFIG,
      );
      expect(await prepareBrowserApt(root)).toBe(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('prepares an APT directory with no traditional source file or snippets', async () => {
    await mkdir('scratch', { recursive: true });
    const root = await mkdtemp(join('scratch', 'browser-apt-'));
    try {
      expect(await prepareBrowserApt(root)).toBe(0);
      expect(await readFile(join(root, 'apt.conf.d', '99browser-transport'), 'utf8')).toBe(
        APT_TRANSPORT_CONFIG,
      );
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
