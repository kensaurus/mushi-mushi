/**
 * FILE: apps/admin/src/components/recipe/useRecipeChange.ts
 * PURPOSE: Preview → confirm → follow for POST /v1/admin/projects/:id/recipe/changes
 *          (the API propose_recipe_change uses), for one recipe element.
 *
 *          1. preview(edits) sends `dryRun: true` and keeps the diff plus the
 *             exact edits it previewed (each with the blob SHA it was read at,
 *             so the server refuses a file that moved since).
 *          2. confirm() resends THOSE edits with `dryRun: false, wait: false`
 *             under one idempotency key minted at preview time, so a double
 *             click cannot open two draft PRs. The server answers 202 + jobId.
 *          3. The job is followed on GET …/changes/:jobId/stream (SSE). If the
 *             stream closes before a terminal status, it falls back to polling
 *             GET …/changes/:jobId (useSdkUpgrade's pattern). A poll answered
 *             with an error that will not change on retry (404, 403, 401, a
 *             bad request) ends in the error state at once with the server's
 *             message; a network or 5xx error is retried, at most
 *             POLL_MAX_ERRORS times in a row.
 *          4. reset() bumps a generation counter and stops following: a reply
 *             still in flight for older inputs is dropped on arrival.
 *
 *          The owner keys this hook's component by project and element, so a
 *          held preview can never be confirmed against another one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchMutate, supabase } from '../../lib/supabase'
import { RESOLVED_API_URL } from '../../lib/env'
import { openSseStream, type SseEvent } from '../../lib/sseClient'
import type {
  RecipeChangeAccepted,
  RecipeChangeDryRun,
  RecipeChangeEdit,
  RecipeChangeElement,
  RecipeChangeJobRow,
  RecipeChangeJobStatus,
  RecipeChangeStreamStatus,
} from '../../lib/recipeTypes'

type Phase = 'idle' | 'previewing' | 'previewed' | 'submitting' | 'following' | 'done' | 'error'

export interface RecipeChangeJobView {
  jobId: string
  status: RecipeChangeJobStatus
  prUrl: string | null
  prNumber: number | null
  branch: string | null
  error: string | null
}

export interface RecipeChangeState {
  phase: Phase
  preview: RecipeChangeDryRun | null
  job: RecipeChangeJobView | null
  error: string | null
  /** Set when confirm found another change for this element already running and follows that one. */
  note: string | null
}

const IDLE: RecipeChangeState = { phase: 'idle', preview: null, job: null, error: null, note: null }
const TERMINAL: readonly RecipeChangeJobStatus[] = ['pr_opened', 'failed', 'rejected']
const POLL_MS = 2_000
const POLL_MAX_MS = 10 * 60_000
/** Consecutive transient poll failures (network, 5xx) tolerated before the error is shown. */
export const POLL_MAX_ERRORS = 3

/** Error codes worth another poll: the request may succeed next time. Anything else is final. */
const TRANSIENT_CODES: readonly string[] = ['NETWORK_ERROR', 'DB_ERROR', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED']

export function isTransientPollError(error: { code: string; message: string } | undefined): boolean {
  if (!error) return true
  if (TRANSIENT_CODES.includes(error.code)) return true
  // apiFetch reports a body without an error envelope as HTTP_ERROR "<status>: …".
  return error.code === 'HTTP_ERROR' && /^5\d\d:/.test(error.message)
}

export function isTerminalJob(status: RecipeChangeJobStatus): boolean {
  return TERMINAL.includes(status)
}

/** True while the form behind a change must not move (request in flight or a job on screen). */
export function recipeChangeLocksInputs(state: RecipeChangeState): boolean {
  return state.phase === 'previewing' || state.phase === 'submitting' || state.phase === 'following' || state.phase === 'done'
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `recipe-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fromRow(row: RecipeChangeJobRow): RecipeChangeJobView {
  return { jobId: row.id, status: row.status, prUrl: row.pr_url, prNumber: row.pr_number, branch: row.branch, error: row.error }
}

export function useRecipeChange(projectId: string, element: RecipeChangeElement, opts: { pollMs?: number } = {}) {
  const pollMs = opts.pollMs ?? POLL_MS
  const [state, setState] = useState<RecipeChangeState>(IDLE)
  const previewed = useRef<{ edits: RecipeChangeEdit[]; title?: string; key: string } | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const base = `/v1/admin/projects/${projectId}/recipe/changes`

  const stopFollowing = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }, [])

  useEffect(() => () => {
    generation.current += 1
    stopFollowing()
  }, [stopFollowing])

  const reset = useCallback(() => {
    generation.current += 1
    stopFollowing()
    previewed.current = null
    setState(IDLE)
  }, [stopFollowing])

  /** Apply a job update unless the hook moved on; returns true once the job is finished. */
  const applyJob = useCallback((gen: number, job: RecipeChangeJobView): boolean => {
    if (gen !== generation.current) return true
    const done = isTerminalJob(job.status)
    setState((s) => ({ ...s, phase: done ? 'done' : 'following', job, error: null }))
    return done
  }, [])

  const poll = useCallback(
    (gen: number, jobId: string, startedAt: number) => {
      let failures = 0
      const fail = (message: string) => setState((s) => ({ ...s, phase: 'error', error: message }))
      const tick = async () => {
        if (gen !== generation.current) return
        if (Date.now() - startedAt > POLL_MAX_MS) {
          fail('The draft PR did not finish within 10 minutes. Check the repo before trying again.')
          return
        }
        const res = await apiFetch<RecipeChangeJobRow>(`${base}/${jobId}`, { cache: 'no-store' })
        if (gen !== generation.current) return
        if (res.ok && res.data) {
          failures = 0
          if (applyJob(gen, fromRow(res.data))) return
        } else {
          const message = res.ok ? 'The job status came back empty.' : res.error?.message ?? 'The job status could not be read.'
          failures += 1
          if (!res.ok && !isTransientPollError(res.error)) {
            fail(`Could not follow the change: ${message}`)
            return
          }
          if (failures >= POLL_MAX_ERRORS) {
            fail(`Could not follow the change after ${failures} tries: ${message}`)
            return
          }
        }
        pollTimer.current = setTimeout(() => void tick(), pollMs)
      }
      void tick()
    },
    [applyJob, base, pollMs],
  )

  const follow = useCallback(
    async (gen: number, jobId: string) => {
      let finished = false
      let polling = false
      const fallBack = () => {
        if (finished || polling || gen !== generation.current) return
        polling = true
        poll(gen, jobId, Date.now())
      }
      const { data: session } = await supabase.auth.getSession()
      const bearer = session.session?.access_token
      if (gen !== generation.current) return
      if (!bearer) {
        fallBack()
        return
      }
      const ctrl = new AbortController()
      abortRef.current = ctrl
      await openSseStream({
        url: `${RESOLVED_API_URL}${base}/${jobId}/stream`,
        bearer,
        signal: ctrl.signal,
        onEvent: (e: SseEvent) => {
          if (e.event !== 'status' || gen !== generation.current) return
          try {
            const p = JSON.parse(e.data) as RecipeChangeStreamStatus
            finished = applyJob(gen, { jobId, status: p.status, prUrl: p.prUrl, prNumber: p.prNumber, branch: p.branch, error: p.error })
          } catch {
            /* a malformed event is ignored; the poll fallback still reaches the end */
          }
        },
        onClose: (reason) => {
          if (reason === 'abort') return
          fallBack()
        },
      })
    },
    [applyJob, base, poll],
  )

  const preview = useCallback(
    async (edits: RecipeChangeEdit[], title?: string) => {
      if (inFlight.current) return
      inFlight.current = true
      generation.current += 1
      stopFollowing()
      const gen = generation.current
      setState({ ...IDLE, phase: 'previewing' })
      try {
        const res = await apiFetchMutate<RecipeChangeDryRun>(base, {
          method: 'POST',
          body: JSON.stringify({ element, edits, dryRun: true, ...(title ? { title } : {}) }),
          idempotencyKey: newKey(),
        })
        if (gen !== generation.current) return
        if (!res.ok || !res.data) {
          previewed.current = null
          setState({ ...IDLE, phase: 'error', error: res.error?.message ?? 'The preview failed.' })
          return
        }
        if (!res.data.ok) {
          previewed.current = null
          setState({ ...IDLE, phase: 'error', error: res.data.reason ?? 'Nothing in this repo is writable.' })
          return
        }
        previewed.current = { edits, title, key: newKey() }
        setState({ ...IDLE, phase: 'previewed', preview: res.data })
      } finally {
        inFlight.current = false
      }
    },
    [base, element, stopFollowing],
  )

  const confirm = useCallback(async () => {
    const p = previewed.current
    if (!p || inFlight.current) return
    inFlight.current = true
    const gen = generation.current
    setState((s) => ({ ...s, phase: 'submitting', error: null }))
    try {
      const res = await apiFetchMutate<RecipeChangeAccepted>(base, {
        method: 'POST',
        body: JSON.stringify({ element, edits: p.edits, dryRun: false, wait: false, ...(p.title ? { title: p.title } : {}) }),
        idempotencyKey: p.key,
      })
      if (gen !== generation.current) return
      // A 409 ALREADY_RUNNING carries the running job's id in `data`.
      const runningId = !res.ok && res.error?.code === 'ALREADY_RUNNING' ? res.data?.jobId ?? null : null
      if (runningId) {
        // Another change for this element is running: follow that one instead.
        previewed.current = null
        setState((s) => ({
          ...s,
          phase: 'following',
          note: 'Another change for this part of the recipe was already running, so this shows that one. Preview again once it finishes.',
          job: { jobId: runningId, status: 'running', prUrl: null, prNumber: null, branch: null, error: null },
        }))
        void follow(gen, runningId)
        return
      }
      if (!res.ok || !res.data?.jobId) {
        setState((s) => ({ ...s, phase: 'error', error: res.error?.message ?? 'The change could not be started.' }))
        return
      }
      const jobId = res.data.jobId
      // A preview opens at most one PR: the next confirm needs a new preview.
      previewed.current = null
      setState((s) => ({ ...s, phase: 'following', job: { jobId, status: 'queued', prUrl: null, prNumber: null, branch: null, error: null } }))
      void follow(gen, jobId)
    } finally {
      inFlight.current = false
    }
  }, [base, element, follow])

  return { state, preview, confirm, reset }
}
