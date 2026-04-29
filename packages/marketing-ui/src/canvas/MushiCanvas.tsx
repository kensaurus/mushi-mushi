'use client'

import { lazy, Suspense } from 'react'
import { stages } from './data'

/**
 * Static stage strip — both the loading skeleton AND the no-JS / reduced-
 * motion fallback. The interactive React Flow scene replaces it after hydration.
 *
 * IMPL NOTE: the cloud app used `next/dynamic({ ssr: false, loading })` to ship
 * this server-rendered while the heavy ReactFlow bundle loaded client-side.
 * The shared package can't depend on Next, so we use React.lazy + Suspense,
 * which behaves identically in apps/cloud (Next handles RSC + hydration) and
 * apps/admin (Vite SPA, never SSR'd in the first place). The viewport import
 * must stay in a dynamic factory to keep ReactFlow + framer-motion out of the
 * first-paint bundle.
 */
function StaticStageStrip() {
  return (
    <div
      className="rounded-[2rem] border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 sm:p-8"
      aria-label="Mushi loop overview"
    >
      {/* Eyebrow tone: ink-muted instead of vermillion. The accent here was
          chrome decoration, and the page already burns its single-accent
          budget on the H1 word and the primary CTA. Numeric "5 stages" is
          enough — readers find the section by typography rank. */}
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--mushi-ink-muted)]">
        Mushi loop <span className="opacity-40">/</span> 5 stages
      </p>
      <h2 className="mt-3 max-w-2xl font-serif text-3xl leading-[0.98] tracking-[-0.04em] text-[var(--mushi-ink)] sm:text-4xl">
        A bug report with a tiny pair of boots.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--mushi-ink-muted)]">
        Follow one user complaint as it walks from capture to a reviewed fix,
        then becomes memory for the next release.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map((stage) => (
          // Static-fallback tile: index gets the brand colour (it carries the
          // "this is stage N of the loop" semantics), but the bottom inset
          // rail drops to a 2 px ink hairline so five tiles in a row no longer
          // form a five-bar red ladder. The vermillion-on-stage-1-only marker
          // matches what the interactive viewport does (single accent zone).
          <li
            key={stage.id}
            className="rounded-lg border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] p-3 shadow-[inset_0_-2px_0_var(--mushi-rule)] transition hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--mushi-ink)_22%,var(--mushi-rule))]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
              <span className="text-[var(--mushi-vermillion)]">{String(stage.index + 1).padStart(2, '0')}</span>
              <span className="mx-1 opacity-40">·</span>
              {stage.id}
            </span>
            <p className="mt-2 font-serif text-base leading-tight tracking-[-0.02em] text-[var(--mushi-ink)]">
              {stage.title}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

const MushiCanvasViewport = lazy(() =>
  import('./MushiCanvasViewport').then((mod) => ({ default: mod.MushiCanvasViewport })),
)

export function MushiCanvas() {
  return (
    <section id="loop" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--mushi-rule)] pt-5">
        <div className="max-w-2xl">
          {/* Section eyebrow demoted to ink-muted. The "02" earns the brand
              colour because it's a visual landmark for the chapter rhythm
              (chapter 01 was the hero); the rest of the kicker is calm. */}
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]">
            <span className="text-[var(--mushi-vermillion)]">Chapter 02</span>
            <span className="mx-2 opacity-40">/</span>
            the loop
          </p>
          <h2 className="mt-1.5 font-serif text-3xl font-semibold leading-[1.02] tracking-[-0.035em] text-[var(--mushi-ink)] sm:text-[2.6rem]">
            Watch one report walk five steps.
          </h2>
        </div>
        {/* "Click any card to inspect →" lives ONLY here now. The previous
            duplicate hint inside the canvas viewport (bottom-left) said the
            same thing in the same fold (enhance-page-ui H14: information
            duplication per fold), so we removed that one and kept this one
            because the section header is where a reader's scan lands first. */}
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
          Click any card to inspect <span aria-hidden="true">→</span>
        </p>
      </header>
      <Suspense fallback={<StaticStageStrip />}>
        <MushiCanvasViewport />
      </Suspense>
    </section>
  )
}
