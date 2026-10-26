/**
 * FILE: apps/admin/src/components/fixes/FixGateChecklist.tsx
 * PURPOSE: The merge checks for a fix's current PR head (Plan 024, ADR 0035):
 *          each gate as glyph + word + label (never colour alone), what to do
 *          when one has not passed, whether Mushi merged it on its own, and
 *          anything that broke after the merge with its revert PR. "Re-check"
 *          asks the server to evaluate the head again now.
 */

import { useCallback, useEffect, useState } from 'react'
import { Btn } from '../ui'
import { statusChipTone, type StatusSeverity } from '../../lib/chipTone'
import { fetchFixVerification, recheckFixVerification } from '../../lib/fixVerification'
import type { FixVerification } from '../../lib/verifyTypes'
import { autoMergeView, gateStatusMeta, gatesSummary, regressionLabel, revertLine } from '../../lib/verifyView'

function StatusChip({ glyph, word, tone }: { glyph: string; word: string; tone: StatusSeverity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium ${statusChipTone(tone)}`}
    >
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  )
}

interface Props {
  fixId: string
  /**
   * Heading level. Default `h4` is the report-detail outline (this block
   * sits under that page's h3s). The fixes page passes `h3` so the heading
   * does not skip a level under its h2 sections.
   */
  heading?: 'h3' | 'h4'
}

export function FixGateChecklist({ fixId, heading = 'h4' }: Props) {
  const [verification, setVerification] = useState<FixVerification | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchFixVerification(fixId)
    setLoading(false)
    if (res.ok) {
      setVerification(res.verification)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [fixId])

  useEffect(() => {
    setVerification(null)
    setNotice(null)
    void load()
  }, [load])

  const recheck = async () => {
    setRechecking(true)
    setNotice(null)
    const res = await recheckFixVerification(fixId)
    setRechecking(false)
    if (res.ok) {
      setVerification(res.verification)
      setError(null)
      setNotice({ ok: true, message: 'Checked again just now.' })
    } else {
      setNotice({ ok: false, message: res.error })
    }
  }

  const gates = verification?.gates ?? []
  const autoMerge = verification ? autoMergeView(verification.autoMerge.state, verification.autoMerge.detail) : null
  const shortSha = verification?.headSha ? verification.headSha.slice(0, 7) : null
  const Title = heading

  return (
    <section
      aria-label="Merge checks"
      data-testid="fix-gate-checklist"
      className="space-y-1.5 rounded-sm border border-edge-subtle bg-surface p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Title className="text-xs font-medium text-fg">Merge checks</Title>
          {verification && (
            <p className="text-2xs text-fg-muted" data-testid="fix-gate-summary">
              {gatesSummary(gates)}
              {shortSha ? (
                <>
                  {' '}
                  on commit <span className="font-mono">{shortSha}</span>
                </>
              ) : null}
            </p>
          )}
        </div>
        <Btn
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void recheck()}
          disabled={rechecking || loading}
          loading={rechecking}
          title="Check this pull request's latest commit again now"
        >
          Re-check
        </Btn>
      </div>

      {loading && !verification && !error && <p className="text-2xs text-fg-faint">Loading the merge checks…</p>}
      {error && !verification && (
        <p className="text-2xs text-fg-muted">
          Merge checks: could not load ({error}).{' '}
          <button
            type="button"
            className="text-accent-foreground underline underline-offset-2"
            onClick={() => void load()}
          >
            Try again
          </button>
        </p>
      )}
      {!loading && !error && !verification && (
        <p className="text-2xs text-fg-muted" data-testid="fix-gate-unchecked">
          Not checked yet. Mushi checks a cloud agent&apos;s pull request once Opus has reviewed its latest commit.
        </p>
      )}

      {gates.length > 0 && (
        <ul className="space-y-1" aria-label="Checks">
          {gates.map((g) => {
            const meta = gateStatusMeta(g.status)
            return (
              <li key={g.id} data-testid={`fix-gate-${g.id}`} className="text-2xs leading-snug">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <StatusChip glyph={meta.glyph} word={meta.word} tone={meta.tone} />
                  <span className="text-fg-secondary">{g.label}</span>
                </div>
                {g.status !== 'pass' && g.detail && <p className="mt-0.5 text-fg-muted">{g.detail}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {autoMerge && (
        <div className="text-2xs" data-testid="fix-gate-auto-merge">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-fg-faint">Automatic merge:</span>
            <StatusChip glyph={autoMerge.glyph} word={autoMerge.word} tone={autoMerge.tone} />
          </div>
          <p className="mt-0.5 text-fg-muted">{autoMerge.sentence}</p>
        </div>
      )}

      {verification && verification.regressions.length > 0 && (
        <div className="text-2xs" data-testid="fix-gate-regressions">
          <p className="font-medium text-fg">After the merge</p>
          <ul className="mt-0.5 space-y-1">
            {verification.regressions.map((r) => {
              const revert = revertLine(r.revertState)
              return (
                <li key={r.id} className="leading-snug">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip glyph="⚠" word="Broke" tone="danger" />
                    <span className="text-fg-secondary">{regressionLabel(r.signal)}</span>
                  </div>
                  {r.detail && <p className="mt-0.5 text-fg-muted">{r.detail}</p>}
                  {revert && <p className="mt-0.5 text-fg-muted">{revert}</p>}
                  {r.revertPrUrl && (
                    <a
                      href={r.revertPrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-foreground underline underline-offset-2"
                    >
                      Open the revert PR ↗
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {notice && (
        <p
          role="status"
          data-testid="fix-gate-notice"
          className={`text-2xs ${notice.ok ? 'text-fg-secondary' : 'text-warn'}`}
        >
          <span aria-hidden="true">{notice.ok ? '✓ ' : '! '}</span>
          {notice.message}
        </p>
      )}
    </section>
  )
}
