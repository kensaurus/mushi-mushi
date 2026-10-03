/**
 * Projects list index chip: a repo that has only had partial sweeps (plan
 * file limit, or still filling) is indexed, not "Pending". `last_indexed_at`
 * moves only on a complete sweep since migration 20261003160000, so health
 * reads the later of it and `index_swept_at`.
 */
import { describe, expect, it } from 'vitest'
import { indexCoverageText, indexHealth, lastIndexSweepAt, type ProjectRepoLite } from './project-models'

const now = new Date().toISOString()
const base: ProjectRepoLite = {
  id: 'r1',
  repo_url: 'https://github.com/acme/shop',
  role: 'primary',
  default_branch: 'main',
  is_primary: true,
  indexing_enabled: true,
  last_indexed_at: null,
  last_index_attempt_at: now,
  last_index_error: null,
  github_app_connected: false,
}

describe('indexHealth with coverage', () => {
  it('a partial-only repo is Partial, not never-indexed', () => {
    expect(indexHealth({ ...base, index_swept_at: now, index_coverage_state: 'capped' })).toBe('partial')
    expect(indexHealth({ ...base, index_swept_at: now, index_coverage_state: 'filling' })).toBe('partial')
    // A stalled repo (last sweep added nothing) is partial too, not ok.
    expect(indexHealth({ ...base, index_swept_at: now, index_coverage_state: 'stalled' })).toBe('partial')
  })
  it('a complete repo is ok, and an older server payload behaves as before', () => {
    expect(indexHealth({ ...base, last_indexed_at: now, index_swept_at: now, index_coverage_state: 'complete' })).toBe('ok')
    expect(indexHealth({ ...base, last_indexed_at: now })).toBe('ok')
    expect(indexHealth(base)).toBe('never')
  })
  it('an error after the last sweep is still a failure', () => {
    const later = new Date(Date.now() + 60_000).toISOString()
    expect(indexHealth({ ...base, index_swept_at: now, last_index_attempt_at: later, last_index_error: 'tree fetch 404' })).toBe('failed')
  })
  it('a partial sweep a week old is stale', () => {
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString()
    expect(indexHealth({ ...base, index_swept_at: old, last_index_attempt_at: old, index_coverage_state: 'capped' })).toBe('stale')
  })
})

describe('helpers', () => {
  it('lastIndexSweepAt takes the later timestamp', () => {
    expect(lastIndexSweepAt({ last_indexed_at: '2026-10-01T00:00:00Z', index_swept_at: '2026-10-03T00:00:00Z' })).toBe('2026-10-03T00:00:00Z')
    expect(lastIndexSweepAt({ last_indexed_at: null })).toBeNull()
  })
  it('indexCoverageText formats files', () => {
    expect(indexCoverageText({ index_files_indexed: 1500, index_files_eligible: 4700 })).toBe('1,500 of 4,700 files')
    expect(indexCoverageText({})).toBeNull()
  })
})
