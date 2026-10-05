// The credits page's data (docs/milestones/M5.md, credits-1; docs/content-packs.md, "Provenance and
// licence of road data": "The credits screen is generated from the data. Nobody hand-maintains the
// credits"). Every row of THIRD_PARTY_ASSETS.md, every licenseRules attribution in a pack manifest,
// every `provenance.sources` credit in a baked road file, and the licence texts the licences
// require (a pack's `licenseFile`, the repo's MIT, the shipped npm packages' own) go into
// dist/credits.json, which the in-game credits page fetches. The build fails when a ledger row
// cannot be read or a licence has no text to show, so a logged asset is never silently left out.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CREDITS_FORMAT = 1;
/** Where the page and the build write it (beside index.html). */
const CREDITS_FILE = 'credits.json';

/** Licences whose terms need no text shown (a public-domain dedication). */
const NO_TEXT_NEEDED = new Set(['LicenseRef-US-Public-Domain', 'CC0-1.0']);
/** The licences' plain names, for the page; an id with no entry here is shown as its id. */
const LICENCE_NAMES = { 'ODbL-1.0': 'Open Database Licence (ODbL) 1.0', MIT: 'MIT licence' };
/** Where a map-data licence asks to be credited, when a source gives no link of its own. */
const LICENCE_LINKS = { 'ODbL-1.0': 'https://www.openstreetmap.org/copyright' };

const CELLS = ['asset', 'source', 'licence', 'ai', 'usedIn'];

/** Splits a markdown table row into its trimmed cells. */
function cellsOf(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * The ledger (THIRD_PARTY_ASSETS.md) as data: one entry per table row, wherever the row sits (a
 * blank line splitting the table does not drop the rows after it), and the paragraphs after the
 * first row as notices. A row that does not have the five columns, or whose AI column is not Yes or
 * No, is an error: it would otherwise be missing from the credits.
 * @param {string} text
 * @returns {{ entries: { asset: string, source: string, licence: string, ai: boolean }[], notices: string[] }}
 */
export function parseLedger(text) {
  const entries = [];
  const notices = [];
  let seenRow = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!line.startsWith('|')) {
      if (seenRow) notices.push(line);
      continue;
    }
    const cells = cellsOf(line);
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // the separator
    if (!seenRow && cells[0]?.toLowerCase() === 'asset') {
      seenRow = true; // the header
      continue;
    }
    seenRow = true;
    if (cells.length !== CELLS.length) {
      throw new Error(
        `THIRD_PARTY_ASSETS.md: a row has ${cells.length} cells, not ${CELLS.length}: ${line.slice(0, 80)}`,
      );
    }
    const [asset = '', source = '', licence = '', ai = ''] = cells;
    const answer = /^\**(yes|no)\b/i.exec(ai)?.[1]?.toLowerCase();
    if (!answer) {
      throw new Error(
        `THIRD_PARTY_ASSETS.md: the AI-generated cell must start with Yes or No: ${line.slice(0, 80)}`,
      );
    }
    entries.push({ asset, source, licence, ai: answer === 'yes' });
  }
  return { entries, notices };
}

/**
 * Walks a parsed pack JSON for `provenance.sources` credits.
 * @param {unknown} json
 * @returns {{ name: string, attribution: string, spdx: string, url: string | null }[]}
 */
export function provenanceSources(json) {
  const sources = json && typeof json === 'object' ? json.provenance?.sources : null;
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((s) => s && typeof s.attribution === 'string' && s.attribution.trim() !== '')
    .map((s) => ({
      name: typeof s.name === 'string' ? s.name : '',
      attribution: s.attribution.trim(),
      spdx: typeof s.spdx === 'string' ? s.spdx : '',
      url: typeof s.url === 'string' ? s.url : null,
    }));
}

/**
 * Puts the credits together from what the repo holds.
 * @param {{
 *   ledger: string,
 *   packs: { id: string, manifest: { license?: string, licenseRules?: { spdx: string, attribution: string, licenseFile?: string }[] },
 *            files: Record<string, string>, sources: { name: string, attribution: string, spdx: string, url: string | null }[] }[],
 *   repoLicense: string,
 *   software: { name: string, version: string, license: string, text: string }[],
 * }} input `files` maps a pack-relative path to its text (the licence files).
 */
export function assembleCredits({ ledger, packs, repoLicense, software }) {
  const { entries, notices } = parseLedger(ledger);
  /** Distinct credits, in first-seen order. @type {{ text: string, url: string | null, licence: string }[]} */
  const attributions = [];
  const seen = new Set();
  const addAttribution = (a) => {
    if (seen.has(a.text)) return;
    seen.add(a.text);
    attributions.push(a);
  };
  /** The licence texts to show, one per distinct text. @type {{ id: string, name: string, text: string }[]} */
  const licences = [];
  const addLicence = (id, text) => {
    if (!licences.some((l) => l.id === id && l.text === text)) {
      licences.push({ id, name: LICENCE_NAMES[id] ?? id, text });
    }
  };
  for (const pack of packs) {
    for (const rule of pack.manifest.licenseRules ?? []) {
      addAttribution({
        text: rule.attribution.trim(),
        url: LICENCE_LINKS[rule.spdx] ?? null,
        licence: rule.spdx,
      });
      if (rule.licenseFile) {
        const text = pack.files[rule.licenseFile];
        if (text === undefined)
          throw new Error(`pack ${pack.id}: licenseFile ${rule.licenseFile} is missing`);
        addLicence(rule.spdx, text.trim());
      }
    }
  }
  for (const pack of packs) {
    for (const s of pack.sources) {
      addAttribution({
        text: s.name ? `${s.name}: ${s.attribution}` : s.attribution,
        url: s.url ?? LICENCE_LINKS[s.spdx] ?? null,
        licence: s.spdx,
      });
      if (s.spdx !== '' && !NO_TEXT_NEEDED.has(s.spdx) && !licences.some((l) => l.id === s.spdx)) {
        throw new Error(
          `a road file credits ${s.spdx} data, but no pack's licenseRules gives that licence a text file`,
        );
      }
    }
  }
  addLicence('MIT', repoLicense.trim());

  return {
    format: CREDITS_FORMAT,
    attributions,
    entries,
    notices,
    licences,
    software: software.map((s) => ({ ...s, text: s.text.trim() })),
  };
}

/** The `.json` files under a pack's baked region folders, as repo-relative paths. */
function regionFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => /[\\/](networks|roads|routes)[\\/]/.test(f));
}

const read = (file) => readFileSync(file, 'utf8');

/**
 * The credits of the tree at `root`: the ledger, the packs, the repo licence and the shipped npm
 * packages (`dependencies`, with the licence text each carries).
 * @param {string} root
 */
export function collectCredits(root) {
  const packsDir = path.join(root, 'packs');
  const packs = readdirSync(packsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(packsDir, e.name, 'pack.json')))
    .map((e) => e.name)
    .sort()
    .map((id) => {
      const dir = path.join(packsDir, id);
      const manifest = JSON.parse(read(path.join(dir, 'pack.json')));
      const files = {};
      for (const rule of manifest.licenseRules ?? []) {
        const file = path.join(dir, rule.licenseFile ?? '');
        if (rule.licenseFile && existsSync(file)) files[rule.licenseFile] = read(file);
      }
      const sources = regionFiles(path.join(dir, 'regions')).flatMap((f) =>
        provenanceSources(JSON.parse(read(f))),
      );
      return { id, manifest, files, sources };
    });
  const pkg = JSON.parse(read(path.join(root, 'package.json')));
  const software = Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dir = path.join(root, 'node_modules', name);
      const meta = JSON.parse(read(path.join(dir, 'package.json')));
      const licenceFile = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
      if (!licenceFile) throw new Error(`${name}: no licence file in node_modules`);
      return {
        name,
        version: String(meta.version),
        license: String(meta.license),
        text: read(path.join(dir, licenceFile)),
      };
    });
  return assembleCredits({
    ledger: read(path.join(root, 'THIRD_PARTY_ASSETS.md')),
    packs,
    repoLicense: read(path.join(root, 'LICENSE')),
    software,
  });
}

/**
 * The Vite plugin: writes credits.json into the build, so the offline worker caches it with the rest.
 * @param {{ root: string }} opts
 */
export function creditsPlugin({ root }) {
  return {
    name: 'throttlebrawl:credits',
    apply: /** @type {const} */ ('build'),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: CREDITS_FILE,
        source: `${JSON.stringify(collectCredits(root))}\n`,
      });
    },
  };
}
