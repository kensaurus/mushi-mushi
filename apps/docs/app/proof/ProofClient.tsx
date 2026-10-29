'use client'

/**
 * Client half of /proof. Aggregates only: no app names, report text or user
 * data reach the browser (the API whitelists its keys). If the API is down the
 * page says so; it never shows zeros it did not count.
 */

import { useEffect, useState } from 'react'
import { CHECK_PAGE_URL } from '@/lib/production-check'
import {
  formatAsOf,
  formatCount,
  formatHours,
  loadScoreboard,
  sparklinePath,
  sparklinePoints,
  type Scoreboard,
} from '@/lib/scoreboard'

const SPARK_W = 320
const SPARK_H = 56

export function ProofClient() {
  const [board, setBoard] = useState<Scoreboard | null | 'loading'>('loading')

  useEffect(() => {
    let live = true
    loadScoreboard().then((b) => {
      if (live) setBoard(b)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-mushi-paper">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-mushi-vermillion">Mushi runs on Mushi</p>
          <h1 className="text-3xl font-bold tracking-tight text-mushi-ink sm:text-4xl">What Mushi did on my own apps</h1>
          <p className="text-base text-mushi-ink-muted">
            I build and run {board && board !== 'loading' ? board.apps : 'several'} apps of my own, and every one of them runs
            Mushi. These numbers are counted live from Mushi’s database for those apps only. They are not customer numbers:
            only totals leave the database, never app names, report text or anything about the people who reported.
          </p>
          <p className="text-base text-mushi-ink-muted">
            So far most of the bugs Mushi fixed were found by my own checks, not reported by people using the apps. The
            numbers below keep the two apart.
          </p>
        </header>

        {board === 'loading' && <p className="text-sm text-mushi-ink-muted">Counting…</p>}
        {board === null && (
          <p className="text-sm text-mushi-ink-muted">The numbers are not available right now. Try again in a few minutes.</p>
        )}
        {board && board !== 'loading' && <Board board={board} />}

        <section className="space-y-2 rounded-md border border-mushi-rule p-5">
          <h2 className="text-lg font-semibold text-mushi-ink">See what your own app shows a first visitor</h2>
          <p className="text-sm text-mushi-ink-muted">The free Production Check reads your live pages and lists what to fix, in plain English.</p>
          <a
            href={`${CHECK_PAGE_URL}?src=proof`}
            data-mushi-cta="proof_check"
            data-mushi-location="proof"
            className="inline-block text-sm font-medium text-mushi-vermillion hover:underline"
          >
            Run the free check →
          </a>
        </section>
      </div>
    </div>
  )
}

function Board({ board }: { board: Scoreboard }) {
  const weeks = board.weeklyMerged
  const points = sparklinePoints(
    weeks.map((w) => w.merged),
    SPARK_W,
    SPARK_H,
  )
  return (
    <div className="docs-open not-prose space-y-6">
      <p className="docs-open__stamp">
        Last {board.days} days, as of {formatAsOf(board.asOf)}. Refreshed every 15 minutes.
      </p>
      <dl className="docs-open__grid">
        <div>
          <dt>Bug reports from people using the apps</dt>
          <dd>
            {formatCount(board.userReports)}{' '}
            <span className="text-sm font-normal text-mushi-ink-muted">from {formatCount(board.reporters)} devices, my own testing included</span>
          </dd>
        </div>
        <div>
          <dt>Bugs found by my own checks</dt>
          <dd>
            {formatCount(board.otherReports)}{' '}
            <span className="text-sm font-normal text-mushi-ink-muted">AI audits, Sentry, site checks, and bugs I filed</span>
          </dd>
        </div>
        <div>
          <dt>Fixes merged</dt>
          <dd>
            {formatCount(board.fixesMerged)}{' '}
            <span className="text-sm font-normal text-mushi-ink-muted">{formatCount(board.mergedFromUsers)} of them for a report from a person</span>
          </dd>
        </div>
        <div>
          <dt>AI reviews of fix PRs</dt>
          <dd>
            {formatCount(board.reviews)}{' '}
            <span className="text-sm font-normal text-mushi-ink-muted">{formatCount(board.reviewsHold)} said “do not merge”</span>
          </dd>
        </div>
        <div>
          <dt>Median time, bug found to fix merged</dt>
          <dd>{formatHours(board.medianHoursToMergedFix)}</dd>
        </div>
      </dl>

      {weeks.length > 1 && (
        <figure className="space-y-2">
          <figcaption className="docs-open__caption">
            Fixes merged per week. Each label under a point is the Monday the week starts (UTC); the number above it is that
            week’s count. The first and last weeks are partial.
          </figcaption>
          <svg
            width="100%"
            viewBox={`-12 -20 ${SPARK_W + 24} ${SPARK_H + 44}`}
            role="img"
            aria-label={`Fixes merged per week: ${weeks.map((w) => `week of ${w.weekStart}: ${w.merged}`).join(', ')}`}
            className="max-w-xl text-mushi-vermillion"
          >
            <line x1={0} y1={SPARK_H} x2={SPARK_W} y2={SPARK_H} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
            <path d={sparklinePath(points)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            {points.map((p, i) => (
              <g key={weeks[i].weekStart}>
                <circle cx={p.x} cy={p.y} r="2.5" fill="currentColor" />
                <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize="9" className="fill-mushi-ink">
                  {weeks[i].merged}
                </text>
                <text x={p.x} y={SPARK_H + 14} textAnchor="middle" fontSize="8" className="fill-mushi-ink-muted">
                  {weekLabel(weeks[i].weekStart)}
                </text>
              </g>
            ))}
          </svg>
        </figure>
      )}

      <p className="docs-open__caption">
        A bug report from a person is one sent through the Mushi button in the app from a real device; my own testing
        counts here too. Everything else (bugs I filed in the console, AI audits, Sentry errors, site checks) is counted
        under my own checks. A fix is merged when its pull request lands on the app’s main branch. The AI review of fix PRs
        is switched on for these apps; “do not merge” is its hold verdict, and a held PR waits for a person.
      </p>
    </div>
  )
}

/** "2026-10-19" → "Oct 19" (UTC). */
function weekLabel(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? isoDay : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
