/**
 * FILE: apps/admin/src/components/report-detail/TesterSubmissionCard.test.ts
 * PURPOSE: The Mushi Bounties card renders every status the database allows
 *          (2026-10-04 console audit, group B item 234: `triaged` and `withdrawn`
 *          read `config.tone` on undefined and crashed the report page).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/toast', () => ({ useToast: () => ({}) }))

import { STATUS_CONFIG, testerStatusConfig } from './TesterSubmissionCard'

// tester_submissions CHECK (migration 20260523002000_tester_submissions_and_subscriptions.sql).
const DB_STATUSES = ['pending', 'triaged', 'accepted', 'informative', 'duplicate', 'spam', 'withdrawn']

describe('TesterSubmissionCard statuses', () => {
  it('has a label and tone for every status the CHECK allows', () => {
    for (const s of DB_STATUSES) {
      expect(STATUS_CONFIG[s as keyof typeof STATUS_CONFIG], s).toBeDefined()
    }
    expect(testerStatusConfig('withdrawn')).toEqual({ label: 'Withdrawn', tone: 'neutral' })
  })

  it('still renders an unknown status by name', () => {
    expect(testerStatusConfig('paused')).toEqual({ label: 'paused', tone: 'neutral' })
  })
})
