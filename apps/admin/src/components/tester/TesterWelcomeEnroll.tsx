/**
 * FILE: apps/admin/src/components/tester/TesterWelcomeEnroll.tsx
 * PURPOSE: Onboarding gate when the signed-in user has no mushi_testers row —
 *          replaces dead-end error text with enroll CTA + visual journey.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { useToast } from '../../lib/toast'
import { useTesterStatus } from '../../lib/useTesterStatus'
import { TesterHowItWorksFlow, TesterPointsEconomyStrip } from './TesterVisuals'
import { TESTER_PANEL, TesterPrimaryCta } from './tester-ui'

const MARKETPLACE_URL = '/mushi-mushi/testers/'

export function TesterWelcomeEnroll() {
  const toast = useToast()
  const { enroll, reload } = useTesterStatus()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleEnroll = async () => {
    if (!termsAccepted) {
      toast.error('Accept the tester terms to continue.')
      return
    }
    setBusy(true)
    try {
      const ok = await enroll({ marketingOptIn: marketing, acceptedTerms: true })
      if (ok) {
        toast.success('Welcome to Mushi Bounties — pick an app and start testing.')
        reload()
      } else {
        toast.error('Could not activate your tester account. Try again in a moment.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-3xl" aria-hidden>🪲</p>
        <h1 className="text-xl font-semibold text-fg text-balance">
          Turn real bugs into mushi-points
        </h1>
        <p className="max-w-xl text-sm text-fg-muted text-pretty">
          You&apos;re signed in — activate your free tester profile to browse apps, submit reports,
          and redeem points for gift cards or Mushi Pro credit.
        </p>
      </div>

      <TesterHowItWorksFlow />

      <TesterPointsEconomyStrip />

      <div className={`${TESTER_PANEL} space-y-4 p-5`}>
        <p className="text-sm font-medium text-fg">Activate in one step</p>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded-sm border-edge accent-brand"
          />
          <span>
            I agree to the{' '}
            <a href="/mushi-mushi/testers/terms" target="_blank" rel="noreferrer" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
              Mushi Bounties tester terms
            </a>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded-sm border-edge accent-brand"
          />
          <span>Send me occasional tips on writing reports that get accepted (optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" loading={busy} onClick={handleEnroll} disabled={!termsAccepted}>
            Activate my tester profile
          </Btn>
          <TesterPrimaryCta to="/tester/learn">See how it works first</TesterPrimaryCta>
        </div>
        <p className="text-2xs text-fg-faint">
          Free to join · No credit card · You can delete your data anytime in Settings
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-fg-muted sm:justify-start">
        <span>Prefer the public site?</span>
        <a
          href={MARKETPLACE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors"
        >
          Browse marketplace ↗
        </a>
        <span className="hidden text-fg-faint sm:inline" aria-hidden>·</span>
        <Link to="/dashboard" className="font-medium text-fg-muted hover:text-fg">
          Back to admin console
        </Link>
      </div>
    </div>
  )
}
