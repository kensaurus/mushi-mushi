/**
 * FILE: packages/server/supabase/functions/_shared/connectors/index.ts
 * PURPOSE: The connector registry (Plan 019 §2b). An unknown kind is an
 *          error the api turns into a 400, never a silent skip. Kinds the
 *          plan names but that have no connector yet (added one at a time,
 *          when a pilot needs one) are listed as `planned`, not faked.
 */

import { appStoreConnectConnector } from './app-store-connect.ts'
import { githubConnector } from './github.ts'
import { httpConnector } from './http.ts'
import { llmUsageConnector } from './llm-usage.ts'
import { playConsoleConnector } from './play-console.ts'
import { publicProbeConnector } from './public-probe.ts'
import { revenuecatConnector } from './revenuecat.ts'
import { sentryConnector } from './sentry.ts'
import { supabaseConnector } from './supabase.ts'
import { CONNECTOR_KINDS, type ConnectorKind, type RecipeConnector } from './types.ts'

const REGISTRY: Partial<Record<ConnectorKind, RecipeConnector>> = {
  github: githubConnector,
  supabase: supabaseConnector,
  sentry: sentryConnector,
  http: httpConnector,
  public_probe: publicProbeConnector,
  app_store_connect: appStoreConnectConnector,
  play_console: playConsoleConnector,
  llm_usage: llmUsageConnector,
  revenuecat: revenuecatConnector,
}

/** Kinds that read through the project's existing settings (no connector_instances row needed). */
export const LEGACY_BACKED: readonly ConnectorKind[] = ['github', 'supabase', 'sentry', 'public_probe']

export class UnknownConnectorKind extends Error {
  constructor(readonly kind: string) {
    super(`Unknown connector kind: ${kind}`)
    this.name = 'UnknownConnectorKind'
  }
}

export function isConnectorKind(kind: string): kind is ConnectorKind {
  return (CONNECTOR_KINDS as readonly string[]).includes(kind)
}

/** The connector for a kind; throws UnknownConnectorKind for anything else, including planned kinds. */
export function getConnector(kind: string): RecipeConnector {
  const c = isConnectorKind(kind) ? REGISTRY[kind] : undefined
  if (!c) throw new UnknownConnectorKind(kind)
  return c
}

export function listConnectors(): RecipeConnector[] {
  return Object.values(REGISTRY) as RecipeConnector[]
}

/** Named in Plan 019 but not built yet; the console shows them as "planned". */
export function plannedKinds(): ConnectorKind[] {
  return CONNECTOR_KINDS.filter((k) => !REGISTRY[k])
}
