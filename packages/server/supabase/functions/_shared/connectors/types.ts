/**
 * FILE: packages/server/supabase/functions/_shared/connectors/types.ts
 * PURPOSE: The one interface every recipe source plugs in through (Plan 019
 *          §2b, ADR 0016; kinds extended by ADR 0017). Modelled on
 *          CloudAgentAdapter (ADR 0013): one registry, an unknown kind is a
 *          400, never a silent skip.
 *
 * Rules every connector follows (enforced by the contract suite in
 * packages/server/src/__tests__/connectors-contract.test.ts):
 *   - probe() never throws for "denied": it returns ok:false with the
 *     missing scopes. A connector with no credential is `not_connected`.
 *     A connector an outside party blocks (Apple's unaccepted agreement) is
 *     `blocked` with the reason — never an error and never ok.
 *   - snapshot() is read-only and its result is validated with Zod; invalid
 *     data becomes an `error` element, never `ok`.
 *   - detectDrift() is pure.
 *   - Only the GitHub connector turns edits into files; proposeChange()
 *     returns FileEdit[] and never writes.
 *   - act() refuses without an approved, unexpired, unused connector_actions
 *     row whose payload hash matches (_shared/connector-actions.ts). No act
 *     capability ships enabled.
 */

import type { getServiceClient } from '../db.ts'
import type { RecipeElementKey } from '../recipe-types.ts'

type Db = ReturnType<typeof getServiceClient>

export const CONNECTOR_KINDS = [
  'github',
  'supabase',
  'sentry',
  'http',
  'public_probe',
  'app_store_connect',
  'play_console',
  'llm_usage',
  'revenuecat',
  'vercel',
  'eas',
  'stripe',
  'posthog',
] as const
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number]

export const CONNECTOR_CAPABILITIES = ['snapshot', 'drift', 'propose', 'act'] as const
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number]

/** How a connector instance stands right now. `blocked` = a party outside Mushi refuses (e.g. an unaccepted agreement). */
export type ConnectorStatus = 'connected' | 'not_connected' | 'blocked' | 'error'

/**
 * Why a vendor said no, from its HTTP status (http-util `failureOfStatus`).
 * Stored on connector_instances.last_probe_failure and
 * connector_snapshots.error_kind so the radar never parses `reason` text.
 */
export const PROBE_FAILURES = ['credential_rejected', 'permission_missing', 'not_found', 'rate_limited', 'vendor_error', 'other'] as const
export type ProbeFailure = (typeof PROBE_FAILURES)[number]

export interface ProbeResult {
  ok: boolean
  status: ConnectorStatus
  granted: string[]
  /** Scopes the probe found missing. Only ones it actually checked. */
  missing: string[]
  /** Plain-English reason, always set when ok is false. */
  reason?: string
  /** Set when the vendor answered with an HTTP status that says why. */
  failure?: ProbeFailure
}

export interface ConnectorContext {
  db: Db
  organizationId: string
  projectId: string | null
  /** Resolved read credential (never logged). null = not connected. */
  readCredential: string | null
  /** Resolved write credential; null unless propose/act is enabled. */
  writeCredential: string | null
  config: Record<string, unknown>
  /** Network access, injectable for tests. Must not send credentials to a host other than the vendor's. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => Date
}

export interface ConnectorBinding {
  projectId: string
  externalId: string
  role: string
}

export interface ElementFragment {
  state?: 'ok' | 'drift' | 'unknown' | 'not_connected' | 'error'
  summary: Record<string, string | number | boolean | null>
  detail?: Record<string, unknown>
}

export interface PortfolioResourceRef {
  kind: string
  externalId: string
  role: string
  metadata?: Record<string, unknown>
}

export interface ConnectorSnapshot {
  observedAt: string
  elements: Partial<Record<RecipeElementKey, ElementFragment>>
  resources: PortfolioResourceRef[]
  /** Connector-specific facts the drift rules and detectors read. */
  facts: Record<string, unknown>
  cursor?: string
}

export interface DriftFinding {
  gate: string
  ruleId: string
  severity: 'info' | 'warn' | 'error'
  message: string
  filePath?: string | null
  suggestedFix?: { kind: 'patch' | 'command' | 'prompt'; text: string }
}

export interface FileEdit {
  path: string
  content: string
}

export interface RecipeChange {
  element: RecipeElementKey
  /** Free-form intent the connector knows how to turn into file edits. */
  intent: Record<string, unknown>
}

export interface ApprovedConnectorAction {
  id: string
  action: string
  payload: Record<string, unknown>
  payloadSha256: string
}

export interface ConnectorActionResult {
  ok: boolean
  detail: string
  result?: Record<string, unknown>
}

export interface RecipeConnector {
  kind: ConnectorKind
  title: string
  capabilities: readonly ConnectorCapability[]
  /** Scopes or permissions each capability needs; shown before connect, checked by probe(). */
  requiredScopes: Partial<Record<ConnectorCapability, readonly string[]>>
  /** What the credential can do, in the vendor's own words — shown before connect. */
  credentialNote: string
  /** Act capabilities this connector implements (each needs its own approval). */
  actions?: readonly string[]
  probe(ctx: ConnectorContext): Promise<ProbeResult>
  snapshot(ctx: ConnectorContext, bindings: readonly ConnectorBinding[]): Promise<ConnectorSnapshot>
  detectDrift?(prev: ConnectorSnapshot | null, next: ConnectorSnapshot, manifest: unknown): DriftFinding[]
  proposeChange?(ctx: ConnectorContext, change: RecipeChange): Promise<FileEdit[]>
  act?(ctx: ConnectorContext, action: ApprovedConnectorAction): Promise<ConnectorActionResult>
}

export class ConnectorError extends Error {
  constructor(message: string, readonly status: ConnectorStatus = 'error', readonly failure?: ProbeFailure) {
    super(message)
    this.name = 'ConnectorError'
  }
}

export function notConnected(reason: string): ProbeResult {
  return { ok: false, status: 'not_connected', granted: [], missing: [], reason }
}
