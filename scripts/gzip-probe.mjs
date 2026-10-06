#!/usr/bin/env node
// The gzip-copy probe (docs/engineering.md, "Deploy: game Space and staging Space", Offline;
// playtest 4 run B's live check, punch item 8). The game's host sends every file as stored, with no
// Content-Encoding, so the build stores a `.gz` copy beside each script, JSON file and model under
// assets/, and the offline worker downloads the copy and unpacks it (src/platform/offline-worker.ts).
// This asks the live game, as a deploy's smoke check or by hand, whether that still holds: for the
// entry script and one lazy chunk, the plain file and its copy, each with `Accept-Encoding: gzip, br`,
// and whether the copy unpacks to the plain file byte for byte.
//
//   node scripts/gzip-probe.mjs --url https://<game link> [--build <short sha>] [--wait <seconds>]
//
// --build waits (up to --wait seconds, 600 by default) until the host's sw.js names that build.
// Prints what it examined; exits 1 when a copy is missing or does not unpack to its file, 0 when
// every copy works or the build names no copies (an older build), 2 when the host never served
// the build asked for.
import { createHash } from 'node:crypto';
import https from 'node:https';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

/**
 * The offline worker's config from the worker file's source (scripts/service-worker.mjs writes
 * `self.__OFFLINE__=<json>;` first), or null.
 * @param {string} src
 * @returns {{ cache: string, files: string[], gzip?: string[] } | null}
 */
export function workerConfigOf(src) {
  const m = /^self\.__OFFLINE__=(\{.*?\});\n/s.exec(src);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** The page's entry script (Vite's module script tag), page-relative. */
export function entryOf(html) {
  return /<script\b[^>]*\btype="module"[^>]*\bsrc="(?:\.\/)?([^"]+)"/.exec(html)?.[1] ?? null;
}

const sha = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');

/**
 * Whether a gzip copy, as the host answered it, gives the worker its file (offline-worker.ts's
 * fromGzipCopy): gzip bytes that unpack to the plain file, or bytes the host labelled
 * `Content-Encoding: gzip` (the browser unpacks them) that ungzip to it.
 * @param {{ status: number, encoding: string, body: Uint8Array }} copy
 * @param {Uint8Array} plain
 * @returns {{ ok: boolean, how: string }}
 */
export function judgeCopy(copy, plain) {
  if (copy.status !== 200) return { ok: false, how: `the copy answered ${copy.status}` };
  const gz = copy.body[0] === 0x1f && copy.body[1] === 0x8b;
  if (!gz) return { ok: false, how: 'the copy is not gzip bytes' };
  let unpacked;
  try {
    unpacked = gunzipSync(copy.body);
  } catch (err) {
    return { ok: false, how: `the copy does not unpack (${err instanceof Error ? err.message : err})` };
  }
  if (sha(unpacked) !== sha(plain))
    return { ok: false, how: 'the copy unpacks to other bytes than its file' };
  const label = /\bgzip\b/i.test(copy.encoding)
    ? 'labelled Content-Encoding: gzip (the browser unpacks it)'
    : 'sent as raw gzip bytes (the worker unpacks it)';
  return { ok: true, how: label };
}

/** One GET with `Accept-Encoding: gzip, br`, the body as sent (never decoded). */
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'accept-encoding': 'gzip, br', 'cache-control': 'no-cache' } },
      (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            encoding: String(res.headers['content-encoding'] ?? ''),
            type: String(res.headers['content-type'] ?? ''),
            location: String(res.headers.location ?? ''),
            body: new Uint8Array(Buffer.concat(parts)),
          }),
        );
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`${url}: no answer in 30 s`)));
    req.on('error', reject);
  });
}

/** A GET that follows up to 3 redirects (a stored file the host hands to its file store). */
async function getFollowing(url) {
  let res = await get(url);
  for (let i = 0; i < 3 && res.status >= 300 && res.status < 400 && res.location; i++)
    res = await get(new URL(res.location, url).href);
  return res;
}

async function main() {
  const { values } = parseArgs({
    options: { url: { type: 'string' }, build: { type: 'string' }, wait: { type: 'string', default: '600' } },
  });
  if (!values.url) throw new Error('--url <game link> is required');
  const base = values.url.endsWith('/') ? values.url : `${values.url}/`;
  const deadline = Date.now() + Number(values.wait) * 1000;
  let config;
  for (;;) {
    config = workerConfigOf(new TextDecoder().decode((await get(`${base}sw.js`)).body));
    if (!values.build || config?.cache.startsWith(`offline-${values.build.slice(0, 7)}-`)) break;
    if (Date.now() > deadline) {
      console.error(`gzip-probe: the host still serves ${config?.cache ?? 'no worker'}, not ${values.build}`);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (!config) throw new Error('the host serves no offline worker config');
  if (!config.gzip?.length) {
    console.log(
      `gzip-probe: ${config.cache} names no gzip copies (a build from before them); nothing to check`,
    );
    return;
  }
  const page = await get(`${base}index.html`);
  const entry = entryOf(new TextDecoder().decode(page.body));
  if (!entry) throw new Error('index.html loads no entry script');
  const lazy = config.files.find((f) => f.startsWith('assets/') && f.endsWith('.js') && f !== entry);
  let failed = 0;
  for (const rel of [entry, lazy].filter(Boolean)) {
    const plain = await getFollowing(`${base}${rel}`);
    const copy = await getFollowing(`${base}${rel}.gz`);
    const verdict = judgeCopy(copy, plain.body);
    if (!verdict.ok) failed++;
    console.log(
      `gzip-probe: ${rel}: plain ${plain.status}, ${plain.body.length} bytes on the wire, ` +
        `Content-Encoding "${plain.encoding || 'none'}"; copy ${copy.status}, ${copy.body.length} bytes, ` +
        `type "${copy.type}", Content-Encoding "${copy.encoding || 'none'}": ${verdict.ok ? 'works' : 'FAILS'}, ${verdict.how}`,
    );
  }
  console.log(
    `[examined] ${config.cache} at ${base}: the entry script and 1 lazy chunk, each plain and as its gzip copy`,
  );
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`gzip-probe: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
