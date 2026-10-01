// deploy-prod's "deploy this run's build?" step (docs/engineering.md, "CI on GitHub Actions").
// Every green push to main uploads the build its own gate tested, unless prod already serves a
// NEWER main commit (a re-run of an old run). The old rule, "only main's head deploys", skipped
// 39 of 59 green main runs on 2026-09-30/10-01 and left prod one build for up to 145 minutes.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideDeploy, deployedShaFromTitles } from './prod-deploy-check.mjs';

describe('deployedShaFromTitles', () => {
  it('reads the newest deploy commit, with or without a part suffix', () => {
    expect(
      deployedShaFromTitles(['deploy 7969765 (part 4)', 'deploy 7969765 (part 3)', 'deploy aa9fcdf']),
    ).toBe('7969765');
    expect(deployedShaFromTitles(['deploy 4bc7c77'])).toBe('4bc7c77');
  });

  it('skips commits that are not deploys (an HF default commit, a hand edit)', () => {
    expect(deployedShaFromTitles(['initial commit', 'Update README.md', 'deploy 512358c (part 2)'])).toBe(
      '512358c',
    );
  });

  it('takes only a hex id right after "deploy"', () => {
    expect(deployedShaFromTitles(['deploy 2df23b6 from lane/x/y'])).toBe('2df23b6');
    expect(deployedShaFromTitles(['deploy main', 'deploying soon'])).toBeUndefined();
    expect(deployedShaFromTitles([])).toBeUndefined();
  });
});

describe('decideDeploy', () => {
  const sha = 'b'.repeat(40);
  it('deploys when prod serves an older main commit', () => {
    expect(decideDeploy({ sha, deployed: 'a'.repeat(40), shaIsAncestorOfDeployed: false }).deploy).toBe(true);
  });

  it('skips when prod already serves a newer main commit (a re-run of an old run)', () => {
    const d = decideDeploy({ sha, deployed: 'c'.repeat(40), shaIsAncestorOfDeployed: true });
    expect(d.deploy).toBe(false);
    expect(d.reason).toContain('newer');
  });

  it('redeploys the same commit, which repairs an upload that stopped part-way', () => {
    expect(decideDeploy({ sha, deployed: sha, shaIsAncestorOfDeployed: true }).deploy).toBe(true);
  });

  it('deploys when what prod serves is unknown: a stale prod is worse than a repeat upload', () => {
    const d = decideDeploy({ sha, deployed: undefined, shaIsAncestorOfDeployed: false });
    expect(d.deploy).toBe(true);
    expect(d.reason).toContain('unknown');
  });
});

describe('the CLI, against this repo history', () => {
  const script = path.resolve(import.meta.dirname, 'prod-deploy-check.mjs');
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: import.meta.dirname, encoding: 'utf8' }).stdout.trim();
  const head = git('rev-parse', 'HEAD');
  const parent = git('rev-parse', 'HEAD~1');
  const run = (sha: string, deployed: string) => {
    const res = spawnSync(process.execPath, [script, '--sha', sha, '--deployed', deployed], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    });
    return { code: res.status, out: res.stdout };
  };

  it('prints deploy=true for a newer build and deploy=false for an older one, exit 0 both ways', () => {
    const newer = run(head, parent.slice(0, 7));
    expect(newer.code).toBe(0);
    expect(newer.out).toContain('deploy=true');
    const older = run(parent, head.slice(0, 7));
    expect(older.code).toBe(0);
    expect(older.out).toContain('deploy=false');
  });

  it('deploys when the deployed id does not resolve in git', () => {
    const r = run(head, 'fffffff');
    expect(r.code).toBe(0);
    expect(r.out).toContain('deploy=true');
  });
});
