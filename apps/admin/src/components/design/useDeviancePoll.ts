/**
 * FILE: apps/admin/src/components/design/useDeviancePoll.ts
 * PURPOSE: Follow a background deviance scan to its end.
 *
 *          POST /design/deviance/run answers 202 with `run.status: 'running'`
 *          and the scan finishes in the background. This hook polls
 *          GET /design/deviance every 5 s while `running` is non-null, then
 *          hands the finished run to `onSettled` so the page can say how it
 *          ended and reload /design.
 *
 *          It also checks once on mount, so a scan started in another tab
 *          (or before a reload) still shows as running here.
 *
 *          Bounded: the server turns a scan stuck for 15 minutes into
 *          `status: 'error'`; the client stops after ~17 minutes regardless,
 *          and after 3 consecutive failed polls, and says so — it never spins
 *          forever and never reports an unfinished scan as done.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import type { DesignDevianceResponse, DevianceRun } from '../../lib/recipeTypes'

/** @internal Exported for tests. */
export const DEVIANCE_POLL_MS = 5_000
/** 200 polls × 5 s ≈ 16.7 min — just past the server's 15-minute stale cut-off. */
const MAX_POLLS = 200
const MAX_CONSECUTIVE_FAILURES = 3

export type DevianceSettle =
  /** The watched scan finished (pass / warn / fail / error). */
  | { kind: 'finished'; run: DevianceRun }
  /** Nothing is running any more, but the finished run could not be matched. */
  | { kind: 'cleared'; latest: DevianceRun | null }
  /** Polling gave up (time limit or repeated errors); the scan may still finish. */
  | { kind: 'gave_up'; reason: string }

interface UseDeviancePollOptions {
  projectId: string
  onSettled: (outcome: DevianceSettle) => void
}

export function useDeviancePoll({ projectId, onSettled }: UseDeviancePollOptions) {
  const [running, setRunning] = useState<DevianceRun | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watched = useRef<string | null>(null)
  const polls = useRef(0)
  const failures = useRef(0)
  const alive = useRef(true)
  const settledRef = useRef(onSettled)
  useEffect(() => {
    settledRef.current = onSettled
  }, [onSettled])

  const path = `/v1/admin/projects/${projectId}/design/deviance?limit=1`

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    watched.current = null
  }, [])

  const settle = useCallback(
    (outcome: DevianceSettle) => {
      stop()
      setRunning(null)
      settledRef.current(outcome)
    },
    [stop],
  )

  const tick = useCallback(async () => {
    timer.current = null
    if (!alive.current || watched.current === null) return
    polls.current += 1
    const res = await apiFetch<DesignDevianceResponse>(path, { cache: 'no-store' })
    if (!alive.current || watched.current === null) return

    if (!res.ok || !res.data) {
      failures.current += 1
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) {
        settle({
          kind: 'gave_up',
          reason: res.error?.message ?? 'Could not check on the scan.',
        })
        return
      }
    } else {
      failures.current = 0
      const { running: now, latest } = res.data
      if (!now) {
        if (latest && latest.runId === watched.current) settle({ kind: 'finished', run: latest })
        else settle({ kind: 'cleared', latest })
        return
      }
      // A newer scan replaced the one we watched — follow it.
      watched.current = now.runId
      setRunning(now)
    }

    if (polls.current >= MAX_POLLS) {
      settle({ kind: 'gave_up', reason: 'The scan is taking longer than expected.' })
      return
    }
    timer.current = setTimeout(() => void tick(), DEVIANCE_POLL_MS)
  }, [path, settle])

  /** Start following a run (from a 202 POST). Runs that already finished are ignored. */
  const follow = useCallback(
    (run: DevianceRun) => {
      if (run.status !== 'running') return
      stop()
      watched.current = run.runId
      polls.current = 0
      failures.current = 0
      setRunning(run)
      timer.current = setTimeout(() => void tick(), DEVIANCE_POLL_MS)
    },
    [stop, tick],
  )

  // One look on mount: pick up a scan already in progress.
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void apiFetch<DesignDevianceResponse>(path, { cache: 'no-store' }).then((res) => {
      if (cancelled || !res.ok || !res.data?.running || watched.current !== null) return
      follow(res.data.running)
    })
    return () => {
      cancelled = true
      alive.current = false
      stop()
    }
  }, [path, follow, stop])

  return { running, follow }
}

/** One plain sentence for how a scan ended. Never calls an unfinished scan done. */
export function describeDevianceSettle(
  outcome: DevianceSettle,
): { tone: 'info' | 'warn' | 'danger'; text: string } {
  switch (outcome.kind) {
    case 'finished': {
      const run = outcome.run
      if (run.status === 'error') return { tone: 'danger', text: run.error || 'The scan failed.' }
      if (run.status === 'running') return { tone: 'warn', text: 'The scan is still running.' }
      if (run.score === null) return { tone: 'info', text: 'Scan finished — not scored.' }
      return { tone: 'info', text: `Scan finished — deviance score ${Math.round(run.score)}.` }
    }
    case 'cleared':
      return { tone: 'info', text: 'The scan is no longer running. The latest results are shown below.' }
    case 'gave_up':
      return {
        tone: 'warn',
        text: `Stopped checking on the scan: ${outcome.reason} It may still finish — reload this page later.`,
      }
  }
}
