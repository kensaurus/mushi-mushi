/**
 * /how-it-works — editorial explainer for the Mushi Bounties program.
 * Six sections covering the full loop, bounty math, KYC, anti-fraud, and OFAC.
 */
import type { Metadata } from 'next'
import { TestersPageShell } from '../components/TestersPageShell'

export const metadata: Metadata = {
  title: 'How Mushi Bounties Works',
  description:
    'Learn how to earn mushi-points by finding real bugs, and how to redeem them for Mushi Pro credit or gift cards.',
}

const SECTIONS = [
  {
    icon: '🔄',
    title: 'The loop',
    body: [
      'Developers publish their app or website to the Mushi Bounties marketplace. They set a bounty schedule — how many mushi-points each severity of bug is worth.',
      'You browse the marketplace, join an app, and use it as a real user. When you find something broken, you submit a report with steps to reproduce, expected vs actual behavior, and any screenshots.',
      'The developer reviews your submission in their Mushi console. If it is accepted, your mushi-points balance increases immediately. If the developer marks it as a duplicate or not reproducible, you can see their feedback and improve your next report.',
    ],
  },
  {
    icon: '✅',
    title: 'What counts as an accepted report',
    body: [
      'A report is accepted when the developer confirms they can reproduce the bug and that it was not previously known. Stronger reports include: clear steps to reproduce, a screen recording or annotated screenshot, the device or browser where you saw it, and the expected vs actual behavior.',
      'Enhancement requests and feature ideas are also accepted by some developers at a lower point value.',
      'Spam, duplicate reports, and reports about intentionally broken demo features are rejected. Repeated spam lowers your reputation score, which affects the point value of future accepted reports.',
    ],
  },
  {
    icon: '💰',
    title: 'The bounty math',
    body: [
      '1,000 mushi-points = $10 as a gift card (at 1.0× face value) or $13 as Mushi Pro account credit (at a 1.3× premium).',
      'Point values are set per app by the developer. A critical crash bug might be worth 2,500 points. A minor UI inconsistency might be worth 100. Developers can also award discretionary bonus points for exceptionally clear or high-impact reports.',
      'There is no subscription or fee to participate as a tester. You earn points by contributing, not by paying.',
    ],
  },
  {
    icon: '📋',
    title: 'The $599/year KYC gate',
    body: [
      'To comply with US tax regulations, we are required to collect tax identification information from testers who receive more than $599 in gift cards in a calendar year.',
      'When your cumulative gift card redemptions approach this threshold, you will see a notice on your wallet page asking you to complete a brief KYC form — providing your legal name, jurisdiction, and a tax ID number (W-9 for US persons, W-8BEN for non-US persons).',
      'Until KYC is cleared, additional gift card redemptions above the threshold are held. Mushi Pro credit redemptions are not subject to the KYC gate since they are not taxable income — they are treated as a platform credit.',
      'Your raw TIN is hashed client-side before it is sent to our servers. We do not store or log your unencrypted tax ID.',
    ],
  },
  {
    icon: '🛡️',
    title: 'Anti-fraud and reputation',
    body: [
      'Every tester has a reputation score that starts neutral. Accepted reports improve your score. Rejected reports for spam or dishonest testing lower it.',
      'Your reputation score affects a multiplier on your point awards. Testers with a strong track record of high-signal reports earn a bonus. Testers who send spam or inflate reports face a penalty.',
      'We also enforce velocity caps: submitting more than a certain number of reports per hour or per day flags your account for manual review. This protects developers from being flooded with low-quality reports.',
    ],
  },
  {
    icon: '🌍',
    title: 'OFAC and sanctions compliance',
    body: [
      'Mushi Bounties is not available in jurisdictions subject to US OFAC sanctions, including Cuba, Iran, North Korea, Russia (payment services), Syria, and the Crimea/Donetsk/Luhansk regions.',
      'If your account is associated with a restricted region, gift card and Pro credit redemptions will be declined. You can still browse the marketplace and submit reports, but payouts are blocked.',
      'If you believe your region was incorrectly flagged, contact support with proof of your location. We review appeals within 5 business days.',
    ],
  },
]

export default function HowItWorksPage() {
  return (
    <TestersPageShell>
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-12 text-center">
          <p className="testers-kicker mb-3">Mushi Bounties</p>
          <h1 className="mb-4 text-4xl font-bold">How it works</h1>
          <p className="testers-muted text-lg">
            A complete guide to earning and redeeming mushi-points through the Bounties marketplace.
          </p>
        </div>

        <div className="testers-panel mb-12 grid grid-cols-3 gap-4 p-6">
          <div className="text-center">
            <p className="testers-brand-mark text-2xl font-bold">1,000</p>
            <p className="testers-muted mt-1 text-xs">pts per $10 gift card</p>
          </div>
          <div className="border-x border-[var(--mushi-rule)] text-center">
            <p className="testers-brand-mark text-2xl font-bold">1.3×</p>
            <p className="testers-muted mt-1 text-xs">premium for Mushi Pro credit</p>
          </div>
          <div className="text-center">
            <p className="testers-brand-mark text-2xl font-bold">$599</p>
            <p className="testers-muted mt-1 text-xs">annual gift card cap before KYC</p>
          </div>
        </div>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-2xl">{section.icon}</span>
                <h2 className="text-xl font-semibold">{section.title}</h2>
              </div>
              <div className="space-y-3 pl-9">
                {section.body.map((para, i) => (
                  <p key={i} className="leading-relaxed text-[var(--mushi-ink)]">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="testers-panel mt-12 border-[color-mix(in_oklch,var(--mushi-vermillion)_30%,var(--mushi-rule))] p-8 text-center">
          <h2 className="mb-2 text-xl font-bold">Ready to start?</h2>
          <p className="testers-muted mb-6">
            Create a free tester account and start earning points today.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="/mushi-mushi/testers/join/"
              className="testers-cta px-8 py-3 text-base"
            >
              Create tester account →
            </a>
            <a
              href="/mushi-mushi/testers/apps/"
              className="testers-cta-secondary px-8 py-3 text-base"
            >
              Browse apps first
            </a>
          </div>
        </div>
      </div>
    </TestersPageShell>
  )
}
