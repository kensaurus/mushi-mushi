/**
 * TesterLearnPage — scannable guide with visuals + accordions (no text walls).
 * Readable before enroll; shows a compact activate strip when not a tester yet.
 */
import { useTesterStatus } from '../../lib/useTesterStatus'
import {
  TesterGuideAccordion,
  TesterGuideBullets,
  TesterGuideLink,
  TesterHowItWorksFlow,
  TesterPointsEconomyStrip,
} from '../../components/tester/TesterVisuals'
import { TesterPageIntro, TESTER_PANEL, TesterPrimaryCta } from '../../components/tester/tester-ui'
import { Btn } from '../../components/ui'
import { useToast } from '../../lib/toast'
import { useState } from 'react'

interface GuideItem {
  id: string
  icon: string
  title: string
  summary: string
  bullets: string[]
  cta?: { label: string; to: string }
  defaultOpen?: boolean
}

const GUIDE: GuideItem[] = [
  {
    id: 'the-loop',
    icon: '🔄',
    title: 'The loop',
    summary: 'Browse → join → report → get paid in points.',
    defaultOpen: true,
    bullets: [
      'Developers list apps with a bounty schedule (points per severity).',
      'Join an app, use it like a real user, submit bugs with repro steps.',
      'Accepted reports credit your wallet instantly; duplicates show feedback.',
    ],
    cta: { label: 'Browse apps', to: '/tester/apps' },
  },
  {
    id: 'good-report',
    icon: '✅',
    title: 'Write reports that get accepted',
    summary: 'Repro steps, evidence, and context — not vibes.',
    bullets: [
      'Numbered steps to reproduce (avoid “it crashed randomly”).',
      'Screenshot or short screen recording with the issue visible.',
      'Device, OS, browser, and app version.',
      'Expected vs actual behavior — be specific.',
      'Console or network errors if you have them.',
      'Spam and duplicates hurt your reputation multiplier.',
    ],
    cta: { label: 'Submit a report', to: '/tester/submissions?new=1' },
  },
  {
    id: 'bounty-math',
    icon: '💰',
    title: 'Points & redemption',
    summary: '1,000 pts = $10 gift card or $13 Pro credit.',
    bullets: [
      'Per-app bounties vary — critical bugs can be 2,500+ pts.',
      'Free to join; you earn by contributing, not paying.',
      'Daily caps per app may apply (shown on each app card).',
    ],
    cta: { label: 'Open wallet', to: '/tester/wallet' },
  },
  {
    id: 'kyc',
    icon: '📋',
    title: 'Gift-card KYC ($599/year)',
    summary: 'US tax rules — only for high gift-card volume.',
    bullets: [
      'Notice at ~$400 redeemed gift cards in a calendar year.',
      'Brief W-9 / W-8BEN form in Settings; TIN is HMAC-hashed, not stored raw.',
      'Mushi Pro credit redemptions skip this gate.',
    ],
    cta: { label: 'KYC in Settings', to: '/tester/settings#kyc' },
  },
  {
    id: 'ofac',
    icon: '🌍',
    title: 'Regions & sanctions',
    summary: 'Some countries block payouts, not testing.',
    bullets: [
      'OFAC-restricted regions cannot redeem gift cards or Pro credit.',
      'You can still browse and submit; appeals reviewed in ~5 business days.',
    ],
    cta: { label: 'Update country', to: '/tester/settings' },
  },
  {
    id: 'anti-fraud',
    icon: '🛡️',
    title: 'Reputation & velocity',
    summary: 'Quality in → bonus out; spam caps protect everyone.',
    bullets: [
      'Reputation multiplies point awards on accepted reports.',
      '>20 reports/day or >5 per app/day triggers review (not auto-delete).',
    ],
  },
  {
    id: 'conduct',
    icon: '📜',
    title: 'Code of conduct',
    summary: 'Good-faith testing only — one human, one account.',
    bullets: [
      'No automated scanning without written developer consent.',
      'No reports on intentionally broken demo content.',
      'No account sharing or cross-app duplicate farming.',
      'Escalate bad-faith devs via Settings → feedback.',
    ],
    cta: { label: 'Send feedback', to: '/tester/settings#feedback' },
  },
  {
    id: 'penalties',
    icon: '⚠️',
    title: 'Penalties (transparent)',
    summary: 'Know the consequences before you push limits.',
    bullets: [
      'Spam: −10 rep; 3 in 7 days → 30-day cooldown on that app.',
      'Velocity over cap: points held up to 48h for review.',
      'Account sharing or unauthorized probing → permanent ban.',
    ],
    cta: { label: 'Contact support', to: '/tester/settings#feedback' },
  },
]

function LearnEnrollStrip() {
  const toast = useToast()
  const { enroll, reload } = useTesterStatus()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleEnroll = async () => {
    if (!termsAccepted) {
      toast.error('Accept the tester terms to activate.')
      return
    }
    setBusy(true)
    try {
      const ok = await enroll({ acceptedTerms: true })
      if (ok) {
        toast.success('Profile activated — head to Apps to join your first program.')
        reload()
      } else {
        toast.error('Activation failed. Try again in a moment.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${TESTER_PANEL} flex flex-col gap-3 border-brand/25 bg-brand-subtle/30 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div>
        <p className="text-sm font-semibold text-fg">Ready to earn?</p>
        <p className="text-xs text-fg-muted">Activate your free tester profile — takes one click.</p>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-2xs text-fg-secondary">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded-sm border-edge accent-brand"
          />
          <span>I agree to the Mushi Bounties tester terms</span>
        </label>
      </div>
      <Btn variant="primary" loading={busy} onClick={handleEnroll} disabled={!termsAccepted}>
        Activate profile
      </Btn>
    </div>
  )
}

export function TesterLearnPage() {
  const { data: status } = useTesterStatus()
  const showEnroll = status && !status.isTester

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <TesterPageIntro
        title="How Bounties works"
        description="Short guides you can skim in minutes — expand any topic for detail."
      />

      {showEnroll && <LearnEnrollStrip />}

      <TesterHowItWorksFlow />

      <TesterPointsEconomyStrip />

      <nav className={`${TESTER_PANEL} p-4`} aria-label="Guide topics">
        <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Jump to</p>
        <div className="flex flex-wrap gap-2">
          {GUIDE.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-edge-subtle bg-surface-overlay px-2.5 py-1 text-xs text-fg-secondary hover:border-brand/40 hover:text-brand"
            >
              {s.icon} {s.title}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-3">
        {GUIDE.map((section) => (
          <TesterGuideAccordion
            key={section.id}
            id={section.id}
            icon={section.icon}
            title={section.title}
            summary={section.summary}
            defaultOpen={section.defaultOpen}
          >
            <TesterGuideBullets items={section.bullets} />
            {section.cta && (
              <p className="pt-2">
                <TesterGuideLink to={section.cta.to}>{section.cta.label}</TesterGuideLink>
              </p>
            )}
          </TesterGuideAccordion>
        ))}
      </div>

      <div className={`${TESTER_PANEL} space-y-3 p-5 text-center sm:text-left`}>
        <h2 className="text-base font-semibold text-fg">Your first points are one app away</h2>
        <p className="text-sm text-fg-muted">
          Pick something you already use, join its program, and file one clear bug report.
        </p>
        {showEnroll ? (
          <LearnEnrollStrip />
        ) : (
          <TesterPrimaryCta to="/tester/apps">Browse apps</TesterPrimaryCta>
        )}
      </div>
    </div>
  )
}
