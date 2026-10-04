import { useState } from 'react'
import { Btn } from '../ui'
import { IconQaCoverage } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ConfirmDialog } from '../ConfirmDialog'
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

/**
 * Plain-English failure text for test generation, keyed by the worker's
 * error code. The route used to wrap the worker's reply at HTTP 200, so every
 * failure read "Request failed".
 */
export function testGenErrorText(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 'NO_REPO':
      return 'Connect a GitHub repo to this project first, then try again.'
    case 'NO_GITHUB_TOKEN':
      return 'GitHub is not connected for this project. Connect it in Integrations, then try again.'
    case 'LLM_FAILED':
      return 'The model could not write the test. Check your Anthropic or OpenAI key in Settings, then try again.'
    case 'PATH_REJECTED':
    case 'SECRET_PATTERN':
      return 'The generated test was rejected by a safety check, so no PR was opened. Try again.'
    case 'NOT_FOUND':
      return 'This report is no longer in the project. Refresh the page.'
    case 'GITHUB_ERROR':
      return 'GitHub refused the pull request. Check the repo connection in Integrations.'
    default:
      return 'The test could not be generated. Try again in a moment.'
  }
}

export function GenerateTestButton({ report }: GenerateTestButtonProps) {
  const toast = useToast()
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
      toast.error('No test was generated', testGenErrorText(res.error))
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
