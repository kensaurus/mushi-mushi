import { describe, expect, it } from 'vitest'
import {
  buildFreshnessTooltip,
  buildPrJobTooltip,
  catalogPrSignalsConflict,
  freshnessChipLabel,
  prJobChipLabel,
} from './bulkSdkUpgradeTooltips'
import type { BulkUpgradeProject } from '../components/projects/BulkSdkUpgradePanel'

const baseProject: BulkUpgradeProject = {
  id: 'p1',
  name: 'mushi-mushi',
  slug: 'mushi-mushi',
  sdk_package: '@mushi-mushi/web',
  sdk_version: '1.14.1',
  sdk_latest_version: '1.16.0',
  sdk_status: 'outdated',
  sdk_observation_source: 'repo_scan',
  hasRepo: true,
}

describe('catalogPrSignalsConflict', () => {
  it('flags monorepo mismatch when catalog behind but no PR', () => {
    expect(catalogPrSignalsConflict(baseProject, 'completed_no_pr')).toBe(true)
  })

  it('does not flag when upgrade opened a PR', () => {
    expect(catalogPrSignalsConflict(baseProject, 'completed')).toBe(false)
  })
})

describe('freshnessChipLabel', () => {
  it('prefixes catalog chip with version arrow', () => {
    expect(freshnessChipLabel(baseProject)).toEqual({
      prefix: 'Catalog',
      text: 'v1.14.1 → v1.16.0',
    })
  })
})

describe('prJobChipLabel', () => {
  it('labels completed PR rows as PR ready', () => {
    expect(prJobChipLabel('completed')).toBe('PR ready')
  })

  it('renames completed_no_pr to No PR needed', () => {
    expect(prJobChipLabel('completed_no_pr')).toBe('No PR needed')
  })
})

describe('buildFreshnessTooltip', () => {
  it('includes observation metadata', () => {
    const tip = buildFreshnessTooltip(baseProject, 'completed_no_pr')
    const meta = tip.sections.find((s) => s.label === 'Metadata')
    expect(meta?.body).toContain('Package: @mushi-mushi/web')
    expect(meta?.body).toContain('Observation: Repo declared')
    expect(tip.callout?.text).toMatch(/workspace:\*/)
  })
})

describe('buildPrJobTooltip', () => {
  it('explains follow-up when PR opened', () => {
    const tip = buildPrJobTooltip({
      status: 'completed',
      prUrl: 'https://github.com/org/repo/pull/1',
      plan: [{ package: '@mushi-mushi/web', from: '1.14.0', to: '1.16.0' }],
      releaseStatus: 'ready_to_merge',
    })
    expect(tip.sections.some((s) => s.label === 'After the PR opens')).toBe(true)
    expect(tip.callout?.text).toMatch(/CI passed/)
  })
})
