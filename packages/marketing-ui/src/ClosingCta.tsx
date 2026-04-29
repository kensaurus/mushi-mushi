'use client'

import { useMarketing } from './context'

export function ClosingCta() {
  const { Link, urls } = useMarketing()

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[var(--mushi-rule)] bg-[var(--mushi-vermillion-wash)] p-6 text-center sm:p-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_50%_-20%,var(--mushi-vermillion-wash),transparent_55%),radial-gradient(circle_at_10%_120%,rgba(14,13,11,0.06),transparent_45%)]"
      />
      <div className="relative">
        {/* Eyebrow leans on the Japanese kana for brand voice; the colour was
            decoration on top of an already vermillion-washed card. The pause
            mark "?" stays vermillion as a tiny editorial accent — one mark,
            not a whole line. */}
        <p
          className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]"
          lang="ja"
        >
          <span className="text-[var(--mushi-ink)]">むしむし</span>
          <span className="text-[var(--mushi-vermillion)]">?</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span className="text-[var(--mushi-ink)]">むしむし</span>
          <span className="text-[var(--mushi-vermillion)]">。</span>
        </p>
        <h2 className="mx-auto mt-2 max-w-2xl font-serif text-3xl leading-[1] tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-4xl">
          Your repair loop is now boarding.
        </h2>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href={urls.signup}
            className="inline-block rounded-sm bg-[var(--mushi-vermillion)] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5"
          >
            Deploy Mushi
          </Link>
          <Link
            href={urls.repo()}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-sm border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--mushi-ink)] transition hover:border-[var(--mushi-vermillion)]"
          >
            Read the source
          </Link>
        </div>
      </div>
    </section>
  )
}
