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
import { Btn } from '../ui'

interface Props {
  projectId: string
  projectName: string
  onReportSent?: () => void
}

const HERO_CLASS =
  'relative overflow-hidden rounded-lg border border-brand/30 bg-gradient-to-br from-brand/8 via-surface-raised/40 to-surface-raised/10 p-4 mb-4'

export function FirstReportHero({ projectId, projectName, onReportSent }: Props) {
  const toast = useToast()
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')

  async function send() {
    setStatus('running')
    const res = await apiFetch(`/v1/admin/projects/${projectId}/test-report`, { method: 'POST' })
    if (res.ok) {
      setStatus('pass')
      toast.success('Test report queued', 'Watch it land in /reports within a few seconds.')
      onReportSent?.()
    } else {
      setStatus('fail')
      toast.error('Test report failed', res.error?.message ?? 'Check your project keys and try again.')
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
              disabled={status === 'running' || status === 'pass'}
            >
              {status === 'running'
                ? 'Sending…'
                : status === 'pass'
                  ? '✓ Test sent — open /reports'
                  : 'Send test report'}
            </Btn>
            <Link
              to="/onboarding"
              className="text-2xs text-brand hover:underline"
            >
              Or open the full setup guide →
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
