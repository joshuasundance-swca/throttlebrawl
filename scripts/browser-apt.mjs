// Only invoked on ephemeral Linux CI runners, before Playwright's full dependency install.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OLD_MIRROR = 'http://azure.archive.ubuntu.com/ubuntu';
const NEW_MIRROR = 'https://archive.ubuntu.com/ubuntu';

/** @param {string} uri */
function rewriteUri(uri) {
  if (uri === OLD_MIRROR) return NEW_MIRROR;
  if (uri === `${OLD_MIRROR}/`) return `${NEW_MIRROR}/`;
  return uri;
}

/** Changes source URI fields only; comments, security sources and signature fields stay verbatim.
 * @param {string} text
 * @param {'list' | 'sources'} format
 */
export function rewriteUbuntuMirror(text, format) {
  let inUris = false;
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      if (format === 'list') {
        return line.replace(
          /^([\t ]*deb(?:-src)?[\t ]+(?:\[[^\]]*\][\t ]+)?)(\S+)/,
          (_match, prefix, uri) => prefix + rewriteUri(uri),
        );
      }
      if (/^\s*$/.test(line)) inUris = false;
      if (/^#/.test(line)) return line;
      if (!/^[\t ]/.test(line)) inUris = /^URIs:/i.test(line);
      if (!inUris) return line;
      const prefixLength = /^URIs:/i.test(line) ? 5 : 0;
      return line.slice(0, prefixLength) + line.slice(prefixLength).replace(/\S+/g, rewriteUri);
    })
    .join('');
}

export const APT_TRANSPORT_CONFIG =
  'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "2";\n';

/** @param {string} path @returns {Promise<string | undefined>} */
async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Prepare a supplied APT directory; the CLI uses /etc/apt, tests use a fixture directory.
 * @param {string} aptRoot
 * @returns {Promise<number>} Number of source files changed.
 */
export async function prepareBrowserApt(aptRoot) {
  let names;
  try {
    names = await readdir(join(aptRoot, 'sources.list.d'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    names = [];
  }
  const files = [
    { path: join(aptRoot, 'sources.list'), format: 'list' },
    ...names
      .filter((name) => name.endsWith('.list') || name.endsWith('.sources'))
      .map((name) => ({
        path: join(aptRoot, 'sources.list.d', name),
        format: name.endsWith('.sources') ? 'sources' : 'list',
      })),
  ];
  let changed = 0;
  for (const { path, format } of files) {
    const before = await readOptional(path);
    if (before === undefined) continue;
    const after = rewriteUbuntuMirror(before, format);
    if (after !== before) {
      await writeFile(path, after, 'utf8');
      changed++;
    }
  }
  await mkdir(join(aptRoot, 'apt.conf.d'), { recursive: true });
  await writeFile(join(aptRoot, 'apt.conf.d', '99browser-transport'), APT_TRANSPORT_CONFIG, 'utf8');
  return changed;
}

// Importing the pure transformation for tests must never prepare the host's APT directory.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'linux') throw new Error('Browser APT preparation requires a Linux CI runner');
  const changed = await prepareBrowserApt('/etc/apt');
  console.log(`Browser APT preparation: ${changed} source files changed; transport limits configured`);
}
