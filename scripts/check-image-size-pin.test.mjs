/**
 * image-size 1.2.1 has two infinite-loop DoS advisories
 * (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq). 2.0.3 fixes both.
 * Metro still declares ^1.0.2, so the floor is a pnpm override.
 * Run with `pnpm test:scripts` (after `pnpm install`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBounded } from './check-dependency-overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXED = [2, 0, 3];
const ADVISORIES = ['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'];

/** @param {string} version */
function atLeastFixed(version) {
  const parts = version.split('.').map((n) => Number(n));
  assert.equal(parts.length, 3, version);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== FIXED[i]) return parts[i] > FIXED[i];
  }
  return true;
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Quoted GHSA ids on the auditConfig.ignoreGhsas list, comments skipped. */
function ignoredGhsas(workspaceYaml) {
  const start = workspaceYaml.indexOf('ignoreGhsas:');
  assert.notEqual(start, -1);
  const ids = [];
  for (const line of workspaceYaml.slice(start).split('\n').slice(1)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^- '([^']+)'$/);
    if (!match) break;
    ids.push(match[1]);
  }
  return ids;
}

test('pnpm.overrides forces image-size 2.0.3 or newer, and stays below 3', () => {
  const pkg = JSON.parse(read('package.json'));
  const range = pkg.pnpm?.overrides?.['image-size'];
  assert.equal(range, '>=2.0.3 <3');
  assert.equal(isBounded(range), true);
});

test('the lockfile resolves only the fixed image-size line', () => {
  const lock = read('pnpm-lock.yaml');
  const overrideBlock = lock.slice(0, lock.indexOf('\npatchedDependencies:'));
  assert.match(overrideBlock, /image-size: '>=2\.0\.3 <3'/);

  const resolved = [...lock.matchAll(/^  image-size@(\d+\.\d+\.\d+):$/gm)].map((m) => m[1]);
  assert.ok(resolved.length > 0, 'image-size is missing from the lockfile');
  for (const version of resolved) {
    assert.equal(atLeastFixed(version), true, version);
    assert.equal(version.startsWith('2.'), true, version);
  }

  const linked = [...lock.matchAll(/image-size: (\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(linked.length > 0);
  for (const version of linked) assert.equal(atLeastFixed(version), true, version);
});

test('the two image-size advisories are no longer ignored', () => {
  const ignored = ignoredGhsas(read('pnpm-workspace.yaml'));
  const osvIds = [...read('osv-scanner.toml').matchAll(/^id = "([^"]+)"$/gm)].map((m) => m[1]);
  for (const id of ADVISORIES) {
    assert.equal(ignored.includes(id), false, id);
    assert.equal(osvIds.includes(id), false, id);
  }
});

test('the installed image-size reads a PNG buffer the way Metro does', () => {
  const store = path.join(ROOT, 'node_modules/.pnpm');
  const dirs = readdirSync(store).filter((name) => name.startsWith('image-size@'));
  assert.ok(dirs.length > 0, 'pnpm install has not put image-size in node_modules');
  const require = createRequire(import.meta.url);
  for (const dir of dirs) {
    const version = dir.slice('image-size@'.length).split('_')[0];
    assert.equal(atLeastFixed(version), true, dir);
    const pkgDir = path.join(store, dir, 'node_modules/image-size');
    const manifest = require(path.join(pkgDir, 'package.json'));
    assert.equal(atLeastFixed(manifest.version), true, manifest.version);
    const loaded = require(pkgDir);
    const imageSize = loaded.__esModule ? loaded.default : loaded;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const { width, height } = imageSize(png);
    assert.equal(width, 1);
    assert.equal(height, 1);
  }
});
