/**
 * FILE: apps/admin/src/components/dashboard/FirstReportHero.tsx
 * PURPOSE: When the SDK is installed but no real bug reports have landed
 *          yet, the regular dashboard collapses into a wall of zeros which
 *          buries the user's real next action ("send a test report").
 *
 *          This hero promotes that single CTA above the metric grid for
 *          the brief window where the user is "almost live" — addressing
 *          the audit P1 finding that new accounts couldn't tell what to
 *          do next on their freshly-set-up project.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, ResultChip, type ResultChipTone } from '../ui'

interface Props {
  projectId: string
  projectName: string
  onReportSent?: () => void
}

const HERO_CLASS =
  'relative overflow-hidden rounded-lg border border-brand/30 bg-gradient-to-br from-brand/8 via-surface-raised/40 to-surface-raised/10 p-4 mb-4'

type SendStatus = 'idle' | 'running' | 'pass' | 'fail'

// Rendered next to the CTA so the result is sticky after the toast fades.
// Mapping lives close to the consumer because the CTA semantics — pass after
// running, error message preserved on fail — are specific to this hero.
function statusToTone(status: SendStatus): ResultChipTone {
  if (status === 'running') return 'running'
  if (status === 'pass') return 'success'
  if (status === 'fail') return 'error'
  return 'idle'
}

export function FirstReportHero({ projectId, projectName, onReportSent }: Props) {
  const toast = useToast()
  const [status, setStatus] = useState<SendStatus>('idle')
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function send() {
    setStatus('running')
    setErrorMessage(null)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/test-report`, { method: 'POST' })
    if (res.ok) {
      setStatus('pass')
      setSentAt(new Date().toISOString())
      toast.success('Test report queued', 'Watch it land in /reports within a few seconds.')
      onReportSent?.()
    } else {
      const msg = res.error?.message ?? 'Check your project keys and try again.'
      setStatus('fail')
      setErrorMessage(msg)
      toast.error('Test report failed', msg)
    }
  }

  return (
    <section aria-labelledby="first-report-hero-title" className={HERO_CLASS}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-brand text-brand-fg font-bold text-sm shrink-0">
          P
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs uppercase tracking-wider text-brand/80 font-semibold">
            Plan · Your next step
          </p>
          <h2 id="first-report-hero-title" className="text-sm font-semibold text-fg mt-0.5">
            Send a test report from{' '}
            <span className="font-mono text-fg">{projectName}</span>
          </h2>
          <p className="text-2xs text-fg-secondary mt-1 leading-snug max-w-prose">
            Your SDK is wired up, but no real users have flagged a bug yet. Fire a synthetic
            report so you can watch one full Plan → Do → Check loop without waiting on traffic.
          </p>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Btn
              size="sm"
              variant={status === 'pass' ? 'ghost' : 'primary'}
              onClick={send}
              loading={status === 'running'}
              disabled={status === 'running' || status === 'pass'}
            >
              {status === 'pass' ? 'Send another' : 'Send test report'}
            </Btn>
            {status !== 'idle' && (
              <ResultChip tone={statusToTone(status)} at={status === 'pass' ? sentAt : null}>
                {status === 'running' && 'Submitting test report…'}
                {status === 'pass' && 'Queued — opening /reports'}
                {status === 'fail' && (errorMessage ?? 'Submission failed')}
              </ResultChip>
            )}
            {status === 'pass' && (
              <Link to="/reports" className="text-2xs text-brand hover:underline">
                Open /reports →
              </Link>
            )}
            <Link
              to="/onboarding"
              className="text-2xs text-fg-faint hover:text-fg-muted"
            >
              Open the full setup guide →
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
