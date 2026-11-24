import { describe, expect, it, vi } from 'vitest'

vi.mock('./usePageData', () => ({ usePageData: () => ({ data: null }) }))

import { repoMatchingRelease } from './useDispatchTargetRepo'

const repo = (id: string, name: string, is_primary = false) => ({ id, repo_url: `https://github.com/kensaurus/${name}`, default_branch: 'main', is_primary })

// 2026-11-24: a Solo Boss backend error (soloboss-backend@4.72.0) started on
// the primary documentation repo, so "Dispatch fix" targeted the wrong code.
describe('repoMatchingRelease', () => {
  const sbc = [repo('be', 'solo-boss-cloud_backend'), repo('docs', 'solo-boss-cloud-documentation', true)]

  it('picks the one repo the release package names best', () => {
    expect(repoMatchingRelease(sbc, 'soloboss-backend@4.72.0')).toBe('be')
  })

  it('stays out of the way on a tie, no match, no release or a single repo', () => {
    expect(repoMatchingRelease(sbc, 'soloboss@1.0.0')).toBeNull()
    expect(repoMatchingRelease(sbc, 'glot-it@1.115.0')).toBeNull()
    expect(repoMatchingRelease(sbc, null)).toBeNull()
    expect(repoMatchingRelease([sbc[0]], 'soloboss-backend@4.72.0')).toBeNull()
  })
})
