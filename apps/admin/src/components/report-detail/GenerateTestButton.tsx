import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn } from '../ui'
import { IconQaCoverage } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ConfirmDialog } from '../ConfirmDialog'
import { humanizeApiError } from '../../lib/humanizeApiError'
import type { ReportDetail } from './types'

interface GenerateTestButtonProps {
  report: ReportDetail
}

/** What POST …/test-gen/from-report/:id returns on success (the worker's data, flat). */
interface TestGenResult {
  prUrl?: string
  prNumber?: number
  branch?: string
  path?: string
}

export function GenerateTestButton({ report }: GenerateTestButtonProps) {
  const toast = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleGenerate = async () => {
    setConfirming(false)
    setLoading(true)
    const res = await apiFetch<TestGenResult>(
      `/v1/admin/inventory/${report.project_id}/test-gen/from-report/${report.id}`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    setLoading(false)
    if (!res.ok) {
      // The worker's code, in plain English with its fix (the route used to
      // wrap failures at HTTP 200, so every one read "Request failed").
      const h = humanizeApiError(res.error?.message || 'Request failed', res.error?.code ?? null, {
        action: 'generate the test',
      })
      const target = h?.action?.target
      toast.error(
        h?.title ?? 'Could not generate the test.',
        h?.hint,
        h?.action && target?.kind === 'route'
          ? { label: h.action.label, onClick: () => navigate(target.hash ? `${target.to}#${target.hash}` : target.to) }
          : undefined,
      )
      return
    }
    const prUrl = res.data?.prUrl
    toast.success(
      'Regression test opened as a draft PR',
      res.data?.prNumber
        ? `PR #${res.data.prNumber}${res.data.path ? ` adds ${res.data.path}` : ''}. Review it on GitHub.`
        : 'Review it on GitHub.',
      prUrl ? { label: 'Open PR', onClick: () => window.open(prUrl, '_blank', 'noopener,noreferrer') } : undefined,
    )
  }

  return (
    <>
      <Btn
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        loading={loading}
        leadingIcon={<IconQaCoverage />}
        title="Generate a Playwright regression test from this report"
      >
        Generate test
      </Btn>
      {confirming && (
        <ConfirmDialog
          title="Generate a regression test?"
          body="Mushi writes a Playwright test for this bug with your LLM budget and opens a draft PR on the connected repo. Nothing merges until you review it."
          confirmLabel="Generate test"
          onCancel={() => setConfirming(false)}
          onConfirm={handleGenerate}
        />
      )}
    </>
  )
}
