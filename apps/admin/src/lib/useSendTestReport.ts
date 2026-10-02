/**
 * FILE: apps/admin/src/lib/useSendTestReport.ts
 * PURPOSE: The one "Send test report" action. Every button that fires the
 *          admin test report goes through here, so they all end the same way:
 *          a toast with "View diagnosis →" that opens the report on the right
 *          project, where the report detail page records `diagnosis_viewed`
 *          (lib/diagnosisViewed.ts). The sample diagnosis is the activation
 *          moment; a toast that only said "watch Reports" left it unreachable.
 *
 *          The first-diagnosis screen (components/onboarding) keeps its own
 *          poll-and-render flow and does not use this hook.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from './supabase'
import { useToast } from './toast'
import { scopedHref } from './humanPageHints'
import { invalidateSetupStatus } from './useSetupStatus'

type SendTestReportResult =
  | { ok: true; reportId: string; projectName: string }
  | { ok: false; message: string }

/** Report detail URL pinned to the project the report belongs to. */
function testReportHref(reportId: string, projectId: string): string {
  return scopedHref(`/reports/${reportId}`, projectId)
}

export function useSendTestReport(): (projectId: string) => Promise<SendTestReportResult> {
  const toast = useToast()
  const navigate = useNavigate()

  return useCallback(
    async (projectId: string) => {
      const res = await apiFetch<{ reportId: string; projectName: string }>(
        `/v1/admin/projects/${projectId}/test-report`,
        { method: 'POST' },
      )
      if (!res.ok || !res.data?.reportId) {
        const message = res.error?.message ?? 'Check your project keys and try again.'
        toast.error('Test report failed', message)
        return { ok: false, message }
      }
      const { reportId, projectName } = res.data
      // The checklist's "first report" step reads this; refresh every copy.
      invalidateSetupStatus()
      toast.success(
        projectName ? `Test report sent to ${projectName}` : 'Test report sent',
        'Mushi is writing the diagnosis now, usually in under 30 seconds.',
        { label: 'View diagnosis →', onClick: () => navigate(testReportHref(reportId, projectId)) },
      )
      return { ok: true, reportId, projectName }
    },
    [toast, navigate],
  )
}
