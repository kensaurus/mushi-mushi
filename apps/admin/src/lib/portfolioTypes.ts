/**
 * FILE: apps/admin/src/lib/portfolioTypes.ts
 * PURPOSE: Console mirror of the portfolio wire types
 *          (packages/server/supabase/functions/_shared/portfolio-types.ts).
 *          Keep the two in step; the server file is the source.
 */

import type { ElementState, RecipeElementKey } from './recipeTypes'

type ProjectKind = 'app' | 'site' | 'service' | 'library' | 'other'

/** Where a project's kind came from. `inferred` is labelled as such in the console. */
type KindSource = 'declared' | 'inferred' | 'unknown'

type SdkSkewStatus = 'current' | 'behind' | 'unknown'

export interface SdkSkewEntry {
  projectId: string
  /** npm package name, e.g. `@mushi-mushi/web`. null when the project has no observation at all. */
  package: string | null
  version: string | null
  latest: string | null
  status: SdkSkewStatus
  /** Plain-English reason, always set. */
  reason: string
}

export interface PortfolioCard {
  projectId: string
  name: string
  slug: string | null
  kind: ProjectKind | null
  kindSource: KindSource
  /** Worst recipe element state; `error` when the recipe could not be composed. */
  worst: ElementState
  elements: Partial<Record<RecipeElementKey, ElementState>>
  /** Set when composing this project's recipe failed; the card then reads `error`. */
  error: string | null
  /**
   * What makes `worst` worse than ok, worst first: each recipe element that is
   * not ok and not merely "not set up", with its plain-English reason (which
   * already says what to do). Optional so an older server still renders.
   */
  needsLook?: PortfolioCardProblem[]
  openReports: number
  sdk: SdkSkewEntry[]
  latestRelease: { version: string; publishedAt: string | null } | null
  radar: PortfolioRadarColumn
  spend: PortfolioSpendColumn
  /** Columns of this card whose read failed or was cut short: unknown, not empty. */
  unreadable: PortfolioReadPart[]
}

export type PortfolioReadPart =
  | 'gate_runs'
  | 'findings'
  | 'reports'
  | 'sdk'
  | 'spend'
  | 'caps'
  | 'releases'
  | 'kind'
  | 'integrations'
  | 'cross_project'

export interface PortfolioReadError {
  part: PortfolioReadPart
  /** `failed`: the read errored. `truncated`: more rows matched than were read. */
  kind: 'failed' | 'truncated'
  message: string
}

/**
 * Plan 020 Phase 1 radar column: open radar findings by severity, plus how
 * many detectors have never run for this project. `checkedAt` null means the
 * radar has never run here — the card says "not checked yet", never green.
 */
export interface PortfolioRadarColumn {
  checkedAt: string | null
  /** `nothing_to_check`: the radar ran but nothing was declared for it to look at. */
  status: 'never_run' | 'nothing_to_check' | 'pass' | 'warn' | 'fail' | 'error'
  open: { error: number; warn: number; info: number }
  /** Detectors with no result for this project (no data to check, or never run). */
  unchecked: number
  /** Checks that failed to run in the latest runs (never counted as passing). */
  errored: number
}

/**
 * Plan 020 Phase 1 spend column (Advanced mode only on the card). Mushi's own
 * LLM spend for the project over 30 days and whether caps are set. Facts, not
 * findings: missing caps are reported by the Phase 0 detector, not here.
 */
interface PortfolioSpendColumn {
  /** null when the spend could not be read. */
  llmUsd30d: number | null
  llmCalls30d: number | null
  /** True when more calls matched than were summed: the totals are a lower bound. */
  partial: boolean
  autofixCapUsd: number | null
  monthlyLlmBudgetUsd: number | null
  /** False when the caps could not be read: null caps then mean "unknown", not "no cap". */
  capsKnown: boolean
}

export interface PortfolioCardProblem {
  element: RecipeElementKey
  label: string
  state: ElementState
  reason: string
}

export interface FindingGroup {
  ruleId: string
  /** Human title from the server's rule catalog; null (or absent on an older server) when the rule has none. */
  title?: string | null
  gate: string
  /** The gate as people read it ("Mushi setup check"). */
  gateLabel?: string
  /** The highest severity among the grouped findings. */
  severity: 'info' | 'warn' | 'error'
  projectIds: string[]
  findingCount: number
  /** One sample message (from the highest-severity finding). Untrusted repo text. */
  sampleMessage: string
  /** One paste-ready prompt for the editor that fixes it in every listed project. */
  suggestedFix: string
}

interface IntegrationHole {
  projectId: string
  integration: 'sentry' | 'slack' | 'linear' | 'supabase' | 'github'
  /** How many sibling projects already have it. */
  siblingsWith: number
  reason: string
}

export interface PortfolioResponse {
  organizationId: string
  organizationName: string | null
  generatedAt: string
  page: number
  pageSize: number
  totalProjects: number
  cards: PortfolioCard[]
  /** Counts only; the list is on /portfolio/findings. */
  repeatedGroups: number
  /** null when the integrations could not be read. */
  holes: number | null
  /** Every read that failed or was cut short; empty when the page is complete. */
  readErrors: PortfolioReadError[]
}

export interface PortfolioFindingsResponse {
  organizationId: string
  generatedAt: string
  groups: FindingGroup[]
  sdkSkew: SdkSkewEntry[]
  holes: IntegrationHole[]
  /** Rules that are genuinely cross-project (shared auth, deep links, shared channels…), Phase P2. */
  crossProject: CrossProjectFinding[]
  /** A part listed here means its list above is unknown, not empty. */
  readErrors: PortfolioReadError[]
}

interface CrossProjectFinding {
  id: string
  ruleId: string
  severity: 'info' | 'warn' | 'error'
  projectIds: string[]
  resourceKey: string | null
  message: string
  suggestedFix: string | null
}

// ── Spend ledger (gap #22): mirror of _shared/spend-ledger.ts ───────────────

export type BillVendor = 'vercel' | 'aws' | 'supabase' | 'other'
type LedgerSourceState = 'ok' | 'not_connected' | 'error'

export interface LedgerSource {
  state: LedgerSourceState
  /** Null unless state is ok. */
  usd: number | null
  detail: string | null
}

export interface LedgerApp {
  projectId: string
  name: string
  mushiLlm: LedgerSource & { calls: number }
  providerLlm: LedgerSource
  ci: LedgerSource & { minutes: number | null; runs: number }
  supabase: LedgerSource & { usage: Array<{ service: string; unit: string; quantity: number }> }
  bills: LedgerSource & { byVendor: Array<{ vendor: BillVendor; usd: number }> }
  totalUsd: number
  complete: boolean
}

interface LedgerImport {
  id: string
  vendor: BillVendor
  projectId: string | null
  filename: string | null
  format: string
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
}

export interface SpendLedgerResponse {
  organizationId: string
  from: string
  to: string
  days: number
  ciUsdPerLinuxMinute: number
  apps: LedgerApp[]
  totals: { mushiLlmUsd: number; providerLlmUsd: number; ciUsd: number; supabaseUsd: number; billsUsd: number; totalUsd: number }
  unattributedProviderUsd: number | null
  complete: boolean
  imports: LedgerImport[]
}

/** DELETE /v1/admin/orgs/:orgId/spend/imports/:importId */
export interface BillRemovalResult {
  importId: string
  /** Rows that left the ledger: no other import had those days. */
  rowsRemoved: number
  /** Rows handed back to the next newest import that had them. */
  rowsRestored: number
  /** How many earlier imports got rows back. */
  restoredFrom: number
}

export interface BillImportResult {
  importId: string
  format: string
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  skipReasons: string[]
  unmatchedApps: string[]
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
}
