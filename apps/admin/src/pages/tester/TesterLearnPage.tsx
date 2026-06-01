/**
 * TesterLearnPage — in-portal rules + documentation surface.
 * Mirrors the 6 sections from the public /how-it-works page plus
 * 2 new authenticated-only sections (code of conduct + anti-fraud penalties).
 * Anchor links (#good-report, #bounty-math, #kyc, #ofac, #conduct, #penalties)
 * match the Home dashboard's Learn corner tiles.
 */
import { TesterLayout } from '../../components/tester/TesterLayout'

interface Section {
  id: string
  icon: string
  title: string
  body: string[]
  cta?: { label: string; href: string }
}

const SECTIONS: Section[] = [
  {
    id: 'the-loop',
    icon: '🔄',
    title: 'The loop',
    body: [
      'Developers publish their app to the Mushi Bounties marketplace and set a bounty schedule — how many mushi-points each severity of bug is worth.',
      'You browse the marketplace, join an app, and use it as a real user. When you find something broken, you submit a report with steps to reproduce, expected vs actual behavior, and any screenshots.',
      'The developer reviews your submission in their Mushi console. If it is accepted, your mushi-points balance increases immediately. If marked as a duplicate or not reproducible, you can see their feedback and improve your next report.',
    ],
    cta: { label: 'Browse apps →', href: '/tester/apps' },
  },
  {
    id: 'good-report',
    icon: '✅',
    title: 'What counts as a good report',
    body: [
      'A report is accepted when the developer confirms they can reproduce the bug and it was not previously known. The strongest reports include:',
      '• Clear numbered steps to reproduce (not "the app crashed randomly").\n• A screen recording or annotated screenshot showing the problem.\n• The device or browser, OS version, and app version where you saw it.\n• Expected behavior vs what actually happened — be precise.\n• Network or console logs if you have them (API errors, 404s, timeouts).',
      'Enhancement requests and feature ideas may also be accepted by some developers at a lower point value.',
      'Spam, duplicates, and reports about intentionally broken demo content will be rejected. Repeated low-quality reports lower your reputation score, which reduces the point value of future accepted reports.',
    ],
    cta: { label: 'Go to apps →', href: '/tester/apps' },
  },
  {
    id: 'bounty-math',
    icon: '💰',
    title: 'The bounty math',
    body: [
      '1,000 mushi-points = $10 as a gift card (1.0× face value) or $13 as Mushi Pro account credit (1.3× premium).',
      'Point values are set per app by the developer. A critical crash bug might be worth 2,500 points. A minor UI inconsistency might be worth 100. Some developers also award discretionary bonus points for exceptionally clear or high-impact reports.',
      'There is no subscription or fee to participate as a tester. You earn points by contributing quality reports, not by paying.',
      'Developers may set daily caps (e.g. max 3 accepted bug reports per day per tester) and lifetime caps per tester per bug category. These are shown in the bounty schedule on each app card.',
    ],
    cta: { label: 'Go to wallet →', href: '/tester/wallet' },
  },
  {
    id: 'kyc',
    icon: '📋',
    title: 'The $599/year KYC gate',
    body: [
      'To comply with US tax regulations, we are required to collect tax identification information from testers who receive more than $599 in gift cards in a calendar year.',
      'When your cumulative gift card redemptions approach $400, you will see a notice on your wallet page asking you to complete a brief KYC form — providing your legal name, jurisdiction, and a tax ID number (W-9 for US persons, W-8BEN for non-US persons).',
      'Until KYC is cleared, additional gift card redemptions above the $400 threshold are held. Mushi Pro credit redemptions are not subject to the KYC gate — they are treated as a platform credit, not taxable income.',
      'Your raw TIN is never stored in plaintext. We HMAC-hash it with a server-side pepper before storage so a database breach cannot expose your tax ID.',
    ],
    cta: { label: 'Update KYC in Settings →', href: '/tester/settings#kyc' },
  },
  {
    id: 'ofac',
    icon: '🌍',
    title: 'OFAC and sanctions compliance',
    body: [
      'Mushi Bounties is not available in jurisdictions subject to US OFAC sanctions, including Cuba, Iran, North Korea, Russia (payment services), Syria, and the Crimea/Donetsk/Luhansk regions.',
      'If your account is associated with a restricted region, gift card and Pro credit redemptions will be declined. You can still browse the marketplace and submit reports, but payouts are blocked.',
      'If you believe your region was incorrectly flagged, contact support with proof of your location. We review appeals within 5 business days.',
    ],
    cta: { label: 'Update country in Settings →', href: '/tester/settings' },
  },
  {
    id: 'anti-fraud',
    icon: '🛡️',
    title: 'Anti-fraud and reputation',
    body: [
      'Every tester has a reputation score that starts neutral. Accepted reports improve your score. Spam or dishonest testing lowers it.',
      'Your reputation score feeds a multiplier on your point awards. Testers with a strong track record of high-signal reports earn a bonus. Testers who send spam or inflate reports face a penalty.',
      'We also enforce velocity caps: submitting more than 20 reports per day or 5 per app per day flags your account for manual review. Reports above the cap are withheld pending review — not deleted.',
    ],
  },
  {
    id: 'conduct',
    icon: '📜',
    title: 'Tester code of conduct',
    body: [
      'By participating in Mushi Bounties you agree to test in good faith. The following are not acceptable:',
      '• Automated fuzzing, scripted scanning, or any form of active probing without the developer\'s explicit written consent.\n• Submitting reports about content the developer has marked "intentionally broken" or "demo placeholder".\n• Sharing your tester account with other people. One account per real human — multiple accounts by the same person will be banned.\n• Submitting the same report across multiple apps when the bug is app-specific.\n• Threatening or harassing developers over review decisions.',
      'We expect reports to be professional, factual, and constructive. Developers are real people building real products. Help them improve — do not exploit them.',
      'If you believe a developer is acting in bad faith (refusing to pay for clearly valid reports, repeatedly marking duplicates that are not duplicates), use the "Send feedback" button in Settings to escalate to the Mushi team.',
    ],
    cta: { label: 'Send feedback to Mushi →', href: '/tester/settings#feedback' },
  },
  {
    id: 'penalties',
    icon: '⚠️',
    title: 'Anti-fraud penalties',
    body: [
      'We maintain a transparent penalty schedule so testers know exactly what the consequences are for misconduct:',
      '• Single spam submission: −10 reputation points.\n• 3 spam submissions within 7 days: 30-day submission cooldown on the affected app.\n• Velocity cap exceeded (>20/day global or >5/day per app): points withheld pending admin review for 48h. If reviewed and found genuine, points are released. If found to be bulk low-quality submissions, points are forfeited and −5 reputation per submission above cap.\n• Account sharing detected: permanent ban with no payout of pending points.\n• Automated probing without consent: permanent ban, report forwarded to the app developer.\n• OFAC violation: redemptions blocked, account frozen pending legal review.',
      'Penalties are applied by the automated anti-gaming system first. You can appeal any automated decision by contacting support within 14 days.',
    ],
    cta: { label: 'Contact support →', href: '/tester/settings#feedback' },
  },
]

function SectionBlock({ section }: { section: Section }) {
  return (
    <div id={section.id} className="scroll-mt-16">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{section.icon}</span>
        <h2 className="text-lg font-semibold">{section.title}</h2>
      </div>
      <div className="space-y-3 pl-9">
        {section.body.map((para, i) => (
          <p key={i} className="text-sm text-fg-secondary leading-relaxed whitespace-pre-line">{para}</p>
        ))}
        {section.cta && (
          <div className="pt-1">
            <a href={section.cta.href} className="text-sm text-accent hover:underline">
              {section.cta.label}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

export function TesterLearnPage() {
  return (
    <TesterLayout title="Learn">
      <div className="max-w-2xl mx-auto space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">How Mushi Bounties works</h1>
          <p className="text-sm text-fg-muted mt-2">
            Everything you need to know — from writing your first report to redeeming your first gift card.
          </p>
        </div>

        {/* Quick reference strip */}
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-center">
            <p className="text-xl font-bold text-accent">1,000</p>
            <p className="text-xs text-fg-muted mt-0.5">pts per $10 gift card</p>
          </div>
          <div className="text-center border-x border-white/10">
            <p className="text-xl font-bold text-accent">1.3×</p>
            <p className="text-xs text-fg-muted mt-0.5">premium for Mushi Pro</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-accent">$599</p>
            <p className="text-xs text-fg-muted mt-0.5">annual cap before KYC</p>
          </div>
        </div>

        {/* Quick nav */}
        <nav className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-medium text-fg-muted mb-2 uppercase tracking-wide">In this guide</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} className="text-sm text-accent hover:underline">
                {s.icon} {s.title}
              </a>
            ))}
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map(s => <SectionBlock key={s.id} section={s} />)}
        </div>

        {/* Bottom CTA */}
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
          <h2 className="text-base font-bold mb-1">Ready to earn your first points?</h2>
          <p className="text-sm text-fg-muted mb-4">Browse available apps and join a test program.</p>
          <a
            href="/tester/apps"
            className="inline-block rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold hover:bg-accent-hover transition-colors"
          >
            Browse apps →
          </a>
        </div>

      </div>
    </TesterLayout>
  )
}
