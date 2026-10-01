#!/usr/bin/env node
// deploy-prod's "Deploy this run's build?" step (docs/engineering.md, "CI on GitHub Actions").
//
//   node scripts/prod-deploy-check.mjs --sha <commit> --space <hf-user>/<space>
//   node scripts/prod-deploy-check.mjs --sha <commit> --deployed <commit>   (no network; tests)
//
// Every green push to main uploads the build its own gate tested. It skips only when the prod
// Space already serves a NEWER main commit, which happens when someone re-runs an old main run.
// Main push runs are serialised (ci.yml's workflow concurrency group, never cancelled in
// progress), so first attempts finish in push order and each one is newer than the last deploy.
// When what prod serves is unknown (the Hub API failed, or the id does not resolve), it deploys:
// a stale prod is worse than a repeat upload.
//
// The deployed commit comes from the Space's newest commit titled "deploy <short sha>", which is
// the message the upload step writes (the hf CLI adds " (part N)" to a multi-commit upload).
// Prints one plain line plus `deploy=true|false`, and writes `deploy=...` to $GITHUB_OUTPUT.
// Exits 0 either way; only bad arguments exit 1.
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { git } from './lib.mjs';

const DEPLOY_TITLE = /^deploy ([0-9a-f]{7,40})(?:\s|$)/;

/**
 * The commit id named by the newest deploy commit, newest first.
 * @param {string[]} titles
 * @returns {string | undefined}
 */
export function deployedShaFromTitles(titles) {
  for (const t of titles) {
    const m = DEPLOY_TITLE.exec(t);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * @param {{ sha: string, deployed: string | undefined, shaIsAncestorOfDeployed: boolean }} input
 *   deployed is the full id prod serves (undefined when unknown).
 * @returns {{ deploy: boolean, reason: string }}
 */
export function decideDeploy({ sha, deployed, shaIsAncestorOfDeployed }) {
  const s = sha.slice(0, 7);
  if (!deployed) return { deploy: true, reason: `what prod serves is unknown; deploying ${s}` };
  const d = deployed.slice(0, 7);
  if (deployed === sha) return { deploy: true, reason: `prod already serves ${s}; uploading it again` };
  if (shaIsAncestorOfDeployed) {
    return { deploy: false, reason: `prod serves ${d}, newer than ${s} (a re-run of an old run); skipping` };
  }
  return { deploy: true, reason: `prod serves ${d}; deploying ${s}` };
}

/** @param {string} space */
async function fetchTitles(space) {
  const url = `https://huggingface.co/api/spaces/${space}/commits/main?limit=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Hub API ${res.status}`);
  const body = /** @type {{ title?: string }[]} */ (await res.json());
  return body.map((c) => c.title ?? '');
}

async function main() {
  const { values } = parseArgs({
    options: { sha: { type: 'string' }, space: { type: 'string' }, deployed: { type: 'string' } },
  });
  if (!values.sha || (!values.space && !values.deployed)) {
    console.error('usage: prod-deploy-check.mjs --sha <commit> (--space <id> | --deployed <commit>)');
    process.exit(1);
  }
  const sha = git(['rev-parse', '--verify', '--quiet', `${values.sha}^{commit}`], { allowFail: true }).trim();
  if (!sha) {
    console.error(`prod-deploy-check: ${values.sha} is not a commit here (checkout needs full history)`);
    process.exit(1);
  }

  let short = values.deployed;
  let note = '';
  if (!short) {
    try {
      short = deployedShaFromTitles(await fetchTitles(/** @type {string} */ (values.space)));
      if (!short) note = ' (no "deploy <sha>" commit among the Space\'s last 20)';
    } catch (err) {
      note = ` (${err instanceof Error ? err.message : String(err)})`;
    }
  }
  const deployed = short
    ? git(['rev-parse', '--verify', '--quiet', `${short}^{commit}`], { allowFail: true }).trim() || undefined
    : undefined;
  if (short && !deployed) note = ` (${short} does not resolve in this checkout)`;
  const ancestor = deployed !== undefined && deployed !== sha && isAncestor(sha, deployed);

  const { deploy, reason } = decideDeploy({ sha, deployed, shaIsAncestorOfDeployed: ancestor });
  console.log(`${reason}${note}`);
  console.log(`deploy=${deploy}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
}

/** `git merge-base --is-ancestor` prints nothing; its exit code is the answer. */
function isAncestor(/** @type {string} */ a, /** @type {string} */ b) {
  try {
    git(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
