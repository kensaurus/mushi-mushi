/**
 * Landing "More than bug reports" grid: six of the checks from /what-it-does,
 * as icon, name and the pain each answers. Text and icons come from
 * FeatureTour's FEATURES so the landing and the page cannot disagree. Added on
 * the owner's instruction of 2026-10-29 (ADR 0052 amendment).
 */
import Link from 'next/link'
import { FEATURES } from '../FeatureTour'

const SHOWN = ['first-user-test', 'ai-review', 'site-watch', 'vulnerabilities', 'ci-cost', 'skill-runs'] as const

export function LandingFeatures() {
  const shown = SHOWN.map((id) => FEATURES.find((f) => f.id === id)).filter((f): f is (typeof FEATURES)[number] => f !== undefined)
  return (
    <section className="landing-pricing not-prose" aria-labelledby="landing-features-heading">
      <h2 id="landing-features-heading" className="landing-section-title">
        More than bug reports
      </h2>
      <p className="landing-section-lead">
        Most people who hit a bug just leave. These checks find bugs before anyone reports them, and keep the AI’s fixes
        honest.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((f) => (
          <li key={f.id}>
            <Link href={`/what-it-does#${f.id}`} className="landing-diagnosis-card no-underline hover:border-mushi-vermillion">
              <span className="landing-diagnosis-glyph">{f.icon}</span>
              <span className="landing-diagnosis-name">{f.name}</span>
              <span className="landing-diagnosis-role">{f.pain}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link href="/what-it-does" className="font-medium text-mushi-vermillion hover:underline">
          Everything else it does →
        </Link>
      </p>
    </section>
  )
}
