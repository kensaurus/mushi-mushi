#!/usr/bin/env node
/**
 * sync-helm-migrations.mjs
 *
 * Mirrors `packages/server/supabase/migrations/*.sql` into
 * `deploy/helm/migrations/` so the Helm chart's
 * `templates/configmap-migrations.yaml` template can `Files.Glob` them
 * at `helm install` / `helm package` time. Helm's `.Files` API can only
 * read paths that live INSIDE the chart directory, hence the mirror.
 *
 * Usage:
 *   node scripts/sync-helm-migrations.mjs           # write
 *   node scripts/sync-helm-migrations.mjs --check   # CI guard
 *
 * --check exits non-zero if the destination is out of sync, so a stale
 * chart can never silently slip into a release.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'server', 'supabase', 'migrations');
const DEST = join(ROOT, 'deploy', 'helm', 'migrations');

const CHECK = process.argv.includes('--check');

function listSql(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, '/');
}

const sources = listSql(SRC);
if (sources.length === 0) {
  console.error(`No migrations found at ${rel(SRC)} — wrong cwd?`);
  process.exit(1);
}

const drift = [];
const updates = [];

if (CHECK) {
  if (!existsSync(DEST)) {
    drift.push(`destination ${rel(DEST)} is missing`);
  } else {
    const actual = new Set(listSql(DEST));
    const expected = new Set(sources);
    for (const name of expected) {
      if (!actual.has(name)) {
        drift.push(`missing ${rel(join(DEST, name))}`);
        continue;
      }
      if (readUtf8(join(SRC, name)) !== readUtf8(join(DEST, name))) {
        drift.push(`content drift ${rel(join(DEST, name))}`);
      }
    }
    for (const name of actual) {
      if (!expected.has(name)) drift.push(`stale ${rel(join(DEST, name))}`);
    }
  }
  if (drift.length) {
    console.error(
      `✗ Helm migrations out of sync (${drift.length} issue${drift.length === 1 ? '' : 's'}):`,
    );
    for (const m of drift.slice(0, 10)) console.error(`  - ${m}`);
    if (drift.length > 10) console.error(`  … and ${drift.length - 10} more`);
    console.error('Run: node scripts/sync-helm-migrations.mjs');
    process.exit(1);
  }
  console.log(
    `✓ Helm migrations in sync (${sources.length} file${sources.length === 1 ? '' : 's'})`,
  );
  process.exit(0);
}

ensureDir(DEST);

const previous = existsSync(DEST) ? new Set(listSql(DEST)) : new Set();

for (const name of sources) {
  const srcContent = readUtf8(join(SRC, name));
  const destPath = join(DEST, name);
  const prev = previous.has(name) ? readUtf8(destPath) : null;
  if (prev !== srcContent) {
    writeFileSync(destPath, srcContent);
    updates.push(name);
  }
  previous.delete(name);
}

const stale = Array.from(previous);
for (const name of stale) {
  rmSync(join(DEST, name), { force: true });
}

const totalBytes = sources.reduce((sum, name) => sum + readFileSync(join(SRC, name)).length, 0);
const kib = Math.round(totalBytes / 1024);
const headroom = Math.max(0, 1024 - kib);

console.log(`Synced ${sources.length} migration file(s) (${kib} KiB) → ${rel(DEST)}`);
if (updates.length) console.log(`  + updated: ${updates.length}`);
if (stale.length) console.log(`  - removed: ${stale.length}`);
if (kib > 900) {
  console.warn(
    `⚠  ConfigMap budget warning: ${kib} KiB / 1024 KiB. Consider sharding by year prefix.`,
  );
} else {
  console.log(`  Helm ConfigMap headroom: ${headroom} KiB (1 MiB cap)`);
}
