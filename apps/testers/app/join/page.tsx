'use client'
/**
 * /join — tester signup landing.
 * Accepts optional ?app=<slug> to scope the CTA.
 * Client component so it works with output: 'export' (no server-side searchParams).
 */
import { useSearchParams } from 'next/navigation'

export default function JoinPage() {
  const searchParams = useSearchParams()
  const appSlug = searchParams.get('app') ?? undefined
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  const next = appSlug ? `/tester/apps/${appSlug}` : '/tester'
  const signupUrl = `${adminUrl}/login?as=tester&next=${encodeURIComponent(next)}`

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <a href="/mushi-mushi/testers/" className="text-lg font-bold">
            <span className="text-violet-400">mushi</span>mushi
            <span className="ml-2 rounded-sm bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-400">
              🪲 Bounties
            </span>
          </a>
          <a
            href={signupUrl}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium hover:bg-violet-500 transition-colors"
          >
            Sign in
          </a>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <p className="text-4xl mb-4">🪲</p>
            <h1 className="text-3xl font-bold mb-2">
              {appSlug ? 'Join to test this app' : 'Become a Mushi tester'}
            </h1>
            <p className="text-gray-400">
              {appSlug
                ? 'Sign up free and start earning points for finding bugs.'
                : 'Find bugs in real apps. Earn points. Redeem for gift cards or Mushi Pro credit.'}
            </p>
          </div>

          {/* Sign-up card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 space-y-6">
            <ul className="space-y-3">
              {[
                { icon: '🐛', text: 'Find bugs in apps from real developers' },
                { icon: '💰', text: 'Earn mushi-points for every accepted report' },
                { icon: '🎁', text: 'Redeem for Amazon, Starbucks, App Store gift cards' },
                { icon: '⚡', text: '1.3× bonus when you convert points to Mushi Pro credit' },
              ].map(({ icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="text-lg leading-none mt-0.5">{icon}</span>
                  <span className="text-sm text-gray-300">{text}</span>
                </li>
              ))}
            </ul>

            <hr className="border-white/10" />

            <div className="space-y-3">
              <a
                href={signupUrl}
                className="block w-full text-center rounded-xl bg-violet-600 px-8 py-3 text-base font-semibold hover:bg-violet-500 transition-colors"
              >
                Create free tester account →
              </a>
              <p className="text-center text-xs text-gray-500">
                No credit card required · Free forever to participate
              </p>
            </div>

            <hr className="border-white/10" />

            <div className="text-center">
              <p className="text-sm text-gray-400">
                Already have an account?{' '}
                <a href={signupUrl} className="text-violet-400 hover:underline">
                  Sign in →
                </a>
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-gray-600 leading-relaxed">
            By creating an account you agree to the{' '}
            <a href="/mushi-mushi/docs/legal/tester-terms" className="hover:text-gray-400 underline underline-offset-2">
              Tester Terms of Service
            </a>{' '}
            and{' '}
            <a href="/mushi-mushi/docs/legal/privacy" className="hover:text-gray-400 underline underline-offset-2">
              Privacy Policy
            </a>
            . Gift card payouts are subject to OFAC compliance and a $599/yr KYC threshold.
            See{' '}
            <a href="/mushi-mushi/testers/how-it-works/" className="hover:text-gray-400 underline underline-offset-2">
              How it works
            </a>{' '}
            for full details.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6 text-center text-sm text-gray-500">
        <p>
          <span className="text-violet-400">mushi</span>mushi Bounties ·{' '}
          <a href="/mushi-mushi/testers/apps/" className="hover:text-gray-300">Browse apps</a> ·{' '}
          <a href="/mushi-mushi/testers/how-it-works/" className="hover:text-gray-300">How it works</a> ·{' '}
          <a href="/mushi-mushi/testers/leaderboard/" className="hover:text-gray-300">Leaderboard</a>
        </p>
      </footer>
    </div>
  )
}
