/**
 * Codebase index coverage (gaps #16a / #16b):
 *   - a partial sweep never sets last_indexed_at, and records coverage;
 *   - the coverage ceiling follows the plan (env pin for self-host);
 *   - one run fetches a bounded batch, admitting new files only under the
 *     ceiling, so a big cap fills over several runs;
 *   - the consumers (index-failing probe, doctor wording) read partial
 *     sweeps as successful.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDEX_FILE_CAP,
  describeIndexCoverage,
  indexFileCapForPlan,
  isStorableBlob,
  latestIso,
  measureIndexCoverage,
  MAX_INDEX_FILE_CAP,
  selectSweepFiles,
  sweepBookkeeping,
} from '../../supabase/functions/_shared/index-coverage.ts'
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

  it('the sweep writes bookkeeping through sweepBookkeeping, not a bare last_indexed_at', () => {
    const sweep = indexer.slice(indexer.indexOf('async function handleSweep('), indexer.indexOf('async function sweepIndexRepo('))
    expect(sweep).toContain('...sweepBookkeeping({')
    expect(sweep).not.toMatch(/last_indexed_at:\s*new Date/)
  })

  it('the sweep counts only storable blobs and reports unstorable fetches to the coverage measure', () => {
    expect(indexer).toContain("shouldIndex(t.path) && isStorableBlob(t)")
    expect(indexer).toContain("if (got.skip === 'unstorable') unstorablePaths.add(path)")
    expect(indexer).toMatch(/indexedPaths: new Set\(\[\.\.\.indexedBefore, \.\.\.writtenPaths\]\),\s*unstorablePaths,/)
  })

  it('the hourly batch re-picks filling repos, oldest attempt first', () => {
    expect(indexer).toContain('index_coverage_state.eq.filling')
    expect(indexer).toContain(".order('last_index_attempt_at', { ascending: true, nullsFirst: true })")
  })

  it('the cap comes from the plan, and one run fetches a bounded batch', () => {
    expect(indexer).toContain('resolveProjectPlan(db, projectId)')
    expect(indexer).toContain("envInt('MUSHI_REPO_INDEX_SWEEP_RUN_FILES'")
    expect(indexer).not.toContain("envInt('MUSHI_REPO_INDEX_SWEEP_FILE_CAP'")
  })

  it('doctor treats a partial sweep as indexed (warn), not as never indexed (fail)', () => {
    expect(doctor).toContain('latestIso(repo.last_indexed_at, repo.index_swept_at)')
    expect(doctor).toContain('Partly indexed:')
  })
})
