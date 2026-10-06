#!/usr/bin/env node
// The gzip-copy probe (docs/engineering.md, "Deploy: game Space and staging Space", Offline;
// playtest 4 run B's live check, punch item 8). The game's host sends every file as stored, with no
// Content-Encoding, so the build stores a `.gz` copy beside each script, JSON file and model under
// assets/, and the offline worker downloads the copy and unpacks it (src/platform/offline-worker.ts).
// This asks the live game, as a deploy's smoke check or by hand, whether that still holds: for each
// script the page loads first (its entry and module preloads, which hold the largest copies), the
// plain file and its copy, each with `Accept-Encoding: gzip, br`, and whether the copy unpacks to
// the plain file byte for byte. The host answers the largest copies with a 302 to the Hub's CDN
// (us.aws.cdn.hf.co, 2026-10-06), which the worker's fetch follows in CORS mode, so a copy that came
// by a redirect must also carry an `Access-Control-Allow-Origin` the game's page passes (playtest 4
// run B fix check, punch item 7: the old probe sampled an 82-byte lazy chunk the host serves itself).
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

/**
 * The scripts the page loads first: its entry, then each module preload, page-relative, in page order.
 * @param {string} html
 * @returns {string[]}
 */
export function firstLoadScriptsOf(html) {
  const entry = entryOf(html);
  const preloads = [
    ...html.matchAll(/<link\b(?=[^>]*\brel="?modulepreload\b)[^>]*\bhref="(?:\.\/)?([^"]+)"/g),
  ].map((m) => m[1] ?? '');
  return [...new Set([...(entry ? [entry] : []), ...preloads])].filter(Boolean);
}

const sha = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');

/**
 * Whether a gzip copy, as the host answered it, gives the worker its file (offline-worker.ts's
 * fromGzipCopy): gzip bytes that unpack to the plain file, or bytes the host labelled
 * `Content-Encoding: gzip` (the browser unpacks them) that ungzip to it. A copy that came by a
 * redirect to another host (`via`) must also allow the game's origin to read it (`cors`, its
 * Access-Control-Allow-Origin), because the worker's fetch follows the redirect in CORS mode.
 * @param {{ status: number, encoding: string, body: Uint8Array, via?: string, cors?: string }} copy
 * @param {Uint8Array} plain
 * @param {string} [origin] the game's origin
 * @returns {{ ok: boolean, how: string }}
 */
export function judgeCopy(copy, plain, origin = '') {
  const hop = copy.via ? `, by a 302 to ${copy.via}` : '';
  if (copy.status !== 200) return { ok: false, how: `the copy answered ${copy.status}${hop}` };
  if (copy.via && copy.cors !== '*' && !(origin && copy.cors === origin))
    return {
      ok: false,
      how: `the copy came by a 302 to ${copy.via} with Access-Control-Allow-Origin "${copy.cors ?? ''}", so the worker cannot read it`,
    };
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
  return { ok: true, how: `${label}${hop}` };
}

/**
 * One GET with `Accept-Encoding: gzip, br` (and the game's Origin, as a CORS request carries), the
 * body as sent (never decoded).
 */
function get(url, origin = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'accept-encoding': 'gzip, br',
          'cache-control': 'no-cache',
          ...(origin ? { origin } : {}),
        },
      },
      (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            encoding: String(res.headers['content-encoding'] ?? ''),
            type: String(res.headers['content-type'] ?? ''),
            location: String(res.headers.location ?? ''),
            cors: String(res.headers['access-control-allow-origin'] ?? ''),
            body: new Uint8Array(Buffer.concat(parts)),
          }),
        );
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`${url}: no answer in 30 s`)));
    req.on('error', reject);
  });
}

/**
 * A GET that follows up to 3 redirects (a stored file the host hands to its file store), with
 * `via`, the host it was redirected to ('' when the host answered itself).
 */
async function getFollowing(url, origin = '') {
  let at = url;
  let res = await get(at, origin);
  for (let i = 0; i < 3 && res.status >= 300 && res.status < 400 && res.location; i++) {
    at = new URL(res.location, at).href;
    res = await get(at, origin);
  }
  const via = new URL(at).host === new URL(url).host ? '' : new URL(at).host;
  return { ...res, via };
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
  const origin = new URL(base).origin;
  const samples = firstLoadScriptsOf(new TextDecoder().decode(page.body));
  const copies = [];
  let failed = 0;
  for (const rel of samples) {
    const plain = await getFollowing(`${base}${rel}`, origin);
    const copy = await getFollowing(`${base}${rel}.gz`, origin);
    const verdict = judgeCopy(copy, plain.body, origin);
    if (!verdict.ok) failed++;
    copies.push({ rel, bytes: copy.body.length, via: copy.via });
    console.log(
      `gzip-probe: ${rel}: plain ${plain.status}, ${plain.body.length} bytes on the wire, ` +
        `Content-Encoding "${plain.encoding || 'none'}"; copy ${copy.status}, ${copy.body.length} bytes, ` +
        `type "${copy.type}", Content-Encoding "${copy.encoding || 'none'}": ${verdict.ok ? 'works' : 'FAILS'}, ${verdict.how}`,
    );
  }
  const largest = [...copies].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  const redirected = copies.filter((c) => c.via).length;
  console.log(
    `[examined] ${config.cache} at ${base}: the page's ${samples.length} first-load scripts (its entry and module ` +
      `preloads), each plain and as its gzip copy; ${redirected} of the ${copies.length} copies came by a redirect ` +
      `to another host; the largest copies: ${largest.map((c) => `${c.rel} ${c.bytes} bytes${c.via ? ` via ${c.via}` : ''}`).join(', ')}`,
  );
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`gzip-probe: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
