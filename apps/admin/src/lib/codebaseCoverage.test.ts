/**
 * Codebase indexing card helpers (index coverage gaps 16a and 16b): coverage copy in files,
 * the plan-limit hint, and the polling rule that used to spin forever on a
 * partially indexed repo.
 */
import { describe, expect, it } from 'vitest'
import {
  coverageView,
  fileCapHint,
  indexedChunks,
  lastSweptAt,
  shouldPollCodebaseStats,
  type CodebaseStats,
} from './codebaseCoverage'

const base: CodebaseStats = {
  codebase_index_enabled: true,
  repo_url: 'https://github.com/acme/shop',
  default_branch: 'main',
  installation_id: null,
  indexing_enabled: true,
  path_globs: null,
  indexed_files: 0,
  indexed_chunks: 0,
  file_cap: 300,
  at_file_cap: false,
  last_indexed_at: null,
  index_swept_at: null,
  last_index_attempt_at: null,
  last_index_error: null,
  has_webhook_secret: true,
}

describe('shouldPollCodebaseStats', () => {
  it('polls until the first sweep lands', () => {
    expect(shouldPollCodebaseStats(base, false)).toBe(true)
  })
  it('stops once a partial sweep wrote chunks, though last_indexed_at stays empty', () => {
    expect(shouldPollCodebaseStats({ ...base, indexed_chunks: 1200, index_swept_at: '2026-10-03T10:00:00Z' }, false)).toBe(false)
  })
  it('stops after a complete sweep and never polls while editing or disabled', () => {
    expect(shouldPollCodebaseStats({ ...base, indexed_chunks: 10, last_indexed_at: '2026-10-03T10:00:00Z' }, false)).toBe(false)
    expect(shouldPollCodebaseStats(base, true)).toBe(false)
    expect(shouldPollCodebaseStats({ ...base, codebase_index_enabled: false }, false)).toBe(false)
    expect(shouldPollCodebaseStats(null, false)).toBe(false)
  })
})

describe('lastSweptAt / indexedChunks', () => {
  it('takes the later sweep, complete or partial', () => {
    expect(lastSweptAt({ last_indexed_at: '2026-10-01T00:00:00Z', index_swept_at: '2026-10-03T00:00:00Z' })).toBe('2026-10-03T00:00:00Z')
    expect(lastSweptAt({ last_indexed_at: '2026-10-03T00:00:00Z', index_swept_at: null })).toBe('2026-10-03T00:00:00Z')
    expect(lastSweptAt({ last_indexed_at: null, index_swept_at: undefined })).toBeNull()
  })
  it('falls back to indexed_files from an older server', () => {
    expect(indexedChunks({ indexed_files: 42 })).toBe(42)
    expect(indexedChunks({ indexed_files: 42, indexed_chunks: 40 })).toBe(40)
  })
})

describe('coverageView', () => {
  const cov = { indexed_files: 300, eligible_files: 4700, file_cap: 300, truncated: false, summary: null, measured_at: null }
  it('a complete index is ok with no callout', () => {
    const v = coverageView({ ...cov, indexed_files: 120, eligible_files: 120, state: 'complete' }, 300)
    expect(v).toMatchObject({ tone: 'ok', callout: null })
    expect(v.value).toBe('120 of 120 files (all)')
  })
  it('a filling index says the hourly sweep adds more', () => {
    const v = coverageView({ ...cov, indexed_files: 600, file_cap: 1500, state: 'filling' }, 1500)
    expect(v.tone).toBe('info')
    expect(v.callout?.text).toContain('600 of 4,700 files indexed so far')
    expect(v.callout?.text).toContain('1,500-file limit')
  })
  it('a capped index names the plan limit and the way out', () => {
    const v = coverageView({ ...cov, state: 'capped' }, 300)
    expect(v.tone).toBe('warn')
    expect(v.callout?.tone).toBe('warn')
    expect(v.callout?.text).toContain("Indexed 300 of 4,700 files, your plan's 300-file limit")
    expect(v.callout?.text).toContain('path filter')
  })
  it('a truncated tree blames GitHub, not the plan', () => {
    const v = coverageView({ ...cov, indexed_files: 120, eligible_files: 120, truncated: true, file_cap: 1500, state: 'capped' }, 1500)
    expect(v.value).toBe('120 of 120+ files')
    expect(v.callout?.text).toContain('GitHub returned only part')
  })
})

describe('fileCapHint', () => {
  it('explains where the limit comes from', () => {
    expect(fileCapHint('env')).toContain('MUSHI_REPO_INDEX_SWEEP_FILE_CAP')
    expect(fileCapHint('plan_tier')).toContain('plan')
    expect(fileCapHint('unavailable')).toContain('last sweep used')
  })
})
