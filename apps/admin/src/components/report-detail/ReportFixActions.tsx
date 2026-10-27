/**
 * FILE: apps/admin/src/components/report-detail/ReportFixActions.tsx
 * PURPOSE: On the report page, where this report's fix PR sits in the
 *          pipeline and what unsticks it: the failing check names and the
 *          same one-click actions /pipeline offers, each enabled only when
 *          the server would take it (reports 9e2ec6f0, 69fcafcb). The page
 *          used to say "CI failed · Blocked" with no check named and no
 *          button; Re-run CI then lived only on /pipeline, where it always
 *          403'd.
 *
 * Data: GET /v1/admin/pipeline/fix/:id (the item, its group and actions).
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui'
import { ActionButtons, BlockedReasons } from '../pipeline/PipelineGroups'
import { PipelineActionDialog, type PendingAction } from '../pipeline/PipelineActionDialog'
import { loadPipelineFix, outcomeSummary, runPipelineAction, type ActionOutcome, type PipelineFixView } from '../../lib/pipeline'
import { useToast } from '../../lib/toast'

interface Props {
  fixId: string
  /** Called after an action ran, so the page reads the fix again. */
  onChanged?: () => void
}

/** "1 PR: their own CI is red" → "their own CI is red": one PR needs no count. */
function reasonOf(label: string): string {
  return label.replace(/^\d+\s+[A-Za-z]+:\s*/, '')
}

export function ReportFixActions({ fixId, onChanged }: Props) {
  const toast = useToast()
  const [view, setView] = useState<PipelineFixView | null>(null)
  const [pending, setPending] = useState<{ action: PendingAction; key: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [result, setResult] = useState<ActionOutcome | null>(null)

  const load = useCallback(async () => {
    setView(await loadPipelineFix(fixId))
  }, [fixId])

  useEffect(() => {
    void load()
  }, [load])

  const confirm = useCallback(
    async (reason: string | undefined) => {
      if (!pending) return
      setBusyKey(pending.key)
      try {
        const out = await runPipelineAction(pending.action.action, pending.action.fixIds, reason, pending.action.reportIds)
        setResult(out[0] ?? null)
        if (out.some((r) => r.ok)) toast.success(outcomeSummary(out))
        else toast.error(outcomeSummary(out))
      } finally {
        setBusyKey(null)
        setPending(null)
        void load()
        onChanged?.()
      }
    },
    [pending, toast, load, onChanged],
  )

  const item = view?.item
  if (!view || !item || !view.groupLabel) return null
  const stuck = view.tone === 'stuck'

  return (
    <section
      aria-label="Where this fix is"
      className={`rounded-md border px-3 py-2 ${stuck ? 'border-danger/30 bg-danger-muted/30' : 'border-edge-subtle bg-surface-raised'}`}
      data-testid="report-fix-actions"
    >
      <p className="text-xs text-fg">
        <span className="font-medium">{stuck ? 'Stuck: ' : 'Now: '}</span>
        {reasonOf(view.groupLabel)}
        <Link to="/pipeline" className="ml-2 text-2xs font-medium text-brand hover:underline">
          Pipeline →
        </Link>
      </p>
      {item.failingChecks.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-fg-muted" data-testid="report-fix-failing-checks">
          <span>Failing:</span>
          {item.failingChecks.slice(0, 8).map((c) => (
            <Badge key={c} tone="dangerSubtle">{c}</Badge>
          ))}
        </p>
      )}
      {view.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ActionButtons
            actions={view.actions}
            items={[item]}
            target={item.title}
            keyPrefix={item.id}
            busyKey={busyKey}
            onAction={(action, key) => setPending({ action, key })}
            testIdPrefix="report-fix"
          />
          {result && (
            <span className={`text-2xs ${result.ok ? 'text-ok-foreground' : 'text-danger-foreground'}`} role="status">
              {result.message}
            </span>
          )}
        </div>
      )}
      <div className="mt-1">
        <BlockedReasons item={item} actions={view.actions} testIdPrefix="report-fix" />
      </div>
      {pending && (
        <PipelineActionDialog pending={pending.action} busy={busyKey != null} onConfirm={(r) => void confirm(r)} onCancel={() => setPending(null)} />
      )}
    </section>
  )
}
