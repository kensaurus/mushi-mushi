import { useState } from 'react'
import { Btn } from '../ui'
import { IconQaCoverage } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import type { ReportDetail } from './types'

interface GenerateTestButtonProps {
  report: ReportDetail
}

export function GenerateTestButton({ report }: GenerateTestButtonProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    const res = await apiFetch<{ qa_story_id?: string; pr_url?: string }>(
      `/v1/admin/inventory/${report.project_id}/test-gen/from-report/${report.id}`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    setLoading(false)
    if (!res.ok) {
      toast.error('Test generation failed', res.error?.message ?? 'Could not start test-gen-from-report')
      return
    }
    const storyId = res.data?.qa_story_id
    toast.success(
      'Regression test queued',
      storyId
        ? `QA story ${storyId.slice(0, 8)}… created — review in QA Coverage.`
        : 'Draft Playwright test is being generated.',
    )
  }

  return (
    <Btn
      variant="ghost"
      size="sm"
      onClick={handleGenerate}
      loading={loading}
      leadingIcon={<IconQaCoverage />}
      title="Generate a Playwright regression test from this report"
    >
      Generate test
    </Btn>
  )
}
