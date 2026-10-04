/**
 * FILE: apps/admin/src/components/design/DesignChangePreview.tsx
 * PURPOSE: Shows a dry-run result (unified diff per file + denied paths), the
 *          confirm button, and — only when the server returned a `pr` — the
 *          draft PR link. A confirm that returns `pr: null` says plainly that
 *          no PR was opened.
 */

import { PROJECT_ADMIN_PR_HINT, useActiveProjectCanManage } from '../../lib/useOrgCanManage'
import { actionErrorText } from '../../lib/actionErrorText'
import { Badge, Btn, Callout, ErrorAlert } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { DesignChangeResult, DesignFileChange } from '../../lib/recipeTypes'
import { parseUnifiedDiff, type DiffLineKind } from './designTokens'
import type { DesignChangeState } from './useDesignChange'

const LINE_CLS: Record<DiffLineKind, string> = {
  add: 'bg-ok-muted/50 text-ok-foreground',
  del: 'bg-danger-muted/50 text-danger-foreground',
  hunk: 'text-info-foreground',
  meta: 'text-fg-faint',
  ctx: 'text-fg-secondary',
}

function UnifiedDiff({ diff }: { diff: string }) {
  const lines = parseUnifiedDiff(diff)
  return (
    <pre className="max-h-96 overflow-auto rounded-sm border border-edge-subtle bg-surface p-2 font-mono text-2xs leading-relaxed">
      {lines.map((l, i) => (
        <span key={i} className={`block whitespace-pre ${LINE_CLS[l.kind]}`}>
          {l.text || ' '}
        </span>
      ))}
    </pre>
  )
}

export function DeniedList({ denied }: { denied: DesignChangeResult['denied'] }) {
  if (denied.length === 0) return null
  return (
    <Callout tone="warn" label="Not allowed — left out of the change">
      <ul className="flex flex-col gap-1 text-xs">
        {denied.map((d) => (
          <li key={d.path}>
            <span className="font-mono">{d.path}</span>
            <span className="text-fg-secondary"> — {d.reason}</span>
          </li>
        ))}
      </ul>
    </Callout>
  )
}

export function FileDiffs({ files }: { files: DesignFileChange[] }) {
  if (files.length === 0) {
    return <p className="text-xs text-fg-muted">No file would change.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {files.map((f) => (
        <div key={f.path} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-fg">{f.path}</span>
            <Badge tone="okSubtle">+{f.additions}</Badge>
            <Badge tone="dangerSubtle">−{f.deletions}</Badge>
          </div>
          <UnifiedDiff diff={f.diff} />
        </div>
      ))}
    </div>
  )
}

function safePrUrl(url: string): string | null {
  return /^https:\/\//i.test(url) ? url : null
}

interface DesignChangePreviewProps {
  state: DesignChangeState
  onConfirm: () => void
  onDiscard: () => void
}

export function DesignChangePreview({ state, onConfirm, onDiscard }: DesignChangePreviewProps) {
  const { phase, preview, result, error } = state
  // Opening the PR is for the project team's owners and admins; a member
  // learned that only after confirming (QA 292).
  const { canManage } = useActiveProjectCanManage()
  if (phase === 'idle') return null

  if (phase === 'previewing') {
    return <p className="text-xs text-fg-muted" role="status">Building the preview diff…</p>
  }

  if (phase === 'submitted' && result) {
    const pr = result.pr
    const href = pr ? safePrUrl(pr.url) : null
    return (
      <div className="flex flex-col gap-2">
        {pr ? (
          <Callout tone="ok" label="Draft PR opened">
            <p className="text-xs text-fg-secondary">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT}>
                  Draft PR #{pr.number}
                </a>
              ) : (
                <span className="font-mono">Draft PR #{pr.number}</span>
              )}{' '}
              on <span className="font-mono">{pr.branch}</span> — stays in draft so your CI does not run until you mark it
              ready.
            </p>
          </Callout>
        ) : (
          <Callout tone="warn" label="No PR was opened">
            <p className="text-xs text-fg-secondary">
              The server answered without a pull request, so no draft PR was opened. Check the denied paths below.
            </p>
          </Callout>
        )}
        <DeniedList denied={result.denied} />
        <div>
          <Btn size="sm" variant="ghost" onClick={onDiscard}>
            Done
          </Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorAlert message={actionErrorText({ message: error })} />}
      {preview && (
        <>
          <p className="text-xs text-fg-secondary">
            Preview only — nothing is written yet. Confirm to open a draft PR with exactly this diff.
          </p>
          <FileDiffs files={preview.files} />
          <DeniedList denied={preview.denied} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              size="sm"
              variant="primary"
              onClick={onConfirm}
              loading={phase === 'submitting'}
              disabled={phase === 'submitting' || preview.files.length === 0 || canManage === false}
              title={
                canManage === false
                  ? PROJECT_ADMIN_PR_HINT
                  : preview.files.length === 0
                  ? 'Nothing to open: the preview changes no file'
                  : phase === 'submitting'
                    ? 'Opening the draft PR…'
                    : 'Open a draft PR with exactly this diff'
              }
            >
              Open draft PR
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={onDiscard}
              disabled={phase === 'submitting'}
              title={phase === 'submitting' ? 'Wait for the PR request to finish' : 'Throw away this preview'}
            >
              Discard preview
            </Btn>
          </div>
          {canManage === false && <p className="text-xs text-fg-muted">{PROJECT_ADMIN_PR_HINT}</p>}
        </>
      )}
      {!preview && phase === 'error' && (
        <div>
          <Btn size="sm" variant="ghost" onClick={onDiscard}>
            Dismiss
          </Btn>
        </div>
      )}
    </div>
  )
}
