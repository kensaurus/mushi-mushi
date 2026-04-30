/**
 * FILE: apps/admin/src/components/EditorialErrorState.tsx
 * PURPOSE: Brand-aligned fallback UI used by every "page is not available"
 *          surface in the admin SPA — the unknown-route 404, the
 *          top-level ErrorBoundary, and any feature-level boundary that
 *          wants the same calm-but-honest treatment.
 *
 * WHY ONE COMPONENT
 * -----------------
 * Before this lived in two places (a tiny `NotFoundPage` in App.tsx, and
 * an inline Card inside ErrorBoundary). The two diverged on copy, on
 * spacing, and on whether the visitor saw any wayfinding back to safe
 * ground. Centralising forces one editorial voice: mono caps eyebrow,
 * display H1 with one vermillion-accented word, hairline rule, lead, two
 * CTAs (primary back-to-home, secondary back-to-docs).
 *
 * DESIGN NOTES
 * ------------
 * - The component is *self-contained*: it does NOT depend on the admin
 *   Layout chrome being mounted (so it renders cleanly when the app
 *   itself crashes during boot or when an unauthenticated visitor hits
 *   an unknown public route). It uses brand tokens via inline classes,
 *   not Layout-scoped CSS variables.
 * - The two CTAs are deliberate. NN/g visibility-of-system-status: the
 *   visitor needs an obvious way back, but a single button forces a
 *   choice that may not match their intent. Two affordances let them
 *   pick: "Go home" (primary, the safest action) vs. "Open docs"
 *   (secondary, for the technical visitor who hit a moved route and
 *   wants to look it up).
 */

import type { ReactNode } from 'react'

interface EditorialErrorStateProps {
  /** Mono caps eyebrow displayed above the headline (e.g. "404 · 虫々"). */
  eyebrow: string
  /**
   * Headline. The component renders any embedded `<em>` in the
   * vermillion accent so callers can lean on the brand's "one focal
   * vermillion word per editorial unit" pattern (see Hero.tsx).
   */
  headline: ReactNode
  /** Lead copy. Plain text or React for inline `<code>` etc. */
  lead: ReactNode
  /** Optional structured detail (e.g. the path the user typed). */
  detail?: ReactNode
  /**
   * Primary action — defaults to home. Pass `{ to: '/dashboard',
   * label: 'Back to Dashboard' }` for authenticated contexts.
   */
  primary: ActionProps
  /**
   * Secondary action — defaults to opening docs. Optional; pass `null`
   * for boundaries that should only show the primary recovery path.
   */
  secondary?: ActionProps | null
}

interface ActionProps {
  /** Link target. Same-origin paths render through `<a>` (the boundary
   * does not depend on react-router being mounted, since this component
   * has to work when the app itself crashed). */
  href: string
  label: string
  /** When true, opens in a new tab with safe `rel`. Use for outbound
   * docs / repo links so the visitor's recovery context is preserved. */
  external?: boolean
}

function Action({ href, label, external, kind }: ActionProps & { kind: 'primary' | 'secondary' }) {
  const base =
    'inline-flex items-center gap-2 rounded-md px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] transition motion-safe:hover:-translate-y-0.5'
  const tone =
    kind === 'primary'
      ? 'bg-[var(--mushi-ink)] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]'
      : 'border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_82%,white)] text-[var(--mushi-ink)] hover:border-[var(--mushi-ink)] hover:bg-[color-mix(in_oklch,var(--mushi-paper)_70%,white)]'
  return (
    <a
      href={href}
      className={`${base} ${tone}`}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {label}
    </a>
  )
}

export function EditorialErrorState({
  eyebrow,
  headline,
  lead,
  detail,
  primary,
  secondary,
}: EditorialErrorStateProps) {
  return (
    <main className="mushi-marketing-surface grid min-h-[70vh] place-items-center px-6 py-16">
      <article className="mx-auto w-full max-w-[38rem]">
        <p
          aria-hidden="true"
          className="mb-5 inline-flex items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--mushi-vermillion)]" />
          {eyebrow}
        </p>
        <h1 className="font-serif text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--mushi-ink)] [&_em]:not-italic [&_em]:font-bold [&_em]:text-[var(--mushi-vermillion)]">
          {headline}
        </h1>
        <div
          aria-hidden="true"
          className="my-6 h-px"
          style={{
            background:
              'linear-gradient(90deg, var(--mushi-vermillion) 0, var(--mushi-vermillion) 3rem, var(--mushi-rule) 3rem)',
          }}
        />
        <p className="max-w-[54ch] text-[1.0625rem] leading-relaxed text-[var(--mushi-ink-muted)]">
          {lead}
        </p>
        {detail ? (
          <div className="mt-3 font-mono text-xs text-[var(--mushi-ink-muted)]">
            {detail}
          </div>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Action {...primary} kind="primary" />
          {secondary ? <Action {...secondary} kind="secondary" /> : null}
        </div>
      </article>
    </main>
  )
}
