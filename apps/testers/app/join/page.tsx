'use client'
/**
 * /join — tester signup landing.
 * Accepts optional ?app=<slug> to scope the CTA.
 * Client component so it works with output: 'export' (no server-side searchParams).
 */
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { TestersPageShell } from '../components/TestersPageShell'

function JoinPageInner() {
  const searchParams = useSearchParams()
  const appSlug = searchParams.get('app') ?? undefined
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  const next = appSlug ? `/tester/apps/${appSlug}` : '/tester'
  const signupUrl = `${adminUrl}/login?as=tester&next=${encodeURIComponent(next)}`

  return (
    <TestersPageShell>
      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <p className="mb-4 text-4xl">🪲</p>
            <h1 className="mb-2 text-3xl font-bold">
              {appSlug ? 'Join to test this app' : 'Become a Mushi tester'}
            </h1>
            <p className="testers-muted">
              {appSlug
                ? 'Sign up free and start earning points for finding bugs.'
                : 'Find bugs in real apps. Earn points. Redeem for gift cards or Mushi Pro credit.'}
            </p>
          </div>

          <div className="testers-panel space-y-6 p-8">
            <ul className="space-y-3">
              {[
                { icon: '🐛', text: 'Find bugs in apps from real developers' },
                { icon: '💰', text: 'Earn mushi-points for every accepted report' },
                { icon: '🎁', text: 'Redeem for Amazon, Starbucks, App Store gift cards' },
                { icon: '⚡', text: '1.3× bonus when you convert points to Mushi Pro credit' },
              ].map(({ icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-0.5 text-lg leading-none">{icon}</span>
                  <span className="text-sm text-[var(--mushi-ink)]">{text}</span>
                </li>
              ))}
            </ul>

            <hr className="border-[var(--mushi-rule)]" />

            <div className="space-y-3">
              <a
                href={signupUrl}
                className="testers-cta block w-full px-8 py-3 text-center text-base"
              >
                Create free tester account →
              </a>
              <p className="testers-faint text-center text-xs">
                No credit card required · Free forever to participate
              </p>
            </div>

            <hr className="border-[var(--mushi-rule)]" />

            <div className="text-center">
              <p className="testers-muted text-sm">
                Already have an account?{' '}
                <a href={signupUrl} className="testers-brand-mark underline underline-offset-2 hover:opacity-90">
                  Sign in →
                </a>
              </p>
            </div>
          </div>

          <p className="testers-faint mt-6 text-center text-xs leading-relaxed">
            By creating an account you agree to the{' '}
            <a href="/mushi-mushi/docs/legal/tester-terms" className="underline underline-offset-2 hover:text-[var(--mushi-ink-muted)]">
              Tester Terms of Service
            </a>{' '}
            and{' '}
            <a href="/mushi-mushi/docs/legal/privacy" className="underline underline-offset-2 hover:text-[var(--mushi-ink-muted)]">
              Privacy Policy
            </a>
            . Gift card payouts are subject to OFAC compliance and a $599/yr KYC threshold.
            See{' '}
            <a href="/mushi-mushi/testers/how-it-works/" className="underline underline-offset-2 hover:text-[var(--mushi-ink-muted)]">
              How it works
            </a>{' '}
            for full details.
          </p>
        </div>
      </div>
    </TestersPageShell>
  )
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="testers-shell flex min-h-screen items-center justify-center">
          <p className="testers-muted">Loading…</p>
        </div>
      }
    >
      <JoinPageInner />
    </Suspense>
  )
}
