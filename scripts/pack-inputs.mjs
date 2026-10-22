import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildInputs, cachedBytes, LOCK_FILE, readLock } from './dataset-assets.mjs';

/**
 * Node-only pack preparation shared by Vite, packs:check and filesystem-based tests.
 * The normal pack parser remains responsible for validating the assembled network/terrain.
 * No downloading or source writes: local callers explicitly prepare their verified cache.
 * @param {string} root
 * @returns {{targets: string[], materialize(repoPath: string, text: string): string}}
 */
export function packInputs(root) {
  const { lock, problems } = existsSync(path.join(root, LOCK_FILE))
    ? readLock(root)
    : { lock: { files: [] }, problems: [] };
  if (problems.length) throw new Error(`${LOCK_FILE}: ${problems.join('; ')}`);
  const targets = new Map(buildInputs(lock).map((file) => [file.embed.target, file]));
  return {
    targets: [...targets.keys()],
    materialize(repoPath, text) {
      const file = targets.get(repoPath);
      if (!file) return text;
      const network = JSON.parse(text);
      if (!network || network.type !== 'road-network')
        throw new Error(`${repoPath}: terrain input target must be a road-network`);
      if (Object.hasOwn(network, 'terrain'))
        throw new Error(`${repoPath}: pinned input conflicts with inline terrain`);
      const bytes = cachedBytes(root, file);
      if (!bytes)
        throw new Error(
          `${file.path}: missing or corrupt terrain input; run npm run assets:fetch -- --build-inputs`,
        );
      const terrain = JSON.parse(bytes.toString('utf8'));
      if (
        !terrain ||
        Array.isArray(terrain) ||
        !Array.isArray(terrain.patches) ||
        Object.keys(terrain).some((key) => key !== 'patches')
      )
        throw new Error(`${file.path}: terrain input must contain only a patches array`);
      return JSON.stringify({ ...network, terrain });
    },
  };
}
