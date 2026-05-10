#!/usr/bin/env node
/**
 * bootstrap-new-package.mjs
 *
 * One-time helper for the chicken-and-egg npm Trusted Publisher problem:
 * `release.yml` publishes via OIDC + Sigstore provenance, but npm requires
 * a Trusted Publisher binding **per package** that can only be configured
 * once the package exists on the registry. New packages therefore need a
 * one-shot classic publish before OIDC can take over.
 *
 * What it does:
 *   1. Scans the workspace for publishable packages.
 *   2. For each one, asks the npm registry whether it exists.
 *   3. For every missing package, runs `pnpm publish --access public
 *      --no-provenance` from that package's directory using a token from
 *      $NPM_TOKEN. `pnpm` rewrites `workspace:^` specifiers to real semver
 *      ranges in the published tarball (npm publish does not).
 *   4. Prints the npm Trusted Publisher URL for each freshly-bootstrapped
 *      package so the operator can finish the OIDC binding in one browser
 *      session — after which all future bumps go through the normal
 *      release.yml + Changesets flow with full provenance.
 *
 * Required env:
 *   NPM_TOKEN — granular access token with read+write on the affected
 *               package scope and "Bypass 2FA" enabled. Generate at
 *               https://www.npmjs.com/settings/<user>/tokens/granular-access-tokens/new
 *               and revoke immediately after this script finishes.
 *
 * Usage:
 *   pnpm install && pnpm -r build               # ensure dist/ is fresh
 *   NPM_TOKEN=npm_xxx node scripts/bootstrap-new-package.mjs
 *   NPM_TOKEN=npm_xxx node scripts/bootstrap-new-package.mjs --dry-run
 *   NPM_TOKEN=npm_xxx node scripts/bootstrap-new-package.mjs --only @mushi-mushi/foo
 *
 * After publish: tap your security key 1× per package on the printed URLs,
 * then revoke the bootstrap token. From then on, every changeset bump for
 * those packages publishes via OIDC + provenance like every other package.
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');
const REGISTRY = 'https://registry.npmjs.org';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_IDX = args.indexOf('--only');
const ONLY = ONLY_IDX >= 0 ? args[ONLY_IDX + 1] : null;

const NPM_TOKEN = process.env.NPM_TOKEN;
if (!DRY_RUN && !NPM_TOKEN) {
  console.error('NPM_TOKEN env var is required (or pass --dry-run).');
  console.error(
    'Generate one at: https://www.npmjs.com/settings/<user>/tokens/granular-access-tokens/new',
  );
  console.error('  - Bypass two-factor authentication: ON');
  console.error('  - Packages and scopes: Read and write, All packages');
  console.error('  - Expiration: 7 days (revoke immediately after use)');
  process.exit(1);
}

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function listPublishablePackages() {
  const dirs = readdirSync(PACKAGES_DIR)
    .map((name) => join(PACKAGES_DIR, name))
    .filter((p) => statSync(p).isDirectory());
  const out = [];
  for (const dir of dirs) {
    const pkg = readPkg(dir);
    if (!pkg) continue;
    if (pkg.private) continue;
    if (!pkg.name) continue;
    if (ONLY && pkg.name !== ONLY) continue;
    out.push({ dir, name: pkg.name, version: pkg.version });
  }
  return out;
}

async function existsOnNpm(name) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

function publish(dir, name, npmrcPath) {
  const cmd = 'pnpm';
  const argv = ['publish', '--access', 'public', '--no-git-checks', '--no-provenance'];
  console.log(`  → ${cmd} ${argv.join(' ')}  (cwd: ${dir})`);
  if (DRY_RUN) return { ok: true, dryRun: true };
  const result = spawnSync(cmd, argv, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrcPath },
    shell: true,
  });
  return { ok: result.status === 0, code: result.status };
}

function ownerSlug() {
  try {
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = url.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch {}
  return { owner: '<your-gh-user>', repo: '<your-repo>' };
}

async function main() {
  const all = listPublishablePackages();
  console.log(`Scanning ${all.length} publishable package(s)…\n`);

  const missing = [];
  for (const pkg of all) {
    process.stdout.write(`  ${pkg.name}@${pkg.version} … `);
    const exists = await existsOnNpm(pkg.name);
    console.log(exists ? 'exists ✓' : 'NOT FOUND — needs bootstrap');
    if (!exists) missing.push(pkg);
  }

  if (missing.length === 0) {
    console.log('\nAll packages already exist on npm. Nothing to bootstrap.');
    return;
  }

  console.log(`\n${missing.length} package(s) need bootstrap:\n`);
  for (const pkg of missing) console.log(`  - ${pkg.name}@${pkg.version}`);
  console.log('');

  const tmpDir = mkdtempSync(join(tmpdir(), 'bootstrap-npm-'));
  const npmrcPath = join(tmpDir, '.npmrc');
  if (!DRY_RUN)
    writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`, { mode: 0o600 });

  const published = [];
  const failed = [];
  try {
    for (const pkg of missing) {
      console.log(`\n=== Publishing ${pkg.name}@${pkg.version} ===`);
      const res = publish(pkg.dir, pkg.name, npmrcPath);
      if (res.ok) published.push(pkg);
      else failed.push({ ...pkg, code: res.code });
    }
  } finally {
    if (!DRY_RUN) rmSync(tmpDir, { recursive: true, force: true });
  }

  const { owner, repo } = ownerSlug();
  console.log('\n=== SUMMARY ===');
  console.log(`Published: ${published.length}`);
  console.log(`Failed:    ${failed.length}`);
  if (failed.length) {
    for (const p of failed) console.log(`  ✗ ${p.name}  (exit ${p.code})`);
  }

  if (published.length) {
    console.log('\n=== NEXT STEP — add Trusted Publisher (one tap each) ===');
    console.log(
      'Open each URL below, click "GitHub Actions", fill the form (auto-filled values shown),',
    );
    console.log('click "Set up connection", and tap your security key.\n');
    console.log(`Form values:`);
    console.log(`  Organization or user:  ${owner}`);
    console.log(`  Repository:            ${repo}`);
    console.log(`  Workflow filename:     release.yml`);
    console.log(`  Environment name:      (leave blank)\n`);
    for (const pkg of published) {
      const slug = pkg.name.startsWith('@') ? pkg.name : pkg.name;
      console.log(`  https://www.npmjs.com/package/${encodeURIComponent(slug)}/access`);
    }
    console.log('\nAfter every package has Trusted Publisher configured, REVOKE the bootstrap');
    console.log(`token at: https://www.npmjs.com/settings/${owner}/tokens`);
    console.log(
      'From then on, all future bumps publish via OIDC + Sigstore provenance through release.yml.',
    );
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
