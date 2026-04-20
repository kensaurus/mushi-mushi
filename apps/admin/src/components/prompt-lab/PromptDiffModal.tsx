import { Card, Btn, RelativeTime } from '../ui'
import { formatLlmCost } from '../../lib/format'
import type { PromptVersion } from './types'
import { lineDiff } from './lineDiff'

interface PromptDiffModalProps {
  prompt: PromptVersion
  parent: PromptVersion | undefined
  onClose: () => void
}

export function PromptDiffModal({ prompt, parent, onClose }: PromptDiffModalProps) {
  const lines = parent ? lineDiff(parent.prompt_template, prompt.prompt_template) : []
  const meta = prompt.auto_generation_metadata
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in"
      onClick={onClose}
    >
      <Card
        elevated
        className="w-full max-w-5xl p-4 space-y-2 max-h-[90vh] flex flex-col motion-safe:animate-mushi-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            Diff · {prompt.stage} / {prompt.version} vs {parent?.version ?? 'parent'}
          </h3>
          <button
            type="button"
            className="text-fg-muted hover:text-fg text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {meta && (
          <div className="text-2xs text-fg-muted space-y-1 border border-edge-subtle rounded-sm p-2 bg-surface-overlay">
            {meta.changeSummary && (
              <p className="text-fg-secondary">
                <span className="text-fg-faint">Why: </span>
                {meta.changeSummary}
              </p>
            )}
            <div className="flex flex-wrap gap-2 font-mono">
              {meta.failureCount != null && <span>failures: {meta.failureCount}</span>}
              {meta.model && <span>model: {meta.model}</span>}
              {meta.generatedAt && <span>generated: <RelativeTime value={meta.generatedAt} /></span>}
            </div>
            {meta.topBuckets && meta.topBuckets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 font-mono">
                <span className="text-fg-faint">buckets:</span>
                {meta.topBuckets.map((b) => (
                  <span key={b.reason} className="px-1 rounded-sm bg-fg-faint/10">
                    {b.reason} ×{b.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {!parent ? (
          <p className="text-2xs text-fg-faint">Parent prompt not found (it may have been deleted).</p>
        ) : (
          <pre className="flex-1 overflow-auto bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono leading-snug">
            {lines.map((l, idx) => (
              <div
                key={idx}
                className={
                  l.kind === 'add'
                    ? 'bg-ok/10 text-ok'
                    : l.kind === 'del'
                      ? 'bg-danger/10 text-danger'
                      : 'text-fg-muted'
                }
              >
                <span className="select-none mr-2 text-fg-faint">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                </span>
                {l.text || '\u00A0'}
              </div>
            ))}
          </pre>
        )}
        {parent && <PerfStrip parent={parent} candidate={prompt} />}
        <div className="flex justify-end gap-1.5">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </Card>
    </div>
  )
}

// Performance vs baseline strip. Wave J §3 — `Avg $ / eval` now reads real
// cost data from llm_invocations.cost_usd via /v1/admin/prompt-lab. The
// 3-cell layout lets ops see "did the candidate get more accurate AND
// cheaper?" without leaving the diff.
function PerfStrip({ parent, candidate }: { parent: PromptVersion; candidate: PromptVersion }) {
  const cells = [
    {
      label: 'Evaluations',
      parent: formatNum(parent.total_evaluations),
      candidate: formatNum(candidate.total_evaluations),
      delta: numericDelta(parent.total_evaluations, candidate.total_evaluations, 'higher-is-up'),
    },
    {
      label: 'Avg judge score',
      parent: formatScore(parent.avg_judge_score),
      candidate: formatScore(candidate.avg_judge_score),
      delta: numericDelta(parent.avg_judge_score, candidate.avg_judge_score, 'higher-is-up'),
    },
    {
      label: 'Avg $ / eval',
      parent: formatLlmCost(parent.avg_cost_usd),
      candidate: formatLlmCost(candidate.avg_cost_usd),
      // For cost, lower is BETTER — invert the tone so a cheaper candidate
      // reads green and a more expensive one reads red.
      delta: numericDelta(parent.avg_cost_usd, candidate.avg_cost_usd, 'lower-is-up'),
    },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-sm border border-edge-subtle bg-surface-overlay/40 p-2">
          <div className="text-2xs text-fg-muted uppercase tracking-wider mb-1">{c.label}</div>
          <div className="flex items-baseline gap-2 font-mono text-xs">
            <span className="text-fg-faint">parent:</span>
            <span className="text-fg-secondary">{c.parent}</span>
            <span className="text-fg-faint">→</span>
            <span className="text-fg">{c.candidate}</span>
            {c.delta && (
              <span
                className={`text-3xs ${c.delta.tone === 'up' ? 'text-ok' : c.delta.tone === 'down' ? 'text-danger' : 'text-fg-faint'}`}
              >
                {c.delta.label}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

function formatScore(s: number | null | undefined): string {
  if (s == null) return '—'
  return s.toFixed(2)
}

function numericDelta(
  parent: number | null | undefined,
  candidate: number | null | undefined,
  direction: 'higher-is-up' | 'lower-is-up',
): { label: string; tone: 'up' | 'down' | 'flat' } | null {
  if (parent == null || candidate == null) return null
  const diff = candidate - parent
  if (Math.abs(diff) < 0.005) return { label: 'flat', tone: 'flat' }
  const isImprovement = direction === 'higher-is-up' ? diff > 0 : diff < 0
  return {
    label: `${diff > 0 ? '+' : ''}${diff.toFixed(diff > -0.01 && diff < 0.01 ? 4 : 2)}`,
    tone: isImprovement ? 'up' : 'down',
  }
}
