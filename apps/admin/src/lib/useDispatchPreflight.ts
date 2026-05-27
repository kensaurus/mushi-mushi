/**
 * FILE: apps/admin/src/lib/useDispatchPreflight.ts
 * PURPOSE: Single source of truth for "is this project ready to dispatch an
 *          auto-fix?". Backs the DispatchFixPreflight popover, the GitHub
 *          integration card's Autofix toggle, and the DispatchPreflightBanner.
 *
 *          Primary: Supabase Realtime channel on `project_settings:project_id=eq.<id>`
 *          and `project_repos:project_id=eq.<id>` — refreshes immediately when a
 *          setting changes in any browser/tab without polling.
 *          Fallback: 30s poll + on-focus refresh when realtime disconnects.
 *
 *          At 100 concurrent tabs with realtime subscriptions, the DB receives
 *          one event per channel change (server push) instead of 3.3 rps of
 *          HTTP polls — significant reduction at scale.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './supabase'
import { supabase } from './supabase'

export type PreflightKey = 'github' | 'codebase' | 'anthropic' | 'autofix'

export interface PreflightCheck {
  key: PreflightKey
  ready: boolean
  label: string
  hint: string
  fixHref: string
}

export interface PreflightState {
  loading: boolean
  ready: boolean
  checks: PreflightCheck[]
  failing: PreflightCheck[]
  error: string | null
  reload: () => void
  /** GitHub repo URL the fix worker will target — sourced from the preflight endpoint. */
  repoUrl: string | null
}

interface PreflightResponse {
  ready: boolean
  checks: PreflightCheck[]
  repoUrl?: string | null
}

export function useDispatchPreflight(projectId: string | null | undefined): PreflightState {
  const [state, setState] = useState<{
    loading: boolean
    ready: boolean
    checks: PreflightCheck[]
    error: string | null
    repoUrl: string | null
  }>({ loading: true, ready: false, checks: [], error: null, repoUrl: null })
  const aliveRef = useRef(true)
  const realtimeHealthy = useRef(false)
  const pollTimerRef = useRef<number | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!projectId) {
      setState({ loading: false, ready: false, checks: [], error: null, repoUrl: null })
      return
    }
    const res = await apiFetch<PreflightResponse>(`/v1/admin/projects/${projectId}/preflight`)
    if (!aliveRef.current) return
    if (!res.ok || !res.data) {
      setState({
        loading: false,
        ready: false,
        checks: [],
        error: res.error?.message ?? 'Preflight check failed',
        repoUrl: null,
      })
      return
    }
    setState({
      loading: false,
      ready: res.data.ready,
      checks: res.data.checks,
      error: null,
      repoUrl: res.data.repoUrl ?? null,
    })
  }, [projectId])

  const startPollFallback = useCallback(() => {
    if (pollTimerRef.current) return
    pollTimerRef.current = window.setInterval(() => {
      if (!realtimeHealthy.current) void fetchOnce()
    }, 30_000)
  }, [fetchOnce])

  const stopPollFallback = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    aliveRef.current = true

    void fetchOnce()

    // Primary: Supabase Realtime on the two tables that gate dispatch readiness.
    // When a setting or repo row changes (any column), re-fetch the preflight
    // endpoint to get the consolidated view.
    const channel = supabase
      .channel(`preflight:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_settings', filter: `project_id=eq.${projectId}` },
        () => { void fetchOnce() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_repos', filter: `project_id=eq.${projectId}` },
        () => { void fetchOnce() },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeHealthy.current = true
          stopPollFallback()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeHealthy.current = false
          startPollFallback()
        }
      })

    // Focus refresh — user may have fixed a prereq in another tab
    const onFocus = () => { void fetchOnce() }
    window.addEventListener('focus', onFocus)

    // Start polling fallback immediately; if realtime connects within 3s we stop it
    startPollFallback()

    return () => {
      aliveRef.current = false
      realtimeHealthy.current = false
      void supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      stopPollFallback()
    }
  }, [projectId, fetchOnce, startPollFallback, stopPollFallback])

  return {
    loading: state.loading,
    ready: state.ready,
    checks: state.checks,
    failing: state.checks.filter((c) => !c.ready),
    error: state.error,
    reload: () => { void fetchOnce() },
    repoUrl: state.repoUrl,
  }
}
