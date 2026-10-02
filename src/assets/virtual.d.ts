// The manifest rows of the dataset files this build bakes in (scripts/dataset-assets.mjs).
declare module 'virtual:dataset-assets' {
  const rows: readonly import('../core').AssetIndexEntry[];
  export default rows;
}
