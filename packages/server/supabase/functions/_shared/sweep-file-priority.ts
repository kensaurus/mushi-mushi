/**
 * FILE: sweep-file-priority.ts
 * PURPOSE: Decide WHICH files a capped codebase sweep embeds. Pure — no I/O.
 *
 * The sweep embeds at most MUSHI_REPO_INDEX_SWEEP_FILE_CAP files per run
 * (default 300) to bound embedding spend and edge-function time. Taking the
 * first N paths of the git tree meant alphabetical order decided coverage: a
 * 4,700-file repo got `.github/`, `apps/a…` and never reached `lib/` or
 * `stores/`, where its errors actually came from.
 *
 * Order now, cap unchanged:
 *   0. files named by stack frames of this project's open Sentry-linked
 *      reports (the fix sites we already know we need);
 *   1. application source dirs (src, app, lib, stores, components, …);
 *   2. other code;
 *   3. tests, stories, fixtures, docs, scripts, config, migrations.
 * Files not yet in the index come before ones that are (tiers 1-2 first,
 * then tier 3), so successive sweeps widen coverage instead of re-embedding
 * the same N files, and within each group files round-robin across
 * top-level directories so one large folder cannot take the whole budget. Push webhooks keep already
 * indexed files fresh, so pushing them back costs no correctness.
 */

const SOURCE_SEGMENTS = new Set([
  'src', 'app', 'apps', 'lib', 'libs', 'stores', 'store', 'components', 'pages', 'server',
  'services', 'hooks', 'utils', 'features', 'modules', 'routes', 'api', 'screens', 'views',
  'controllers', 'models', 'actions', 'contexts', 'providers', 'functions', 'packages',
]);

const LOW_VALUE_SEGMENTS = new Set([
  '__tests__', 'tests', 'test', 'e2e', 'spec', 'specs', '__mocks__', 'mocks', 'fixtures',
  'stories', 'storybook', '.storybook', 'docs', 'doc', 'examples', 'example', 'scripts',
  '.github', 'migrations', 'seed', 'seeds', 'benchmarks', 'playwright', 'cypress',
]);

const LOW_VALUE_FILE_RE = /\.(?:test|spec|stories|story|config|conf|d)\.[a-z0-9]+$|(?:^|\/)(?:vite|vitest|jest|webpack|rollup|eslint|prettier|tailwind|postcss|babel|next|nuxt|metro|playwright)\.config\./i;

/** 1 = application source, 2 = other code, 3 = tests/docs/config. */
export function sweepTier(path: string): 1 | 2 | 3 {
  const segments = path.split('/');
  const dirs = segments.slice(0, -1).map((s) => s.toLowerCase());
  if (dirs.some((d) => LOW_VALUE_SEGMENTS.has(d)) || LOW_VALUE_FILE_RE.test(path)) return 3;
  if (dirs.some((d) => SOURCE_SEGMENTS.has(d))) return 1;
  return 2;
}

function roundRobinByTopDir(paths: string[]): string[] {
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
    const top = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
    const list = buckets.get(top);
    if (list) list.push(p);
    else buckets.set(top, [p]);
  }
  const queues = [...buckets.values()];
  const out: string[] = [];
  for (let i = 0; out.length < paths.length; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/**
 * Order `paths` (already filtered to indexable files) and return the first
 * `cap`. `framePaths` must be real tree paths (see matchFramePathsToTree).
 */
export function prioritizeSweepFiles(
  paths: readonly string[],
  opts: { framePaths?: readonly string[]; indexedPaths?: ReadonlySet<string>; cap: number },
): string[] {
  const cap = Math.max(0, opts.cap);
  const inTree = new Set(paths);
  const first = [...new Set((opts.framePaths ?? []).filter((p) => inTree.has(p)))];
  const taken = new Set(first);
  const indexed = opts.indexedPaths ?? new Set<string>();

  // Bucket order: new source, new other code, indexed source, indexed other
  // code, then tests/docs/config (new before indexed).
  const bucketOf = (tier: 1 | 2 | 3, isIndexed: boolean): number =>
    tier === 3 ? (isIndexed ? 5 : 4) : (isIndexed ? 2 : 0) + (tier - 1);
  const buckets: string[][] = Array.from({ length: 6 }, () => []);
  for (const p of paths) {
    if (taken.has(p)) continue;
    buckets[bucketOf(sweepTier(p), indexed.has(p))].push(p);
  }
  const ordered = [...first];
  for (const bucket of buckets) {
    if (ordered.length >= cap) break;
    ordered.push(...roundRobinByTopDir(bucket.sort()));
  }
  return ordered.slice(0, cap);
}
