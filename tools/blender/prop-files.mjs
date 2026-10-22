// Node-only canonical sources for catalog props. Dataset bytes are always verified at consumption.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cachePath, ensureCached, readLock } from '../../scripts/dataset-assets.mjs';
import { datasetPath, glbPath, packOf, PROPS } from './catalog.mjs';

/**
 * Resolve storage metadata without fetching or writing. A dataset row never falls back to packs.
 * @param {string} root
 * @param {import('./catalog.mjs').Prop} prop
 */
export function propSource(root, prop) {
  if (prop.storage !== undefined && !['pack', 'dataset'].includes(prop.storage))
    throw new Error(`${prop.name}: unknown prop storage ${prop.storage}`);
  if (prop.storage !== 'dataset') return { file: path.join(root, glbPath(prop)) };
  const { lock, problems } = readLock(root);
  if (problems.length) throw new Error(`assets.lock.json: ${problems.join('; ')}`);
  const rel = datasetPath(prop);
  const pin = lock.files.find((f) => f.path === rel);
  if (!pin) throw new Error(`${prop.name}: missing dataset pin ${rel}`);
  if (pin.embed) throw new Error(`${rel}: a prop cannot be an embedded build input`);
  const pack = path.join(root, 'packs', packOf(prop));
  if (!existsSync(path.join(pack, 'pack.json'))) throw new Error(`${rel}: missing pack`);
  if (existsSync(path.join(root, glbPath(prop))))
    throw new Error(`${rel}: packs/${packOf(prop)}/assets/ already bakes this asset id; keep one`);
  if (pin.region !== prop.region)
    throw new Error(
      `${rel}: pin region ${pin.region ?? '(shared)'} differs from catalog region ${prop.region ?? '(shared)'}`,
    );
  if (prop.region) {
    const region = path.join(pack, 'regions', prop.region);
    if (!existsSync(region) || !statSync(region).isDirectory())
      throw new Error(`${rel}: region ${prop.region} is not in pack ${packOf(prop)}`);
  }
  return { file: cachePath(root, rel), lock, pin };
}

/** Canonical filename and verified bytes; fetchFn is the existing dataset helper's fixture seam. */
export async function propFile(root, prop, fetchFn = fetch) {
  const source = propSource(root, prop);
  if (!source.pin) return { file: source.file, bytes: readFileSync(source.file), downloaded: false };
  return { file: source.file, ...(await ensureCached(root, source.lock, source.pin, fetchFn)) };
}

/**
 * Exhaustive local GLBs and dataset pins in the prop namespaces. Riders/placeholder pins have
 * separate catalogs. No cache or network is needed to check that neither partition has orphans.
 * @param {string} root
 * @param {import('./catalog.mjs').Prop[]} [props]
 * @returns {string[]}
 */
export function propInventoryProblems(root, props = PROPS) {
  const problems = [];
  const seen = new Set();
  const names = new Set();
  for (const prop of props) {
    const id = datasetPath(prop);
    if (seen.has(id) || names.has(prop.name)) problems.push(`duplicate catalog identity: ${id}`);
    seen.add(id);
    names.add(prop.name);
    try {
      const source = propSource(root, prop);
      if (!source.pin && !existsSync(source.file)) problems.push(`missing local GLB: ${glbPath(prop)}`);
    } catch (err) {
      problems.push(String(err.message ?? err));
    }
  }
  const local = new Set(props.filter((p) => p.storage !== 'dataset').map(glbPath));
  const packs = path.join(root, 'packs');
  if (existsSync(packs))
    for (const pack of readdirSync(packs)) {
      const dir = path.join(packs, pack, 'assets', 'models');
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.glb')) continue;
        const rel = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
        if (!local.has(rel)) problems.push(`orphan local GLB: ${rel}`);
      }
    }
  const { lock, problems: lockErrors } = readLock(root);
  if (lockErrors.length) problems.push(...lockErrors);
  else {
    const dataset = new Set(props.filter((p) => p.storage === 'dataset').map(datasetPath));
    for (const pin of lock.files)
      if (
        /^[^/]+\/models\/(props|scenery|bikes|traffic|landmarks)\/.+\.glb$/.test(pin.path) &&
        !dataset.has(pin.path)
      )
        problems.push(`orphan dataset prop: ${pin.path}`);
  }
  return problems;
}
