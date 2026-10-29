/**
 * Landing "Who it's for" strip: the three groups from /who-its-for, one pain
 * each, linking to their section. Added on the owner's instruction of
 * 2026-10-29 (ADR 0052 amendment); the hero's install box stays the one
 * primary action.
 */
import Link from 'next/link'

const GROUPS = [
  {
    id: 'you-build-apps-with-ai-mostly-on-your-own',
    who: 'You build apps with AI, mostly on your own',
    pain: 'A user says it’s broken, and you didn’t write the code by hand.',
  },
  {
    id: 'youre-a-developer-and-you-own-your-code',
    who: 'You’re a developer and you own your code',
    pain: 'Triage eats your mornings, and agent PRs need a careful read.',
  },
  {
    id: 'you-run-a-team-or-a-company',
    who: 'You run a team or a company',
    pain: 'Bug reports are scattered across Slack, support, reviews and Sentry.',
  },
] as const

export function LandingAudience() {
  return (
    <section className="landing-pricing not-prose" aria-labelledby="landing-audience-heading">
      <h2 id="landing-audience-heading" className="landing-section-title">
        Who it’s for
      </h2>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <li key={g.id} className="landing-diagnosis-card">
            <span className="landing-diagnosis-name">{g.who}</span>
            <span className="landing-diagnosis-role">{g.pain}</span>
            <Link href={`/who-its-for#${g.id}`} className="text-sm font-medium text-mushi-vermillion hover:underline">
              What it does for you →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
