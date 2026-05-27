/**
 * FILE: apps/admin/src/components/integrations/DryRunPanel.tsx
 * PURPOSE: "Validate pipeline" dry-run button that calls
 *          POST /v1/admin/projects/:id/fixes/dry-run and surfaces the
 *          simulated steps inline. Lets users confirm the full dispatch
 *          pipeline works without burning a real Anthropic call or opening
 *          a PR.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Card, Btn, ResultChip } from '../ui'

interface DryRunStep {
  step: string
  status: 'pass' | 'fail' | 'skip' | 'simulated'
  detail: string
}

interface DryRunResult {
  ready: boolean
  simulatedSteps: DryRunStep[]
  estimatedCostUsd: number | null
  note: string
}

const STEP_LABELS: Record<string, string> = {
  preflight: 'Preflight checks',
  repo_resolution: 'Repository resolution',
  context_assembly: 'Context assembly',
  llm_call: 'LLM call',
  pr_creation: 'Pull request creation',
}

const STEP_TONE: Record<DryRunStep['status'], 'success' | 'error' | 'idle' | 'info'> = {
  pass: 'success',
  fail: 'error',
  skip: 'idle',
  simulated: 'info',
}

export function DryRunPanel({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    setError(null)
    const res = await apiFetch<DryRunResult>(
      `/v1/admin/projects/${projectId}/fixes/dry-run`,
      { method: 'POST' },
    )
    setRunning(false)
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? 'Dry-run failed')
      return
    }
    setResult(res.data)
  }

  return (
    <Card className="p-3 mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-fg-primary">Validate pipeline</h4>
          <p className="text-2xs text-fg-muted mt-0.5">
            Simulates the auto-fix pipeline without calling the LLM or opening a PR.
          </p>
        </div>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => void run()}
          loading={running}
          disabled={running}
        >
          {running ? 'Validating\u2026' : 'Run dry-run'}
        </Btn>
      </div>

      {error && (
        <p className="text-2xs text-danger bg-danger/5 border border-danger/20 rounded px-2 py-1">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ResultChip tone={result.ready ? 'success' : 'error'}>
              {result.ready ? 'Pipeline ready' : 'Pipeline blocked'}
            </ResultChip>
            {result.estimatedCostUsd != null && (
              <span className="text-2xs text-fg-muted">
                Est. cost per dispatch: ~${result.estimatedCostUsd.toFixed(2)}
              </span>
            )}
          </div>
          {result.simulatedSteps.map((step) => (
            <div key={step.step} className="flex items-start gap-2">
              <ResultChip tone={STEP_TONE[step.status]} className="shrink-0 mt-px">
                {step.status}
              </ResultChip>
              <div className="min-w-0">
                <span className="text-2xs font-medium text-fg-secondary">
                  {STEP_LABELS[step.step] ?? step.step}
                </span>
                <span className="text-2xs text-fg-muted ml-1">{'\u2014'} {step.detail}</span>
              </div>
            </div>
          ))}
          <p className="text-2xs text-fg-faint italic pt-1">{result.note}</p>
        </div>
      )}
    </Card>
  )
}
