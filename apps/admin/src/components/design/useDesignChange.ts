/**
 * FILE: apps/admin/src/components/design/useDesignChange.ts
 * PURPOSE: Preview → confirm flow for POST /v1/admin/projects/:id/design/changes.
 *
 *          1. preview(req) sends `{ ...req, dryRun: true }` and keeps the
 *             returned diff plus the exact request it previewed.
 *          2. confirm() resends THAT request with `dryRun: false`, under one
 *             idempotency key minted at preview time, so a double click cannot
 *             open two draft PRs.
 *          3. reset() bumps a generation counter: a preview still in flight
 *             when its inputs changed is dropped on arrival, so a confirm can
 *             only ever submit what the user saw in the diff.
 *
 *          A write is only reported when the response carries a non-null `pr`.
 *          The page keys this hook's owner by project, so a held request can
 *          never be confirmed against another project.
 */

import { useCallback, useRef, useState } from 'react'
import { apiFetchMutate } from '../../lib/supabase'
import type { DesignChangeRequest, DesignChangeResult } from '../../lib/recipeTypes'

type DesignChangePhase = 'idle' | 'previewing' | 'previewed' | 'submitting' | 'submitted' | 'error'

export interface DesignChangeState {
  phase: DesignChangePhase
  preview: DesignChangeResult | null
  result: DesignChangeResult | null
  error: string | null
}

const IDLE: DesignChangeState = { phase: 'idle', preview: null, result: null, error: null }

/** True while the inputs behind a change must not move (request in flight or a PR result on screen). */
export function changeLocksInputs(state: DesignChangeState): boolean {
  return state.phase === 'previewing' || state.phase === 'submitting' || state.phase === 'submitted'
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `design-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useDesignChange(projectId: string) {
  const [state, setState] = useState<DesignChangeState>(IDLE)
  const previewed = useRef<{ req: DesignChangeRequest; key: string } | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)

  const reset = useCallback(() => {
    generation.current += 1
    previewed.current = null
    setState(IDLE)
  }, [])

  const send = useCallback(
    async (req: DesignChangeRequest, idempotencyKey: string) => {
      const res = await apiFetchMutate<DesignChangeResult>(`/v1/admin/projects/${projectId}/design/changes`, {
        method: 'POST',
        body: JSON.stringify(req),
        idempotencyKey,
      })
      if (!res.ok || !res.data) {
        return { ok: false as const, error: res.error?.message ?? 'The change request failed.' }
      }
      return { ok: true as const, data: res.data }
    },
    [projectId],
  )

  const preview = useCallback(
    async (req: DesignChangeRequest) => {
      if (inFlight.current) return
      inFlight.current = true
      const gen = generation.current
      const dry = { ...req, dryRun: true } as DesignChangeRequest
      setState({ phase: 'previewing', preview: null, result: null, error: null })
      try {
        const out = await send(dry, newKey())
        // The inputs changed while this was in flight: its diff is stale.
        if (gen !== generation.current) return
        if (!out.ok) {
          previewed.current = null
          setState({ phase: 'error', preview: null, result: null, error: out.error })
          return
        }
        previewed.current = { req, key: newKey() }
        setState({ phase: 'previewed', preview: out.data, result: null, error: null })
      } finally {
        inFlight.current = false
      }
    },
    [send],
  )

  const confirm = useCallback(async () => {
    const p = previewed.current
    if (!p || inFlight.current) return
    inFlight.current = true
    setState((s) => ({ ...s, phase: 'submitting', error: null }))
    try {
      const out = await send({ ...p.req, dryRun: false } as DesignChangeRequest, p.key)
      // A confirm result is never dropped: if a PR was opened, its link must show.
      if (!out.ok) {
        setState((s) => ({ ...s, phase: 'error', error: out.error }))
        return
      }
      setState((s) => ({ ...s, phase: 'submitted', result: out.data }))
    } finally {
      inFlight.current = false
    }
  }, [send])

  return { state, preview, confirm, reset }
}
