/**
 * FILE: apps/admin/src/lib/useSentryConnection.ts
 * PURPOSE: One Sentry verdict for the whole console. The Integrations card
 *          (PlatformIntegrationCard) and the Settings → Error tracking row
 *          both read it, so Settings can never say "Not checked yet" while
 *          Integrations says Sentry is connected.
 *
 * OVERVIEW:
 * - `sentryConnectionFromPageData` is pure: it takes the three payloads the
 *   Integrations page already loads (platform credentials, probe history,
 *   inbound deliveries) and feeds them to the shared `sentryConnection()`
 *   with exactly the inputs the card uses.
 * - `useSentryConnection` is the thin hook that fetches those payloads for a
 *   page that does not already have them (Settings). The Settings banner
 *   uses the same view, so a Working Sentry counts toward all-clear even
 *   when no DSN is saved.
 *
 * DEPENDENCIES: usePageData, lib/integrationConnection, lib/platformIntegrationForm,
 * components/integrations/types (PLATFORM_DEFS, PlatformResponse, HealthRow).
 *
 * USAGE: `const sentry = useSentryConnection()` — `null` until the
 * credentials and probe history are known, so the caller can keep showing
 * its own saved-value hint instead of a wrong verdict.
 * `useSentryConnectionQuery()` also reports `settled`, so Quick mode can
 * wait for the verdict before it picks a tab.
 *
 * NOTES: the deliveries request is only made once the credentials are
 * complete, mirroring the card (`def.webhookPath && requiredOk`).
 */

import { usePageData } from './usePageData'
import { sentryConnection, type ConnectionView, type InboundDeliveryLike, type ProbeLike } from './integrationConnection'
import { platformRequiredOk } from './platformIntegrationForm'
import { PLATFORM_DEFS, type HealthRow, type PlatformResponse } from '../components/integrations/types'
import type { ConnectionState } from '../components/ui/ConnectionStatus'

const SENTRY_DEF = PLATFORM_DEFS.find((d) => d.kind === 'sentry')!

type Deliveries = { deliveries?: InboundDeliveryLike[] }

/** True when this project's Sentry credentials are complete (project, org or env). */
export function sentryConfiguredFromPlatform(platform: PlatformResponse | null): boolean {
  if (!platform) return false
  return platformRequiredOk(SENTRY_DEF, platform.platform?.sentry ?? {}, platform.sourceByField)
}

/**
 * Pure: the shared Sentry verdict, or `null` while the credentials or the
 * probe history are still unknown (saying "not connected" then would be a
 * guess, which is how Settings and Integrations drifted apart).
 */
export function sentryConnectionFromPageData(input: {
  platform: PlatformResponse | null
  history: HealthRow[] | null
  deliveries: InboundDeliveryLike[] | null
  deliveriesFailed?: boolean
  now?: number
}): ConnectionView | null {
  if (!input.platform || !input.history) return null
  const config = input.platform.platform?.sentry ?? {}
  const configured = sentryConfiguredFromPlatform(input.platform)
  const probe = input.history.find((h) => h.kind === 'sentry') as ProbeLike | undefined
  return sentryConnection({
    configured,
    probe,
    latestDelivery: input.deliveries?.[0],
    deliveriesLoaded: input.deliveries != null,
    deliveriesFailed: input.deliveriesFailed,
    autoImport: {
      enabled: config.sentry_auto_import === true,
      lastRunAt: typeof config.sentry_auto_import_last_at === 'string' ? config.sentry_auto_import_last_at : null,
    },
    now: input.now,
  })
}

/**
 * Pure: the Settings → Error tracking row's status. The shared verdict wins
 * whenever there is something to check; with no Sentry credentials at all
 * (`not_connected`) the page's own saved-value hint says what to paste.
 */
export function sentryRowStatus(
  shared: ConnectionView | null,
  savedHint: { state: ConnectionState; detail?: string },
): { state: ConnectionState; detail?: string } {
  if (!shared || shared.state === 'not_connected') return savedHint
  return { state: shared.state, detail: shared.detail ?? savedHint.detail }
}

type ReadState = { data: unknown; error: string | null }

/**
 * Pure: Quick mode may pick a tab. False while the credentials, the probe
 * history, or (when Sentry is configured) the deliveries read has neither a
 * payload nor an error. Loading is not the signal: the fetch flips that flag
 * in an effect, one paint after the path is set, and trusting it would lock
 * the "connect Sentry" tab on that paint. A failed read counts as settled
 * with no verdict, so the banner falls back to the saved DSN and does not
 * claim all-clear. Deliveries are skipped when Sentry is not configured.
 */
export function sentryQuerySettled(input: {
  enabled: boolean
  platform: ReadState
  history: ReadState
  configured: boolean
  deliveries: ReadState
}): boolean {
  if (!input.enabled) return true
  const done = (state: ReadState) => state.data != null || state.error != null
  if (!done(input.platform) || !done(input.history)) return false
  if (input.configured && !done(input.deliveries)) return false
  return true
}

/** The shared Sentry verdict, plus whether that read has finished. */
export function useSentryConnectionQuery(enabled = true): { view: ConnectionView | null; settled: boolean } {
  const platform = usePageData<PlatformResponse>(enabled ? '/v1/admin/integrations/platform' : null)
  const history = usePageData<{ history: HealthRow[] }>(enabled ? '/v1/admin/health/history' : null)
  const configured = sentryConfiguredFromPlatform(platform.data)
  const wantDeliveries = enabled && configured
  const deliveries = usePageData<Deliveries>(
    wantDeliveries ? '/v1/admin/integrations/inbound-deliveries?source=sentry' : null,
  )
  const view = sentryConnectionFromPageData({
    platform: platform.data,
    history: history.data?.history ?? null,
    deliveries: configured ? (deliveries.data?.deliveries ?? null) : [],
    deliveriesFailed: Boolean(deliveries.error),
  })
  return {
    view,
    settled: sentryQuerySettled({
      enabled,
      platform,
      history,
      configured,
      deliveries,
    }),
  }
}

/** The shared Sentry verdict for a page that does not load the payloads itself. */
export function useSentryConnection(enabled = true): ConnectionView | null {
  return useSentryConnectionQuery(enabled).view
}
