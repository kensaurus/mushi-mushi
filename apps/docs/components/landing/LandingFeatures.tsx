/**
 * Landing "More than bug reports": three checks from /what-it-does that a
 * non-coder cares about, as icon, name, the pain each answers and a plain tag
 * saying what it needs. Text, icons and tags come from FeatureTour's FEATURES
 * and NEED_LABELS, so the landing and the page cannot disagree. None of these
 * is promised as free: per ADR 0056 the landing promises as free only what a
 * new project gets with no keys (the report button, the diagnosis and the
 * one-time check in the hero).
 */
import Link from 'next/link'
import { FEATURES, NEED_LABELS } from '../FeatureTour'

/** One of each kind of need: an account to connect, a paid key, your computer. */
/** @internal Exported for tests. */
export const LANDING_FEATURE_IDS = ['vulnerabilities', 'site-watch', 'first-user-test'] as const

export function LandingFeatures() {
  const shown = LANDING_FEATURE_IDS.map((id) => FEATURES.find((f) => f.id === id)).filter(
    (f): f is (typeof FEATURES)[number] => f !== undefined,
  )
  return (
    <section className="landing-pricing not-prose" aria-labelledby="landing-features-heading">
      <h2 id="landing-features-heading" className="landing-section-title">
        More than bug reports
      </h2>
      <p className="landing-section-lead">
        Most people who hit a bug just leave. These checks look for bugs before anyone reports them. Turn them on when
        you want them; each one says what it needs.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
        {shown.map((f) => (
          <li key={f.id}>
            <Link href={`/what-it-does#${f.id}`} className="landing-diagnosis-card no-underline hover:border-mushi-vermillion">
              <span className="landing-diagnosis-glyph">{f.icon}</span>
              <span className="landing-diagnosis-name">{f.name}</span>
              <span className="landing-diagnosis-role">{f.pain}</span>
              <span className="text-xs text-mushi-ink-muted">
                <span className="inline-block rounded-full border border-current px-2 py-0.5 font-medium">
                  {NEED_LABELS[f.kind]}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link href="/what-it-does" className="font-medium text-mushi-vermillion hover:underline">
          Everything else it does, and what each needs →
        </Link>
      </p>
    </section>
  )
}
