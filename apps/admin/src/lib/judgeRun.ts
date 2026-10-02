/**
 * FILE: apps/admin/src/lib/judgeRun.ts
 * PURPOSE: Client side of "Run judge now".
 *
 * - `describeJudgeRun` turns the POST /v1/admin/judge/run payload into the
 *   toast + receipt copy. The server answers `{ dispatched: 0, evaluated: 0,
 *   reason }` when nothing is eligible; that used to read as a green
 *   "Dispatched 1 project" while the batch graded nothing.
 * - `useJudgeRunPrefill` handles `/judge?action=run` deep links from the inbox,
 *   banners and Prompt Lab. A judge run spends LLM budget, so visiting a URL
 *   must never start one: the param only focuses and highlights the Run button.
 */

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

type JudgeRunEmptyReason = 'no_projects' | 'judge_disabled' | 'nothing_to_grade'

export interface JudgeRunResponse {
  dispatched: number
  eligible?: number
  evaluated?: number
  reason?: JudgeRunEmptyReason
  message?: string
}

export type JudgeRunOutcome =
  | { kind: 'dispatched'; title: string; description: string; receipt: string }
  | { kind: 'nothing'; reason: JudgeRunEmptyReason; title: string; description: string; receipt: string }

const EMPTY_TITLES: Record<JudgeRunEmptyReason, string> = {
  no_projects: 'No project to grade',
  judge_disabled: 'Judge is turned off',
  nothing_to_grade: 'Nothing new to grade',
}

export function describeJudgeRun(data: JudgeRunResponse | null | undefined): JudgeRunOutcome {
  if (data?.reason) {
    const description = data.message ?? EMPTY_TITLES[data.reason]
    return {
      kind: 'nothing',
      reason: data.reason,
      title: EMPTY_TITLES[data.reason] ?? 'Nothing to grade',
      description,
      receipt: description,
    }
  }
  const count = data?.dispatched ?? 0
  const eligible = data?.eligible
  const reports = eligible != null ? ` · ${eligible} report${eligible === 1 ? '' : 's'} to grade` : ''
  return {
    kind: 'dispatched',
    title: 'Judge batch dispatched',
    description: `${count} project(s)${reports}. Refreshing in ~30s.`,
    receipt: `Dispatched ${count} project${count === 1 ? '' : 's'}${reports} — refreshing in ~30s`,
  }
}

/** How long the Run button keeps its "you were sent here for this" ring. */
const JUDGE_RUN_PREFILL_HIGHLIGHT_MS = 4_000

/**
 * Consumes `?action=run`: strips it from the URL, focuses the element with
 * `targetId`, and returns true while the highlight should show. Never runs
 * the judge.
 */
export function useJudgeRunPrefill(targetId: string): boolean {
  const [searchParams, setSearchParams] = useSearchParams()
  const [highlighted, setHighlighted] = useState(false)
  // The button may not be mounted yet (first paint shows a skeleton), so the
  // focus request waits here until a render where the element exists.
  const pendingFocusRef = useRef(false)
  const wantsRun = searchParams.get('action') === 'run'

  useEffect(() => {
    if (!wantsRun) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('action')
        return next
      },
      { replace: true },
    )
    setHighlighted(true)
    pendingFocusRef.current = true
  }, [wantsRun, setSearchParams])

  useEffect(() => {
    if (!pendingFocusRef.current) return
    const el = document.getElementById(targetId)
    if (!el) return
    pendingFocusRef.current = false
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  })

  useEffect(() => {
    if (!highlighted) return
    const t = setTimeout(() => setHighlighted(false), JUDGE_RUN_PREFILL_HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [highlighted])

  return highlighted
}
