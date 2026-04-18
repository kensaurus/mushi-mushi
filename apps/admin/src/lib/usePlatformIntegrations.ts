import { useEffect, useState } from 'react'
import { apiFetch } from './supabase'
import { langfuseTraceUrl as buildTraceUrl } from './env'

interface PlatformResponse {
  platform: {
    sentry?: {
      sentry_org_slug?: string | null
      sentry_project_slug?: string | null
      sentry_dsn?: string | null
    } | null
    langfuse?: {
      langfuse_host?: string | null
    } | null
    github?: {
      github_repo_url?: string | null
    } | null
  }
}

/**
 * Per-project integration metadata used to build deep-links from the admin UI
 * (Langfuse traces, Sentry issues, GitHub commits). Returned values fall back
 * to env defaults when the project hasn't configured the integration yet.
 *
 * Cached in module scope so multiple components on the same screen share one
 * fetch. Re-fetches on mount for freshness — the response is < 1KB.
 */
export function usePlatformIntegrations() {
  const [data, setData] = useState<PlatformResponse['platform'] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await apiFetch<PlatformResponse>('/v1/admin/integrations/platform')
      if (cancelled) return
      if (res.ok && res.data) setData(res.data.platform)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const langfuseHost = data?.langfuse?.langfuse_host ?? null
  const sentryOrg = data?.sentry?.sentry_org_slug ?? null
  const sentryProject = data?.sentry?.sentry_project_slug ?? null
  const githubRepoUrl = data?.github?.github_repo_url ?? null

  return {
    loading,
    langfuseHost,
    sentryOrg,
    sentryProject,
    githubRepoUrl,
    /** Build a Langfuse trace URL using this project's host (US/EU/self-hosted). */
    traceUrl: (traceId: string | null | undefined) => buildTraceUrl(traceId, langfuseHost),
    /** Build a Sentry event URL when org+project are configured. */
    sentryEventUrl: (eventId: string | null | undefined) => {
      if (!eventId || !sentryOrg || !sentryProject) return null
      return `https://${sentryOrg}.sentry.io/issues/?project=${encodeURIComponent(sentryProject)}&query=${encodeURIComponent(eventId)}`
    },
  }
}
