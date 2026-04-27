'use client'

import dynamic from 'next/dynamic'
import { stages } from './data'

// Static stage strip used both as the lazy-load skeleton AND as the no-JS /
// reduced-motion fallback. The interactive React Flow scene replaces it once
// it hydrates.
function StaticStageStrip() {
  return (
    <div
      className="rounded-[2rem] border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-6 sm:p-8"
      aria-label="Mushi loop overview"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--mushi-vermillion)]">
        Mushi loop / 5 stages
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
          <li
            key={stage.id}
            className="rounded-lg border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] p-3 shadow-[inset_0_-3px_0_var(--mushi-vermillion)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              {String(stage.index + 1).padStart(2, '0')} · {stage.id}
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

const MushiCanvasScene = dynamic(
  () => import('./MushiCanvasClient').then((mod) => mod.MushiCanvasClient),
  {
    ssr: false,
    loading: () => <StaticStageStrip />,
  },
)

export function MushiCanvas() {
  return (
    <section id="loop" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--mushi-rule)] pt-5">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--mushi-vermillion)]">
            Chapter 02 / the loop
          </p>
          <h2 className="mt-1.5 font-serif text-3xl font-semibold leading-[1.02] tracking-[-0.035em] text-[var(--mushi-ink)] sm:text-[2.6rem]">
            Watch one report walk five steps.
          </h2>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
          Click any card to inspect →
        </p>
      </header>
      <MushiCanvasScene />
    </section>
  )
}
