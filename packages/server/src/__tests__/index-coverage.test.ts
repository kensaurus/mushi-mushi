/**
 * Codebase index coverage (gaps #16a / #16b):
 *   - a partial sweep never sets last_indexed_at, and records coverage;
 *   - the coverage ceiling follows the plan (env pin for self-host);
 *   - one run fetches a bounded batch, admitting new files only under the
 *     ceiling, so a big cap fills over several runs;
 *   - the consumers (index-failing probe, doctor wording) read partial
 *     sweeps as successful;
 *   - the path filter and project scope decide eligibility for the sweep
 *     and the push alike;
 *   - a filling sweep that adds nothing is stalled (out of the hourly batch);
 *   - pushes respect the plan ceiling and keep the coverage numbers current.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  admitPushPaths,
  DEFAULT_INDEX_FILE_CAP,
  emptyEligibleError,
  describeIndexCoverage,
  indexFileCapForPlan,
  indexPathFilter,
  isStorableBlob,
  latestIso,
  measureIndexCoverage,
  MAX_INDEX_FILE_CAP,
  pushCoverageUpdate,
  selectSweepFiles,
  sweepBookkeeping,
  sweepOutcome,
  codebaseIndexDoctorCheck,
  pathsOutsideFilter,
  type IndexCoverage,
} from '../../supabase/functions/_shared/index-coverage.ts'
import { pathMatchesAnyGlob } from '../../supabase/functions/_shared/codebase-scope.ts'
import { isCodebaseIndexFailing } from '../../supabase/functions/_shared/sweep-error-classifier.ts'

const NOW = '2026-10-03T12:00:00.000Z'

describe('indexFileCapForPlan', () => {
  it('follows the plan tier', () => {
    expect(indexFileCapForPlan({ id: 'free_cloud' }, undefined)).toEqual({ cap: 300, source: 'plan_tier', planId: 'free_cloud' })
    expect(indexFileCapForPlan({ id: 'indie' }, undefined).cap).toBe(1500)
    expect(indexFileCapForPlan({ id: 'pro' }, undefined).cap).toBe(5000)
    expect(indexFileCapForPlan({ id: 'enterprise' }, undefined).cap).toBe(20000)
  })
  it('lets a plan flag override the tier table', () => {
    expect(indexFileCapForPlan({ id: 'pro', feature_flags: { codebase_index_file_cap: 8000 } }, undefined)).toEqual({
      cap: 8000,
      source: 'plan_flag',
      planId: 'pro',
    })
    // A junk flag is ignored, not trusted.
    expect(indexFileCapForPlan({ id: 'pro', feature_flags: { codebase_index_file_cap: 'lots' } }, undefined).source).toBe('plan_tier')
  })
  it('the env var pins every project (self-host), and is clamped', () => {
    expect(indexFileCapForPlan({ id: 'pro' }, '1200')).toEqual({ cap: 1200, source: 'env', planId: 'pro' })
    expect(indexFileCapForPlan(null, '999999').cap).toBe(MAX_INDEX_FILE_CAP)
    expect(indexFileCapForPlan(null, '0').source).toBe('default')
    expect(indexFileCapForPlan(null, '').source).toBe('default')
  })
  it('an unknown plan gets the old fixed default', () => {
    expect(indexFileCapForPlan({ id: 'mystery' }, undefined)).toEqual({ cap: DEFAULT_INDEX_FILE_CAP, source: 'default', planId: 'mystery' })
  })
})

describe('selectSweepFiles', () => {
  const tree = Array.from({ length: 50 }, (_, i) => `src/file${String(i).padStart(2, '0')}.ts`)

  it('fetches at most the run budget, new files first', () => {
    const indexed = new Set(tree.slice(0, 10))
    const out = selectSweepFiles({ treePaths: tree, framePaths: [], indexedPaths: indexed, planCap: 1000, runBudget: 20 })
    expect(out).toHaveLength(20)
    expect(out.every((p) => !indexed.has(p))).toBe(true)
  })

  it('admits new files only up to the plan ceiling, then refreshes indexed ones', () => {
    const indexed = new Set(tree.slice(0, 28))
    const out = selectSweepFiles({ treePaths: tree, framePaths: [], indexedPaths: indexed, planCap: 30, runBudget: 10 })
    const fresh = out.filter((p) => !indexed.has(p))
    expect(fresh).toHaveLength(2)
    expect(out).toHaveLength(10)
  })

  it('at the ceiling it never grows the index', () => {
    const indexed = new Set(tree.slice(0, 30))
    const out = selectSweepFiles({ treePaths: tree, framePaths: [], indexedPaths: indexed, planCap: 30, runBudget: 50 })
    expect(out.filter((p) => !indexed.has(p))).toEqual([])
    expect(out).toHaveLength(30)
  })

  it('stack-frame files of open reports always go first, even past the ceiling', () => {
    const indexed = new Set(tree.slice(0, 30))
    const out = selectSweepFiles({ treePaths: tree, framePaths: ['src/file45.ts'], indexedPaths: indexed, planCap: 30, runBudget: 5 })
    expect(out[0]).toBe('src/file45.ts')
  })

  it('new files of any tier come before refreshes, so a filling repo always progresses', () => {
    // Source fully indexed (more files than the budget), tests not yet: the
    // old order spent the whole budget re-fetching source every hour.
    const source = Array.from({ length: 40 }, (_, i) => `src/s${String(i).padStart(2, '0')}.ts`)
    const tests = Array.from({ length: 10 }, (_, i) => `tests/t${i}.test.ts`)
    const out = selectSweepFiles({ treePaths: [...source, ...tests], framePaths: [], indexedPaths: new Set(source), planCap: 1000, runBudget: 20 })
    expect(out.slice(0, 10).sort()).toEqual([...tests].sort())
    expect(out).toHaveLength(20)
  })

  it('a zero budget fetches nothing', () => {
    expect(selectSweepFiles({ treePaths: tree, framePaths: [], indexedPaths: new Set(), planCap: 300, runBudget: 0 })).toEqual([])
  })
})

describe('measureIndexCoverage', () => {
  const eligible = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
  it('complete when every eligible file is indexed and the tree was whole', () => {
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set([...eligible, 'deleted.ts']), cap: 300, truncated: false }))
      .toEqual({ indexed: 4, eligible: 4, cap: 300, truncated: false, state: 'complete' })
  })
  it('filling while under both the repo and the ceiling', () => {
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts']), cap: 300, truncated: false }).state).toBe('filling')
  })
  it('capped at the plan ceiling', () => {
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts', 'b.ts']), cap: 2, truncated: false }).state).toBe('capped')
  })
  it('a truncated tree is never complete: capped once every listed file is in', () => {
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(eligible), cap: 300, truncated: true }).state).toBe('capped')
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts']), cap: 300, truncated: true }).state).toBe('filling')
  })
  it('an empty repo is complete', () => {
    expect(measureIndexCoverage({ eligiblePaths: [], indexedPaths: new Set(), cap: 300, truncated: false }).state).toBe('complete')
  })

  it('a file this run found empty or gone never keeps the repo filling forever', () => {
    // e.g. an empty __init__.py the sweep fetched: nothing to embed, never indexed.
    const cov = measureIndexCoverage({
      eligiblePaths: [...eligible, 'pkg/__init__.py'],
      indexedPaths: new Set(eligible),
      unstorablePaths: new Set(['pkg/__init__.py']),
      cap: 300,
      truncated: false,
    })
    expect(cov).toEqual({ indexed: 4, eligible: 4, cap: 300, truncated: false, state: 'complete' })
    expect(sweepBookkeeping({ coverage: cov, nowIso: NOW, failedChunks: 0 }).last_indexed_at).toBe(NOW)
  })

  it('a file that failed transiently (not unstorable) still counts as missing', () => {
    expect(measureIndexCoverage({
      eligiblePaths: [...eligible, 'src/flaky.ts'],
      indexedPaths: new Set(eligible),
      cap: 300,
      truncated: false,
    }).state).toBe('filling')
  })
})

describe('isStorableBlob', () => {
  it('drops empty blobs and blobs over the fetch limit from the eligible set', () => {
    expect(isStorableBlob({ size: 0 })).toBe(false)
    expect(isStorableBlob({ size: 500_001 })).toBe(false)
    expect(isStorableBlob({ size: 1 })).toBe(true)
    expect(isStorableBlob({ size: 500_000 })).toBe(true)
    // Listings without sizes are assumed storable.
    expect(isStorableBlob({})).toBe(true)
  })
})

describe('sweepBookkeeping (gap #16a)', () => {
  const cov = (state: 'complete' | 'filling' | 'capped') => ({ indexed: 300, eligible: 4700, cap: 300, truncated: false, state })

  it('a partial sweep records coverage and index_swept_at, never last_indexed_at', () => {
    for (const state of ['filling', 'capped'] as const) {
      const row = sweepBookkeeping({ coverage: cov(state), nowIso: NOW, failedChunks: 0 })
      expect(row).not.toHaveProperty('last_indexed_at')
      expect(row).toMatchObject({
        index_swept_at: NOW,
        last_index_attempt_at: NOW,
        index_files_indexed: 300,
        index_files_eligible: 4700,
        index_file_cap: 300,
        index_coverage_state: state,
        // Partial coverage is not an error.
        last_index_error: null,
      })
    }
  })

  it('a complete sweep sets last_indexed_at too', () => {
    const row = sweepBookkeeping({ coverage: { ...cov('complete'), eligible: 300 }, nowIso: NOW, failedChunks: 0 })
    expect(row.last_indexed_at).toBe(NOW)
  })

  it('chunk failures are the only error it writes', () => {
    expect(sweepBookkeeping({ coverage: cov('complete'), nowIso: NOW, failedChunks: 3, lastError: 'rate limited' }).last_index_error).toBe('rate limited')
    expect(sweepBookkeeping({ coverage: cov('complete'), nowIso: NOW, failedChunks: 3 }).last_index_error).toBe('partial: some chunks failed')
  })
})

describe('consumers read a partial sweep as a success', () => {
  it('isCodebaseIndexFailing: a chunk error after a partial sweep is not a dead index', () => {
    expect(isCodebaseIndexFailing({
      last_index_error: 'partial: some chunks failed',
      last_indexed_at: null,
      index_swept_at: NOW,
      last_index_attempt_at: NOW,
    })).toBe(false)
    // …but an attempt long after the last sweep still is.
    expect(isCodebaseIndexFailing({
      last_index_error: 'tree fetch 404',
      last_indexed_at: null,
      index_swept_at: '2026-10-01T00:00:00Z',
      last_index_attempt_at: NOW,
    })).toBe(true)
    // Rows from before the coverage columns behave as before.
    expect(isCodebaseIndexFailing({ last_index_error: 'x', last_indexed_at: null, last_index_attempt_at: NOW })).toBe(true)
  })

  it('latestIso picks the newer sweep', () => {
    expect(latestIso('2026-10-01T00:00:00Z', NOW)).toBe(NOW)
    expect(latestIso(null, NOW)).toBe(NOW)
    expect(latestIso(undefined, undefined)).toBeNull()
  })

  it('describeIndexCoverage words each state', () => {
    expect(describeIndexCoverage({ indexed: 4700, eligible: 4700, cap: 5000, truncated: false, state: 'complete' })).toBe('4,700 of 4,700 files indexed')
    expect(describeIndexCoverage({ indexed: 300, eligible: 4700, cap: 300, truncated: false, state: 'capped' })).toBe('300 of 4,700 files indexed (plan limit 300)')
    expect(describeIndexCoverage({ indexed: 600, eligible: 4700, cap: 1500, truncated: false, state: 'filling' })).toContain('hourly sweep adds more')
    expect(describeIndexCoverage({ indexed: null, eligible: null, cap: null, truncated: false, state: null })).toBeNull()
  })
})

describe('wiring', () => {
  const FN = resolve(__dirname, '../../supabase/functions')
  const indexer = readFileSync(resolve(FN, 'webhooks-github-indexer/index.ts'), 'utf8')
  const doctor = readFileSync(resolve(FN, 'api/routes/doctor.ts'), 'utf8')

  it('the sweep writes bookkeeping through sweepOutcome, not a bare last_indexed_at', () => {
    const sweep = indexer.slice(indexer.indexOf('async function handleSweep('), indexer.indexOf('async function sweepIndexRepo('))
    expect(sweep).toContain('const outcome = sweepOutcome({')
    expect(sweep).toContain('...outcome.update,')
    expect(sweep).not.toMatch(/last_indexed_at:\s*new Date/)
  })

  it('a sweep that embedded nothing still records its coverage (no error-only branch)', () => {
    const sweep = indexer.slice(indexer.indexOf('async function handleSweep('), indexer.indexOf('async function sweepIndexRepo('))
    // The old branch wrote only the error, so a filling repo stayed filling.
    expect(sweep).not.toContain('if (stats.inserted === 0 && stats.failed > 0)')
    // One project_repos write serves success and failure alike.
    const from = sweep.indexOf('const outcome = sweepOutcome({')
    const tryBlock = sweep.slice(from, sweep.indexOf('} catch (err) {', from))
    expect(tryBlock.match(/\.from\('project_repos'\)/g)).toHaveLength(1)
  })

  it('the sweep tombstones indexed files the filter now excludes, before fetching', () => {
    const repoSweep = indexer.slice(indexer.indexOf('async function sweepIndexRepo('), indexer.indexOf('interface PushPayload'))
    expect(repoSweep).toContain('tombstonedOutOfFilter = await tombstonePaths(')
    expect(repoSweep).toContain('pathsOutsideFilter({')
    expect(repoSweep.indexOf('tombstonePaths(')).toBeLessThan(repoSweep.indexOf('fetchFileForIndex('))
    expect(repoSweep.indexOf('if (filteredAway')).toBeLessThan(repoSweep.indexOf('tombstonePaths('))
    expect(indexer).toContain('if (error) throw new Error(`tombstoning files outside the path filter failed: ${error.message}`);')
    // The multi-repo guard reads the repo count strictly.
    expect(repoSweep).toContain('indexingRepos: await countIndexingRepos(db, projectId),')
    const count = indexer.slice(indexer.indexOf('async function countIndexingRepos('), indexer.indexOf('async function countIndexingRepos(') + 700)
    expect(count).toContain(".eq('indexing_enabled', true)")
    expect(count).toContain('if (error) throw new Error(`indexing repo count failed: ${error.message}`);')
  })

  it('the sweep counts only storable blobs and reports unstorable fetches to the coverage measure', () => {
    expect(indexer).toContain("filter((t) => t.type === 'blob' && isStorableBlob(t))")
    expect(indexer).toContain('const files = blobs.filter((t) => eligible(t.path));')
    expect(indexer).toContain("if (got.skip === 'unstorable') {")
    expect(indexer).toMatch(/indexedPaths: new Set\(\[\.\.\.indexedBefore, \.\.\.writtenPaths\]\),\s*unstorablePaths,/)
  })

  it('the hourly batch re-picks filling repos (not stalled ones), oldest attempt first', () => {
    expect(indexer).toContain('index_coverage_state.eq.filling')
    expect(indexer).not.toContain('index_coverage_state.eq.stalled')
    expect(indexer).toContain(".order('last_index_attempt_at', { ascending: true, nullsFirst: true })")
    // The progress check needs the pre-sweep count.
    expect(indexer).toContain('indexedBefore: indexedEligibleBefore,')
  })

  it("the sweep applies the repo's path filter and the project scope, read strictly", () => {
    const sweep = indexer.slice(indexer.indexOf('async function handleSweep('), indexer.indexOf('async function sweepIndexRepo('))
    expect(sweep).toContain('path_globs')
    expect(sweep).toContain('indexPathFilter({')
    expect(sweep).toContain('scope: await loadIndexScopeStrict(db, repo.project_id)')
    // …and fails the run when they match nothing.
    expect(indexer).toContain('if (filteredAway && !(opts.targetFramePaths?.length)) throw new Error(filteredAway);')
    expect(indexer).toContain("if (error) throw new Error(`codebase scope read failed: ${error.message}`);")
  })

  it('the push path checks the plan ceiling and writes coverage', () => {
    const push = indexer.slice(indexer.indexOf('async function indexPushForProject('), indexer.indexOf('async function loadIndexedAmong('))
    expect(push).toContain('admitPushPaths({')
    expect(push).toContain('for (const path of admission.admit)')
    expect(push).toContain('pushCoverageUpdate({')
    expect(push).toContain('...(coverageUpdate ?? {}),')
    expect(push).toContain('indexPathFilter({')
    // A failed membership read throws rather than indexing past the cap.
    expect(indexer).toContain('if (error) throw new Error(`indexed-path lookup failed: ${error.message}`);')
  })

  it('the cap comes from the plan, and one run fetches a bounded batch', () => {
    expect(indexer).toContain('resolveProjectPlan(db, projectId)')
    expect(indexer).toContain("envInt('MUSHI_REPO_INDEX_SWEEP_RUN_FILES'")
    expect(indexer).not.toContain("envInt('MUSHI_REPO_INDEX_SWEEP_FILE_CAP'")
  })

  it('the Repo page and repos-list routes send the sweep and coverage columns', () => {
    const repoRoutes = readFileSync(resolve(FN, 'api/routes/query-fixes-repo.ts'), 'utf8')
    const overview = repoRoutes.slice(repoRoutes.indexOf("app.get('/v1/admin/repo/overview'"), repoRoutes.indexOf("app.get('/v1/admin/repo/activity'"))
    for (const col of ['index_swept_at', 'index_coverage_state', 'index_files_indexed', 'index_files_eligible']) {
      expect(overview, `overview select ${col}`).toContain(`${col}`)
      expect(overview, `overview response ${col}`).toContain(`${col}: primaryRepo?.${col} ?? null`)
    }
    const list = repoRoutes.slice(repoRoutes.indexOf("app.get('/v1/admin/repo/repos'"), repoRoutes.indexOf("app.post('/v1/admin/repo/repos'"))
    expect(list).toContain('last_indexed_at, index_swept_at, index_coverage_state, index_files_indexed, index_files_eligible')
  })

  it('doctor builds its codebase-index check with the shared helper', () => {
    expect(doctor).toContain('checks.push(codebaseIndexDoctorCheck(pid, repoByProject.get(pid)));')
    expect(doctor).not.toContain('Index issue:')
  })
})

describe('path filter (gap 16b: the remediation the coverage callout gives)', () => {
  it('pathMatchesAnyGlob: ** spans directories, * one segment, bare paths are prefixes', () => {
    expect(pathMatchesAnyGlob('src/a/b.ts', ['src/**'])).toBe(true)
    expect(pathMatchesAnyGlob('lib/a.ts', ['src/**'])).toBe(false)
    expect(pathMatchesAnyGlob('apps/web/src/x.tsx', ['apps/*/src/**'])).toBe(true)
    expect(pathMatchesAnyGlob('apps/web/lib/x.tsx', ['apps/*/src/**'])).toBe(false)
    expect(pathMatchesAnyGlob('src/a.ts', ['src/'])).toBe(true)
    expect(pathMatchesAnyGlob('srcx/a.ts', ['src'])).toBe(false)
    expect(pathMatchesAnyGlob('anything.ts', [])).toBe(true)
    expect(pathMatchesAnyGlob('anything.ts', null)).toBe(true)
  })

  it('indexPathFilter combines the indexable check, the project scope and the globs', () => {
    const f = indexPathFilter({ scope: { scope_paths: ['apps'], exclude_globs: ['**/*.test.ts'] }, pathGlobs: ['apps/*/src/**'] })
    expect(f('apps/web/src/a.ts')).toBe(true)
    expect(f('apps/web/src/a.test.ts')).toBe(false)
    expect(f('apps/web/lib/a.ts')).toBe(false)
    expect(f('packages/x/src/a.ts')).toBe(false)
    expect(f('apps/web/src/logo.png')).toBe(false)
    expect(indexPathFilter({ scope: null, pathGlobs: null })('lib/a.ts')).toBe(true)
  })

  it('a filter that matches nothing is an error, not a complete 0 of 0 index', () => {
    const err = emptyEligibleError({ indexableFiles: 4714, eligibleFiles: 0, pathGlobs: ['services/**'] })
    expect(err).toContain('filter_matches_nothing')
    expect(err).toContain('services/**')
    expect(err).toContain('4,714 indexable files')
    expect(emptyEligibleError({ indexableFiles: 4714, eligibleFiles: 3, pathGlobs: ['src/**'] })).toBeNull()
    // An empty repo is simply complete.
    expect(emptyEligibleError({ indexableFiles: 0, eligibleFiles: 0, pathGlobs: null })).toBeNull()
  })

  it('a filter shrinks the eligible set and can turn capped into complete', () => {
    const tree = [
      ...Array.from({ length: 300 }, (_, i) => `src/f${i}.ts`),
      ...Array.from({ length: 900 }, (_, i) => `scripts/s${i}.ts`),
    ]
    const indexed = new Set(tree.slice(0, 300))
    const unfiltered = measureIndexCoverage({ eligiblePaths: tree, indexedPaths: indexed, cap: 300, truncated: false })
    expect(unfiltered).toMatchObject({ indexed: 300, eligible: 1200, state: 'capped' })

    const onlySrc = tree.filter(indexPathFilter({ scope: null, pathGlobs: ['src/**'] }))
    const filtered = measureIndexCoverage({ eligiblePaths: onlySrc, indexedPaths: indexed, cap: 300, truncated: false })
    expect(filtered).toMatchObject({ indexed: 300, eligible: 300, state: 'complete' })
    // And the sweep would fetch only filtered files.
    expect(selectSweepFiles({ treePaths: onlySrc, framePaths: [], indexedPaths: new Set(), planCap: 300, runBudget: 50 })
      .every((p) => p.startsWith('src/'))).toBe(true)
  })
})

describe('stalled coverage (a filling sweep that adds nothing)', () => {
  const eligible = ['a.ts', 'b.ts', 'c.ts', 'd.ts']

  it('no new file indexed while filling reads as stalled', () => {
    const cov = measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts']), cap: 300, truncated: false, indexedBefore: 1 })
    expect(cov.state).toBe('stalled')
  })

  it('progress keeps it filling; complete and capped are unaffected', () => {
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts', 'b.ts']), cap: 300, truncated: false, indexedBefore: 1 }).state).toBe('filling')
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(eligible), cap: 300, truncated: false, indexedBefore: 4 }).state).toBe('complete')
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts', 'b.ts']), cap: 2, truncated: false, indexedBefore: 2 }).state).toBe('capped')
    // Without the pre-sweep count (older callers) it stays filling.
    expect(measureIndexCoverage({ eligiblePaths: eligible, indexedPaths: new Set(['a.ts']), cap: 300, truncated: false }).state).toBe('filling')
  })

  it('a stalled sweep records why, so the console never shows a silent stall', () => {
    const cov = { indexed: 10, eligible: 20, cap: 300, truncated: false, state: 'stalled' as const }
    const fetches = sweepBookkeeping({ coverage: cov, nowIso: NOW, failedChunks: 0, fetchErrors: 3, lastFetchError: 'contents fetch 502 for src/x.ts' })
    expect(fetches.last_index_error).toContain('stalled:')
    expect(fetches.last_index_error).toContain('3 file fetch(es) failed (contents fetch 502 for src/x.ts)')
    expect(fetches).not.toHaveProperty('last_indexed_at')
    expect(fetches.index_coverage_state).toBe('stalled')
    const embeds = sweepBookkeeping({ coverage: cov, nowIso: NOW, failedChunks: 4, lastError: 'too many tokens' })
    expect(embeds.last_index_error).toContain('4 chunk embedding(s) failed (too many tokens)')
    expect(sweepBookkeeping({ coverage: cov, nowIso: NOW, failedChunks: 0 }).last_index_error).toContain('no unindexed file could be fetched')
  })

  it('describeIndexCoverage words a stall', () => {
    expect(describeIndexCoverage({ indexed: 10, eligible: 20, cap: 300, truncated: false, state: 'stalled' })).toContain('the last sweep added none')
  })
})

describe('push indexing and the plan ceiling', () => {
  it('refreshes indexed files always and admits new ones only under the cap', () => {
    const out = admitPushPaths({
      candidates: ['old1.ts', 'new1.ts', 'new2.ts', 'old2.ts', 'new3.ts'],
      indexed: new Set(['old1.ts', 'old2.ts']),
      indexedCount: 298,
      cap: 300,
    })
    expect(out.admit).toEqual(['old1.ts', 'new1.ts', 'new2.ts', 'old2.ts'])
    expect(out.overCap).toEqual(['new3.ts'])
  })

  it('at the cap a push only refreshes', () => {
    const out = admitPushPaths({ candidates: ['n.ts', 'o.ts'], indexed: new Set(['o.ts']), indexedCount: 300, cap: 300 })
    expect(out).toEqual({ admit: ['o.ts'], overCap: ['n.ts'] })
  })

  it('coverage follows the push', () => {
    const prev = { indexed: 300, eligible: 300, truncated: false, state: 'complete' }
    // Two new files, one admitted (cap 301): now capped at 301 of 302.
    expect(pushCoverageUpdate({ prev, cap: 301, addedToRepo: 2, removedFromRepo: 0, newlyIndexed: 1, unindexed: 0 })).toEqual({
      index_files_indexed: 301,
      index_files_eligible: 302,
      index_file_cap: 301,
      index_coverage_state: 'capped',
    })
    // A removal shrinks both counts and keeps it complete.
    expect(pushCoverageUpdate({ prev, cap: 1500, addedToRepo: 0, removedFromRepo: 1, newlyIndexed: 0, unindexed: 1 })).toMatchObject({
      index_files_indexed: 299,
      index_files_eligible: 299,
      index_coverage_state: 'complete',
    })
    // A new file whose embedding failed leaves it filling for the hourly sweep.
    expect(pushCoverageUpdate({ prev, cap: 1500, addedToRepo: 1, removedFromRepo: 0, newlyIndexed: 0, unindexed: 0 })?.index_coverage_state).toBe('filling')
  })

  it('a stalled repo stays stalled until something changes, and rejoins filling when it does', () => {
    const prev = { indexed: 10, eligible: 20, truncated: false, state: 'stalled' }
    expect(pushCoverageUpdate({ prev, cap: 300, addedToRepo: 0, removedFromRepo: 0, newlyIndexed: 0, unindexed: 0 })?.index_coverage_state).toBe('stalled')
    expect(pushCoverageUpdate({ prev, cap: 300, addedToRepo: 1, removedFromRepo: 0, newlyIndexed: 1, unindexed: 0 })?.index_coverage_state).toBe('filling')
  })

  it('writes nothing before a sweep has measured the repo', () => {
    expect(pushCoverageUpdate({
      prev: { indexed: null, eligible: null, truncated: null, state: null },
      cap: 300,
      addedToRepo: 1,
      removedFromRepo: 0,
      newlyIndexed: 1,
      unindexed: 0,
    })).toBeNull()
  })
})

describe('sweepOutcome (a sweep that embedded nothing)', () => {
  const filling: IndexCoverage = { indexed: 10, eligible: 20, cap: 300, truncated: false, state: 'filling' }

  it('a filling repo whose new files all fail embedding is recorded as stalled, out of the hourly batch', () => {
    // measureIndexCoverage turns "filling, nothing added" into stalled.
    const coverage = measureIndexCoverage({
      eligiblePaths: Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`),
      indexedPaths: new Set(Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`)),
      cap: 300,
      truncated: false,
      indexedBefore: 10,
    })
    expect(coverage.state).toBe('stalled')
    const out = sweepOutcome({ inserted: 0, failed: 4, lastError: 'maximum context length exceeded', fetchErrors: 0, coverage, nowIso: NOW })
    expect(out.ok).toBe(false)
    expect(out.update.index_coverage_state).toBe('stalled')
    expect(out.update.index_swept_at).toBe(NOW)
    expect(out.update.last_index_attempt_at).toBe(NOW)
    expect(out.update).not.toHaveProperty('last_indexed_at')
    expect(out.update.last_index_error).toMatch(/^stalled: /)
    expect(out.update.last_index_error).toContain('4 chunk embedding(s) failed (maximum context length exceeded)')
    expect(out.error).toBe(out.update.last_index_error)
    expect(out.update).toMatchObject({ index_files_indexed: 10, index_files_eligible: 20, index_file_cap: 300 })
  })

  it('a failed run that still made progress records filling coverage too', () => {
    const out = sweepOutcome({ inserted: 0, failed: 2, lastError: 'rate limited', fetchErrors: 0, coverage: filling, nowIso: NOW })
    expect(out.ok).toBe(false)
    expect(out.update).toMatchObject({ index_coverage_state: 'filling', index_swept_at: NOW, last_index_error: 'rate limited' })
  })

  it('a complete or capped repo whose embeddings all failed stays a failed run (no index_swept_at)', () => {
    for (const state of ['complete', 'capped'] as const) {
      const out = sweepOutcome({
        inserted: 0,
        failed: 3,
        lastError: 'OpenAI 401',
        fetchErrors: 0,
        coverage: { indexed: 20, eligible: 20, cap: 300, truncated: false, state },
        nowIso: NOW,
      })
      expect(out.ok).toBe(false)
      expect(out.error).toBe('OpenAI 401')
      expect(out.update).not.toHaveProperty('index_swept_at')
      expect(out.update).not.toHaveProperty('last_indexed_at')
      expect(out.update).toMatchObject({ last_index_attempt_at: NOW, last_index_error: 'OpenAI 401', index_coverage_state: state })
    }
  })

  it('a run that embedded something, or lost nothing, is the plain sweep bookkeeping', () => {
    const complete: IndexCoverage = { indexed: 20, eligible: 20, cap: 300, truncated: false, state: 'complete' }
    const ok = sweepOutcome({ inserted: 5, failed: 1, lastError: 'one batch failed', fetchErrors: 0, coverage: complete, nowIso: NOW })
    expect(ok.ok).toBe(true)
    expect(ok.update).toEqual(sweepBookkeeping({ coverage: complete, nowIso: NOW, failedChunks: 1, lastError: 'one batch failed', fetchErrors: 0 }))
    expect(sweepOutcome({ inserted: 0, failed: 0, fetchErrors: 0, coverage: complete, nowIso: NOW }).ok).toBe(true)
  })
})

describe('codebaseIndexDoctorCheck', () => {
  const base = {
    last_indexed_at: null,
    last_index_error: null,
    index_swept_at: NOW,
    index_files_indexed: 10,
    index_files_eligible: 20,
    index_file_cap: 300,
    index_tree_truncated: false,
    index_coverage_state: 'filling',
  }

  it('a stalled repo gets its coverage and the reason, not only the generic index issue', () => {
    const check = codebaseIndexDoctorCheck('p1', {
      ...base,
      index_coverage_state: 'stalled',
      last_index_error: 'stalled: the last sweep indexed no new file; 4 chunk embedding(s) failed (too many tokens). Retried on the daily sweep.',
    })
    expect(check.name).toBe('codebase_index:p1')
    expect(check.status).toBe('warn')
    expect(check.summary).toContain('Index stalled: 10 of 20 files indexed')
    expect(check.summary).toContain(`last sweep ${NOW}`)
    expect(check.summary).toContain('Reason: the last sweep indexed no new file; 4 chunk embedding(s) failed')
    expect(check.summary).not.toContain('Index issue')
    expect(check.summary).not.toContain('stalled: the last')
    expect(check.hint).toContain('retried daily')
  })

  it('never swept fails; a recorded error warns with the coverage; partial warns; complete passes', () => {
    expect(codebaseIndexDoctorCheck('p1', undefined).status).toBe('fail')
    expect(codebaseIndexDoctorCheck('p1', { ...base, index_swept_at: null }).status).toBe('fail')
    const err = codebaseIndexDoctorCheck('p1', { ...base, last_index_error: 'push indexing failed: HTTP 500' })
    expect(err.status).toBe('warn')
    expect(err.summary).toContain('Index issue: push indexing failed: HTTP 500')
    expect(err.summary).toContain('coverage: 10 of 20 files indexed')
    expect(codebaseIndexDoctorCheck('p1', base).summary).toContain('Partly indexed:')
    expect(codebaseIndexDoctorCheck('p1', { ...base, index_coverage_state: 'capped' }).hint).toContain('higher plan')
    const done = codebaseIndexDoctorCheck('p1', { ...base, index_files_indexed: 20, index_coverage_state: 'complete', last_indexed_at: NOW })
    expect(done.status).toBe('pass')
    expect(done.summary).toBe(`Indexed: 20 of 20 files indexed (last sweep ${NOW}).`)
  })
})

describe('path filter: globstar and narrowing', () => {
  it('a ** followed by a slash also matches zero directories', () => {
    expect(pathMatchesAnyGlob('a.ts', ['**/*.ts'])).toBe(true)
    expect(pathMatchesAnyGlob('src/x/a.ts', ['**/*.ts'])).toBe(true)
    expect(pathMatchesAnyGlob('a.tsx', ['**/*.ts'])).toBe(false)
    expect(pathMatchesAnyGlob('src/a.ts', ['src/**/*.ts'])).toBe(true)
    expect(pathMatchesAnyGlob('src/x/y/a.ts', ['src/**/*.ts'])).toBe(true)
    expect(pathMatchesAnyGlob('lib/a.ts', ['src/**/*.ts'])).toBe(false)
    expect(pathMatchesAnyGlob('apps/web/lib/a.ts', ['apps/*/src/**'])).toBe(false)
    expect(pathMatchesAnyGlob('apps/web/src/a.ts', ['apps/*/src/**'])).toBe(true)
    // `*` still stays inside one segment.
    expect(pathMatchesAnyGlob('src/x/a.ts', ['src/*.ts'])).toBe(false)
  })

  it('the scope exclude globs keep their meaning', () => {
    // exclude_globs use the older matcher on purpose: `**/x` there needs a directory.
    const f = indexPathFilter({ scope: { scope_paths: [], exclude_globs: ['**/generated.ts'] }, pathGlobs: null })
    expect(f('generated.ts')).toBe(true)
    expect(f('src/generated.ts')).toBe(false)
  })

  it('pathsOutsideFilter: indexed tree files the filter now excludes, nothing else', () => {
    const eligible = indexPathFilter({ scope: null, pathGlobs: ['src/**'] })
    const out = pathsOutsideFilter({
      indexedPaths: new Set(['src/a.ts', 'scripts/b.ts', 'gone/c.ts']),
      indexableTreePaths: ['src/a.ts', 'scripts/b.ts', 'scripts/new.ts'],
      eligible,
      indexingRepos: 1,
    })
    // gone/c.ts is not in the tree (a truncated listing could omit it): left alone.
    expect(out).toEqual(['scripts/b.ts'])
    expect(pathsOutsideFilter({ indexedPaths: new Set(['a.ts']), indexableTreePaths: ['a.ts'], eligible: () => true, indexingRepos: 1 })).toEqual([])
  })

  it('a project indexing several repos tombstones nothing (the index is per project)', () => {
    // Backend repo (api/**) also has src/index.ts, which is the frontend's indexed file.
    const backend = indexPathFilter({ scope: null, pathGlobs: ['api/**'] })
    expect(pathsOutsideFilter({
      indexedPaths: new Set(['src/index.ts', 'api/a.ts']),
      indexableTreePaths: ['src/index.ts', 'api/a.ts'],
      eligible: backend,
      indexingRepos: 2,
    })).toEqual([])
  })
})
