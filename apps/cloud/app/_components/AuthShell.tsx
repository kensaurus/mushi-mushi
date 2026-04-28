import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared editorial-brand layout for the auth surface.
 *
 * Why a shell rather than per-page CSS?
 *   - /signup, /login, /signup/check-email and /dashboard previously each
 *     re-defined their own dark indigo/neutral-700 styles, drifting both
 *     from each other and from the marketing landing's washi/sumi
 *     editorial palette. This component is the single source of truth
 *     for the auth-surface chrome (header, paper sheet, footer rule)
 *     so future pages match by composition, not by copy-paste.
 *
 * Composition:
 *   - The outer `main` paints the same vermillion-wash radial background
 *     as the landing (`globals.css`); we don't need a second background here.
 *   - `<AuthShell.Header>` shows the `Mushi Mushi` wordmark as a "go home"
 *     affordance and a `chapter` slug overline (e.g. "Chapter 04 / sign in")
 *     so the page reads as part of the same editorial issue.
 *   - The body renders inside a paper sheet that *just* lifts above the
 *     background — same surface tint as marketing pricing cards.
 */
export function AuthShell({
  chapter,
  title,
  subtitle,
  children,
  footer,
}: {
  /** Mono overline above the title, e.g. "Chapter 04 / sign in". */
  chapter: string
  /** Display-serif title — keep it short so it doesn't wrap on mobile. */
  title: string
  /** Single paragraph of supporting copy directly under the title. */
  subtitle?: ReactNode
  /** Form, content, status — anything that lives inside the paper sheet. */
  children: ReactNode
  /** Optional muted footer line for cross-links (e.g. "Already have an account?"). */
  footer?: ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-12 pt-6">
      <header className="flex items-center justify-between rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
        <Link
          href="/"
          className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
          >
            虫
          </span>
          <span>Mushi Mushi</span>
        </Link>
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
        >
          ← Back home
        </Link>
      </header>

      <section className="mx-auto mt-12 w-full max-w-md sm:mt-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-vermillion)]">
          {chapter}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-5xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-prose text-sm leading-6 text-[var(--mushi-ink-muted)] sm:text-base sm:leading-7">
            {subtitle}
          </p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 shadow-[0_30px_60px_-48px_rgba(14,13,11,0.45)] sm:p-8">
          {children}
        </div>

        {footer ? (
          <p className="mt-6 text-center text-sm text-[var(--mushi-ink-muted)]">{footer}</p>
        ) : null}
      </section>
    </main>
  )
}

/**
 * Paper-form input. Vermillion focus ring + ledger-mono label sits above
 * each field. We expose the wrapper rather than the bare input so the label
 * + input pair is one composable primitive across the auth pages.
 */
export function AuthField({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <p className="mt-1 text-[11px] leading-5 text-[var(--mushi-ink-muted)]">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Editorial input style — exported as a string so we can attach it to
 * `<input>` elements directly, keeping server-action forms simple. The
 * border picks up vermillion on focus to match the marketing CTA hover.
 */
export const authInputClass =
  'w-full rounded-md border border-[var(--mushi-rule)] bg-white/70 px-3 py-2.5 font-body text-[15px] text-[var(--mushi-ink)] placeholder:text-[var(--mushi-ink-faint)] outline-none transition focus:border-[var(--mushi-vermillion)] focus:bg-white focus:shadow-[0_0_0_3px_var(--mushi-vermillion-wash)]'

/**
 * Primary editorial submit button — black sumi pill with white ink,
 * vermillion-tinted hover, mono small-caps label. Mirrors the
 * "Get started" pill in the marketing header so users feel they
 * walked through the same door.
 */
export const authPrimaryBtnClass =
  'w-full rounded-full bg-[var(--mushi-ink)] px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))] disabled:opacity-50'

/**
 * Secondary outline button (for back / cancel / non-primary CTAs).
 */
export const authGhostBtnClass =
  'inline-flex items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-white/40 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mushi-ink)] transition hover:border-[var(--mushi-vermillion)] hover:text-[var(--mushi-vermillion)]'

/**
 * Editorial error banner. Vermillion-tinted to match brand instead of
 * the previous red-500/40 — consistent feedback surface across pages.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--mushi-vermillion)]/40 bg-[var(--mushi-vermillion-wash)] px-3 py-2 text-sm leading-6 text-[var(--mushi-vermillion-ink)]"
    >
      {children}
    </p>
  )
}
