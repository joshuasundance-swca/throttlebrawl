import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Keep original pack IDs so glob discovery, note stripping and schema validation still apply. */
export function packInputsPlugin({ root, inputsOf }) {
  let command;
  let inputs;
  function prepared() {
    return (inputs ??= inputsOf(root));
  }
  function targetOf(id) {
    const [file, query = ''] = id.split('?');
    const rel = path.relative(root, file).split(path.sep).join('/');
    return prepared().targets.includes(rel) ? { file, rel, query } : null;
  }
  function textOf(target) {
    return prepared().materialize(target.rel, readFileSync(target.file, 'utf8'));
  }
  return {
    name: 'throttlebrawl:pack-inputs',
    enforce: 'pre',
    configResolved(config) {
      command = config.command;
    },
    // Read only after every buildStart has finished: dataset-assets prepares cold build inputs there.
    load(id) {
      const target = targetOf(id);
      if (!target) return null;
      this.addWatchFile(target.file);
      const text = textOf(target);
      if (!target.query) return { code: text, map: null };
      const query = new URLSearchParams(target.query);
      if (query.has('raw')) return `export default ${JSON.stringify(text)};`;
      if (!query.has('url')) return null;
      if (command !== 'build') return `export default ${JSON.stringify(`/${target.rel}?pack-input`)};`;
      const ref = this.emitFile({
        type: 'asset',
        name: path.basename(target.file),
        originalFileName: target.file,
        source: text,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(server) {
      // Only exact authored target URLs; this is not an arbitrary filesystem endpoint.
      server.middlewares.use((req, res, next) => {
        const [requestPath, query = ''] = (req.url ?? '').split('?');
        const rel = requestPath.slice(1);
        if (!new URLSearchParams(query).has('pack-input') || !prepared().targets.includes(rel)) return next();
        try {
          const body = textOf({ rel, file: path.join(root, rel) });
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(body);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
