// assets: one manifest for every asset (docs/architecture.md, "Asset manifest"). Code refers to
// assets by id only; the manifest maps ids to `baked`, `remote` or `procedural` sources. The
// skeleton has no baked assets yet, so every load falls back to its procedural stand-in.
// assets-1 builds per-asset progress and the baked loader.
import type { AssetIndexEntry, PackIndexFn } from '../core';

export interface AssetLoad<T> {
  id: string;
  source: 'baked' | 'remote' | 'procedural';
  value: T;
  /** Set when the asset failed and the procedural stand-in was used instead. */
  fellBack: boolean;
}

export interface AssetManifest {
  entries(): readonly AssetIndexEntry[];
  resolve(id: string): AssetIndexEntry | null;
  /** Loads an asset, or returns the procedural stand-in when it is missing or fails. */
  load<T>(id: string, standIn: () => T): Promise<AssetLoad<T>>;
}

export function createAssetManifest(packIndex: PackIndexFn): AssetManifest {
  const byId = new Map(packIndex().map((e) => [e.id, e]));
  return {
    entries: () => [...byId.values()],
    resolve: (id) => byId.get(id) ?? null,
    load<T>(id: string, standIn: () => T): Promise<AssetLoad<T>> {
      const entry = byId.get(id);
      // Only procedural sources exist in M1's skeleton; a baked or remote entry is assets-1's.
      return Promise.resolve({
        id,
        source: 'procedural',
        value: standIn(),
        fellBack: entry !== undefined && entry.source !== 'procedural',
      });
    },
  };
}
