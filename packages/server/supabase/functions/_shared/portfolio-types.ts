/**
 * FILE: packages/server/supabase/functions/_shared/portfolio-types.ts
 * PURPOSE: Wire types for the portfolio routes (Plan 019 Phase P1; Plan 020
 *          Phase 1 adds the radar and spend columns). Types only, no runtime
 *          code, so the admin console mirror (apps/admin/src/lib/portfolioTypes.ts)
 *          and the MCP proxies can copy them without pulling any Deno module.
 *
 * Routes (adminOrApiKey(mcp:read); an organization member's JWT or an
 * account-level key whose owner is a member — never a project-bound key):
 *   GET /v1/admin/orgs/:orgId/portfolio[?page=]   → PortfolioResponse
 *   GET /v1/admin/orgs/:orgId/portfolio/findings  → PortfolioFindingsResponse
 * `:orgId` may be the literal `current` when the caller belongs to exactly one
 * organization (the MCP default).
 *
 * Every route answers `{ ok: true, data: <type> }`.
 */

import type { ElementState, RecipeElementKey } from './recipe-types.ts'

export type ProjectKind = 'app' | 'site' | 'service' | 'library' | 'other'

/** Where a project's kind came from. `inferred` is labelled as such in the console. */
export type KindSource = 'declared' | 'inferred' | 'unknown'

export type SdkSkewStatus = 'current' | 'behind' | 'unknown'

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
  openReports: number
  sdk: SdkSkewEntry[]
  latestRelease: { version: string; publishedAt: string | null } | null
  radar: PortfolioRadarColumn
  spend: PortfolioSpendColumn
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
}

/**
 * Plan 020 Phase 1 spend column (Advanced mode only on the card). Mushi's own
 * LLM spend for the project over 30 days and whether caps are set. Facts, not
 * findings: missing caps are reported by the Phase 0 detector, not here.
 */
export interface PortfolioSpendColumn {
  llmUsd30d: number
  llmCalls30d: number
  autofixCapUsd: number | null
  monthlyLlmBudgetUsd: number | null
}

export interface FindingGroup {
  ruleId: string
  gate: string
  /** The highest severity among the grouped findings. */
  severity: 'info' | 'warn' | 'error'
  projectIds: string[]
  findingCount: number
  /** One sample message (from the highest-severity finding). Untrusted repo text. */
  sampleMessage: string
  /** One paste-ready prompt for the editor that fixes it in every listed project. */
  suggestedFix: string
}

export interface IntegrationHole {
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
  holes: number
}

export interface PortfolioFindingsResponse {
  organizationId: string
  generatedAt: string
  groups: FindingGroup[]
  sdkSkew: SdkSkewEntry[]
  holes: IntegrationHole[]
  /** Rules that are genuinely cross-project (shared auth, deep links, shared channels…), Phase P2. */
  crossProject: CrossProjectFinding[]
}

export interface CrossProjectFinding {
  id: string
  ruleId: string
  severity: 'info' | 'warn' | 'error'
  projectIds: string[]
  resourceKey: string | null
  message: string
  suggestedFix: string | null
}
