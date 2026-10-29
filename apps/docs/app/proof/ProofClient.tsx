'use client'

/**
 * Client half of /proof. Aggregates only: no app names, report text or user
 * data reach the browser (the API whitelists its keys). If the API is down the
 * page says so; it never shows zeros it did not count, and a count the API did
 * not send shows as a dash, never "NaN".
 */

import type { ReactNode } from 'react'
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
const REPO_URL = 'https://github.com/kensaurus/mushi-mushi'
const HELD_PR_URL = 'https://github.com/kensaurus/mushi-mushi/pull/864'

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

  const apps = board && board !== 'loading' && Number.isFinite(board.apps) ? board.apps : null

  return (
    <div className="min-h-screen bg-mushi-paper">
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-mushi-vermillion">Mushi Mushi runs on itself</p>
          <h1 className="text-3xl font-bold tracking-tight text-mushi-ink sm:text-4xl">What Mushi Mushi did on my own apps</h1>
          <p className="text-base text-mushi-ink-muted">
            I build and run {apps ?? 'several'} apps of my own, and every one of them runs Mushi Mushi. These numbers are
            counted live from its database for those apps only. They are not customer numbers: only totals leave the
            database, never app names, report text or anything about the people who reported.
          </p>
          <p className="text-base text-mushi-ink-muted">
            So far most of the bugs it fixed were found by my own checks, not reported by people using the apps. The numbers
            below keep the two apart.
          </p>
        </header>

        {board === 'loading' && <p className="text-sm text-mushi-ink-muted">Counting…</p>}
        {board === null && (
          <p className="text-sm text-mushi-ink-muted">The numbers are not available right now. Try again in a few minutes.</p>
        )}
        {board && board !== 'loading' && <Board board={board} />}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-mushi-ink">Check it yourself</h2>
          <ul className="space-y-2 text-sm text-mushi-ink-muted">
            <li>
              <a href={HELD_PR_URL} className="font-medium text-mushi-vermillion hover:underline">
                A fix the AI review held
              </a>{' '}
              (pull request #864): the review says why, line by line, and the fix never merged.
            </li>
            <li>
              <a href={REPO_URL} className="font-medium text-mushi-vermillion hover:underline">
                The source on GitHub
              </a>
              : the SDKs are MIT, the server is AGPL. The function behind these numbers is{' '}
              <code className="text-xs">public_scoreboard()</code> in the migrations folder.
            </li>
          </ul>
        </section>

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

function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-mushi-rule bg-white/60 p-4">
      <p className="text-sm text-mushi-ink-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-mushi-ink" style={{ fontFamily: 'var(--mushi-font-display)' }}>
        {value}
      </p>
      {note && <p className="mt-1 text-sm text-mushi-ink-muted">{note}</p>}
    </div>
  )
}

/** Share of `part` in `part + rest`, as a whole percent; null when either is missing or both are 0. */
function share(part: number | undefined, rest: number | undefined): number | null {
  if (typeof part !== 'number' || typeof rest !== 'number' || !Number.isFinite(part) || !Number.isFinite(rest)) return null
  const total = part + rest
  return total > 0 ? Math.round((part / total) * 100) : null
}

function Board({ board }: { board: Scoreboard }) {
  const weeks = board.weeklyMerged ?? []
  const points = sparklinePoints(
    weeks.map((w) => w.merged),
    SPARK_W,
    SPARK_H,
  )
  const fromPeople = share(board.userReports, board.otherReports)
  const held = share(board.reviewsHold, typeof board.reviews === 'number' ? board.reviews - board.reviewsHold : undefined)

  return (
    <div className="not-prose space-y-10">
      <p className="text-sm text-mushi-ink-muted">
        Last {board.days} days, as of {formatAsOf(board.asOf)}. Refreshed every 15 minutes.
      </p>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-mushi-ink">Where the bugs came from</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            label="Reported by people using the apps"
            value={formatCount(board.userReports)}
            note={`from ${formatCount(board.reporters)} devices, my own testing included`}
          />
          <Stat
            label="Found by my own checks"
            value={formatCount(board.otherReports)}
            note="AI audits, Sentry errors, site checks, and bugs I filed"
          />
        </div>
        {fromPeople !== null && (
          <figure className="space-y-1">
            <div
              className="flex h-3 overflow-hidden rounded-full bg-mushi-rule"
              role="img"
              aria-label={`${fromPeople}% of the bugs were reported by people, ${100 - fromPeople}% found by my own checks`}
            >
              <div className="bg-mushi-vermillion" style={{ width: `${Math.max(fromPeople, 1)}%` }} />
            </div>
            <figcaption className="text-xs text-mushi-ink-muted">
              {fromPeople}% reported by people, {100 - fromPeople}% found by my own checks.
            </figcaption>
          </figure>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-mushi-ink">What happened to them</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Fixes merged"
            value={formatCount(board.fixesMerged)}
            note={`${formatCount(board.mergedFromUsers)} of them for a report from a person`}
          />
          <Stat
            label="AI reviews of fix PRs"
            value={formatCount(board.reviews)}
            note={`${formatCount(board.reviewsHold)} said “do not merge”${held !== null ? ` (${held}%)` : ''}`}
          />
          <Stat label="Median time, bug found to fix merged" value={formatHours(board.medianHoursToMergedFix)} />
        </div>
      </section>

      {weeks.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-mushi-ink">Fixes merged per week</h2>
          <figure className="space-y-2">
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
            <figcaption className="text-xs text-mushi-ink-muted">
              Each label is the Monday the week starts (UTC); the number above it is that week’s count. The first and last
              weeks are partial.
            </figcaption>
          </figure>
        </section>
      )}

      <p className="text-sm text-mushi-ink-muted">
        A bug report from a person is one sent through the report button in the app from a real device; my own testing
        counts here too. Everything else (bugs I filed in the console, AI audits, Sentry errors, site checks) counts as my
        own checks. A fix is merged when its pull request lands on the app’s main branch. The AI review of fix PRs is on for
        these apps; “do not merge” is its hold verdict, and a held PR waits for a person.
      </p>
    </div>
  )
}

/** "2026-10-19" → "Oct 19" (UTC). */
function weekLabel(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? isoDay : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
