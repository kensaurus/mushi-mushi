'use client'

import { useMarketing } from './context'
import { reportSample } from './canvas/data'

export function Hero() {
  const { Link, urls } = useMarketing()

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-6 py-8 shadow-[0_24px_80px_-48px_rgba(14,13,11,0.45)] sm:px-10 sm:py-10 lg:px-14">
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_18%_12%,var(--mushi-vermillion-wash),transparent_32%),radial-gradient(circle_at_84%_18%,rgba(14,13,11,0.05),transparent_34%)]" />
      <div className="relative grid gap-6 lg:grid-cols-[1.1fr_0.95fr] lg:items-center lg:gap-8">
        <div className="max-w-4xl">
          {/* Editorial brand kicker. Demoted from vermillion → ink-muted because
              the page already uses vermillion in three high-rank places below
              (the H1 accent word, the primary CTA, and the live report card).
              A red kicker over a red headline word is brand-color competition
              (enhance-page-ui H4) — every red-tinted thing claims primacy and
              the actual primary CTA loses scent. The serif "虫々" carries
              brand identity here; colour is not needed. */}
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]">
            <span className="text-[var(--mushi-ink)]">Mushi</span>
            <span className="mx-2 opacity-40">/</span>
            <span lang="ja" className="text-[var(--mushi-ink)]">虫々</span>
            <span className="mx-2 opacity-40">/</span>
            little bug helper
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-5xl font-semibold leading-[0.95] tracking-[-0.06em] text-[var(--mushi-ink)] sm:text-6xl lg:text-7xl">
            Bugs your users feel,
            <br className="hidden sm:block" />
            <span className="text-[var(--mushi-vermillion)]">walked into a fix.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--mushi-ink-muted)] sm:text-lg sm:leading-7">
            One SDK, one report, one repair loop. Mushi turns user-felt friction
            into a triaged, drafted, judged, and remembered fix &mdash; without
            inventing a new ticket ritual.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={urls.signup}
              className="rounded-sm bg-[var(--mushi-vermillion)] px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5"
            >
              Start free, no card
            </Link>
            {/* Secondary CTA needs enough chrome to read as a real button on
                the warm paper background. The previous bg-white/25 dropped into
                the paper wash and looked like ghost text. Paper-wash + ink
                border gives it a calm but visible affordance without competing
                with the solid vermillion primary. */}
            <Link
              href={urls.loopAnchor}
              className="inline-flex items-center gap-2 rounded-sm border border-[color-mix(in_oklch,var(--mushi-ink)_22%,var(--mushi-rule))] bg-[color-mix(in_oklch,var(--mushi-paper)_82%,white)] px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink)] transition hover:-translate-y-0.5 hover:border-[var(--mushi-ink)] hover:bg-[color-mix(in_oklch,var(--mushi-paper)_70%,white)]"
            >
              Watch the loop
              <span aria-hidden="true" className="transition-transform group-hover:translate-y-0.5">↓</span>
            </Link>
          </div>
          {/* Trust facts. Bullet glyph swapped from vermillion dots → ink hairline
              dividers ("／"). Dots were decoration, not status, so paying brand
              spend on them was wasted ink. The hairline preserves rhythm without
              adding three more red surfaces to fold 1. */}
          <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mushi-ink-muted)]">
            <li>1,000 reports / mo free</li>
            <li aria-hidden="true" className="text-[var(--mushi-ink-faint)] opacity-50">／</li>
            <li>8 SDKs, web to native</li>
            <li aria-hidden="true" className="text-[var(--mushi-ink-faint)] opacity-50">／</li>
            <li>MIT-licensed</li>
          </ul>
        </div>

        <ReportPreview />
      </div>
    </section>
  )
}

function ReportPreview() {
  return (
    <aside
      aria-label="Preview of a Mushi report"
      className="relative overflow-hidden rounded-2xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] p-5 shadow-[0_22px_60px_-40px_rgba(14,13,11,0.55)]"
    >
      {/* Top vermillion stripe REMOVED. The card already has its own elevation
          (border + shadow) on a paper-tinted hero card, and the severity/judge
          pills below carry the semantic colour. The stripe was decoration, and
          decoration in the brand colour competes with the H1 accent word for
          the eye's first stop (enhance-page-ui H4). */}

      <header className="flex items-center justify-between gap-3">
        {/* "live · /reports" demoted from full-vermillion mono caps to neutral
            ink-muted; only the pulsing dot keeps the brand colour because it
            *carries* the live-status meaning (a real semantic accent, not a
            decorative one). */}
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-vermillion)]" />
          <span className="text-[var(--mushi-ink)]">live</span>
          <span className="opacity-40">·</span>
          /reports
        </span>
        <span className="rounded-sm border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink)]">
          {reportSample.prNumber}
        </span>
      </header>

      <h2 className="mt-3 font-serif text-[1.6rem] leading-[1.12] tracking-[-0.03em] text-[var(--mushi-ink)]">
        {reportSample.title}
      </h2>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mushi-ink-muted)]">
        {reportSample.path}
        <span className="mx-2 opacity-40">·</span>
        {reportSample.browser}
      </p>

      {/* Blockquote softened: the previous treatment used the brand wash as
          background AND the brand accent as the left rail, AND brand colour
          dominates the whole hero — three vermillion surfaces stacked on the
          one quotation block. Switched to an ink left rail + paper-wash bg so
          the quote reads as a recess, not a third red panel. The italic serif
          carries the "user voice" tone already; colour was redundant. */}
      <blockquote className="mt-3 rounded-md border-l-[3px] border-[color-mix(in_oklch,var(--mushi-ink)_30%,var(--mushi-rule))] bg-[color-mix(in_oklch,var(--mushi-paper)_82%,white)] py-2.5 pl-3 pr-3 font-serif text-[13.5px] italic leading-[1.55] text-[var(--mushi-ink)]">
        &ldquo;{reportSample.userNote}&rdquo;
      </blockquote>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--mushi-rule)] pt-3">
        <DataPill label="Severity" value={reportSample.severity} tone="alert" />
        <DataPill label="Class" value={reportSample.taxonomy} tone="ink" />
        <DataPill label="Judge" value={reportSample.judgeScore} tone="pass" suffix="/ 1.00" />
      </dl>
    </aside>
  )
}

type PillTone = 'alert' | 'ink' | 'pass'

const PILL_TONES: Record<PillTone, { bg: string; fg: string; dot: string; border: string }> = {
  alert: { bg: 'var(--mushi-vermillion)', fg: '#ffffff', dot: '#ffffff', border: 'var(--mushi-vermillion)' },
  ink: { bg: 'var(--mushi-ink)', fg: 'var(--mushi-paper)', dot: 'var(--mushi-vermillion)', border: 'var(--mushi-ink)' },
  pass: { bg: '#10b981', fg: '#ffffff', dot: '#ffffff', border: '#059669' },
}

function DataPill({ label, value, tone, suffix }: { label: string; value: string; tone: PillTone; suffix?: string }) {
  const colors = PILL_TONES[tone]
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
        {label}
      </dt>
      {/* Value pill: dropped the `truncate` clamp because a "Class" pill
          previously rendered as "UX REGRESSI…" — silent loss of meaning on the
          hero card that's literally previewing the product (see
          enhance-page-ui H6: column allocation). Width comes from the parent
          grid (3 equal cells); we now let the long mid-pill ride two lines
          rather than ellipsis its own label. The shrunken type at 11px keeps
          the wrap rare while preserving readability when it does happen. */}
      <dd
        className="mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]"
        style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'alert' ? 'animate-pulse' : ''}`}
          style={{ background: colors.dot }}
        />
        <span className="min-w-0 break-words">{value}</span>
        {suffix && (
          <span className="ml-auto shrink-0 whitespace-nowrap opacity-70" style={{ fontSize: '0.78em' }}>
            {suffix}
          </span>
        )}
      </dd>
    </div>
  )
}
