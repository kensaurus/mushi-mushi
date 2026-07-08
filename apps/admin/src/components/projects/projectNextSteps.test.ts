import { describe, expect, it } from 'vitest'
import { deriveProjectNextSteps, deriveProjectPlainStatus } from './projectNextSteps'
import type { Project } from './project-models'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'demo-app',
    slug: 'demo-app',
    created_at: '2026-01-01T00:00:00Z',
    organization_id: null,
    organization_role: null,
    api_keys: [
      {
        id: 'k1',
        key_prefix: 'mushi_abc',
        created_at: '2026-01-01T00:00:00Z',
        is_active: true,
        revoked: false,
        last_seen_at: '2026-07-01T00:00:00Z',
      },
    ],
    active_key_count: 1,
    member_count: 1,
    members: [],
    report_count: 5,
    last_report_at: '2026-07-01T00:00:00Z',
    pdca_bottleneck: null,
    pdca_bottleneck_label: null,
    primary_repo: { repo_url: 'https://github.com/x/y' } as Project['primary_repo'],
    ...overrides,
  }
}

describe('deriveProjectNextSteps', () => {
  it('tells key-less projects to mint a key first', () => {
    const steps = deriveProjectNextSteps(project({ active_key_count: 0, api_keys: [] }))
    expect(steps[0]?.id).toBe('mint-key')
  })

  it('tells never-connected projects to wire the SDK, not to mint more keys', () => {
    const steps = deriveProjectNextSteps(
      project({
        api_keys: [
          {
            id: 'k1',
            key_prefix: 'mushi_abc',
            created_at: '2026-01-01T00:00:00Z',
            is_active: true,
            revoked: false,
            last_seen_at: null,
          },
        ],
      }),
    )
    expect(steps[0]?.id).toBe('connect-sdk')
  })

  it('suggests the one-click SDK upgrade when versions drift', () => {
    const steps = deriveProjectNextSteps(
      project({ sdk_version: 'v1.22.3', sdk_latest_version: 'v1.23.0' }),
    )
    expect(steps.map((s) => s.id)).toContain('upgrade-sdk')
    expect(steps.find((s) => s.id === 'upgrade-sdk')?.title).toContain('v1.22.3')
  })

  it('caps the list at three actions', () => {
    const steps = deriveProjectNextSteps(
      project({
        active_key_count: 0,
        api_keys: [],
        report_count: 0,
        sdk_version: 'v1.0.0',
        sdk_latest_version: 'v2.0.0',
        pdca_bottleneck_label: '4 bugs waiting for triage',
        pdca_bottleneck_count: 4,
        primary_repo: null,
      }),
    )
    expect(steps.length).toBeLessThanOrEqual(3)
  })

  it('returns no steps for a healthy project', () => {
    expect(deriveProjectNextSteps(project())).toEqual([])
  })
})

describe('deriveProjectPlainStatus', () => {
  it('says healthy in plain words when nothing is pending', () => {
    const status = deriveProjectPlainStatus(project())
    expect(status.tone).toBe('ok')
    expect(status.verdict).toContain('healthy')
  })

  it('flags not-connected projects as inactive', () => {
    const status = deriveProjectPlainStatus(project({ active_key_count: 0, api_keys: [] }))
    expect(status.tone).toBe('inactive')
    expect(status.verdict).toContain("isn't connected")
  })

  it('counts the pending items in the verdict', () => {
    const status = deriveProjectPlainStatus(
      project({ sdk_version: 'v1.22.3', sdk_latest_version: 'v1.23.0' }),
    )
    expect(status.tone).toBe('attention')
    expect(status.verdict).toContain('one thing')
  })
})
