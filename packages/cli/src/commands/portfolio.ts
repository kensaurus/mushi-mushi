/**
 * FILE: packages/cli/src/commands/portfolio.ts
 * PURPOSE: `mushi portfolio show|findings` — every app in your team on one
 *          screen, and the problems repeated across them. Console parity for
 *          the Portfolio page (GET /v1/admin/orgs/:orgId/portfolio[/findings]).
 *          Needs an account-level key; a key bound to one project is refused.
 */

import type { Command } from 'commander'
import { apiCall, outputIsJson, requireConfig } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment } from '../command-helpers.js'

type Severity = 'info' | 'warn' | 'error'

interface PortfolioCard {
  projectId: string
  name: string
  kind: string | null
  worst: string
  error: string | null
  openReports: number
  sdk: Array<{ package: string | null; version: string | null; latest: string | null; status: string }>
  latestRelease: { version: string; publishedAt: string | null } | null
  radar: { status: string; open: Record<Severity, number>; unchecked: number }
  spend: { llmUsd30d: number; autofixCapUsd: number | null; monthlyLlmBudgetUsd: number | null }
}

interface PortfolioData {
  organizationId: string
  organizationName: string | null
  page: number
  pageSize: number
  totalProjects: number
  cards: PortfolioCard[]
  repeatedGroups: number
  holes: number
}

interface PortfolioFindingsData {
  organizationId: string
  groups: Array<{ ruleId: string; gate: string; severity: Severity; projectIds: string[]; findingCount: number; sampleMessage: string; suggestedFix: string }>
  sdkSkew: Array<{ projectId: string; package: string | null; version: string | null; latest: string | null; status: string; reason: string }>
  holes: Array<{ projectId: string; integration: string; siblingsWith: number; reason: string }>
  crossProject: Array<{ id: string; ruleId: string; severity?: string; message?: string; projectIds?: string[] }>
}

interface PortfolioResourcesData {
  organizationId: string
  resources: Array<{ id: string; kind: string; externalId: string; uses: Array<{ projectId: string; role: string; source: string }> }>
  findings: Array<{ id: string; rule_id: string; severity: string; project_ids: string[]; message: string }>
}

function renderPortfolioResources(data: PortfolioResourcesData): string[] {
  if (data.resources.length === 0) {
    return ['No shared resources recorded yet. They come from each app\'s recipe, or a CSV upload in the console.']
  }
  const lines = ['Shared resources (one account, domain or bucket used by several apps):']
  for (const r of data.resources) {
    lines.push(`  ${r.kind.padEnd(14)} ${oneLine(r.externalId, 50)}  used by ${r.uses.length} app(s)`)
    for (const u of r.uses) lines.push(`      ${u.projectId}  ${oneLine(u.role, 30)} (${u.source})`)
  }
  if (data.findings.length > 0) {
    lines.push('Open findings on shared resources:')
    for (const f of data.findings) lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${f.rule_id} — ${oneLine(f.message, 100)}`)
  }
  return lines
}

const ORG_HELP = '--org <id>'
const ORG_DESC = "Organization UUID (default: your only organization)"

function sdkLabel(card: PortfolioCard): string {
  const behind = card.sdk.filter((s) => s.status === 'behind')
  if (behind.length > 0) return `SDK behind (${behind.map((s) => `${s.package} ${s.version}→${s.latest}`).join(', ')})`
  if (card.sdk.some((s) => s.status === 'current')) return 'SDK current'
  return 'SDK unknown'
}

function renderPortfolio(data: PortfolioData): string[] {
  const lines: string[] = []
  const pages = Math.max(1, Math.ceil(data.totalProjects / Math.max(1, data.pageSize)))
  lines.push(`${data.organizationName ?? data.organizationId} — ${data.totalProjects} app(s), page ${data.page}/${pages}`)
  if (data.cards.length === 0) lines.push('  No apps in this team yet.')
  for (const c of data.cards) {
    const radar = c.radar.status === 'never_run'
      ? 'holes not checked yet'
      : `holes ${c.radar.open.error} error / ${c.radar.open.warn} warn`
    const release = c.latestRelease ? `last release ${c.latestRelease.version}` : 'no release yet'
    lines.push(`  ${c.worst.toUpperCase().padEnd(8)} ${oneLine(c.name, 40)}  (${c.projectId})`)
    lines.push(`           ${c.openReports} open report(s) · ${radar} · ${sdkLabel(c)} · ${release}`)
    if (c.error) lines.push(`           recipe could not be read: ${oneLine(c.error)}`)
  }
  lines.push(`Repeated problems: ${data.repeatedGroups} · integration holes: ${data.holes}  (mushi portfolio findings)`)
  return lines
}

function renderPortfolioFindings(data: PortfolioFindingsData): string[] {
  const lines: string[] = []
  if (data.groups.length === 0 && data.sdkSkew.length === 0 && data.holes.length === 0 && data.crossProject.length === 0) {
    return ['No repeated problems across your apps.']
  }
  if (data.groups.length > 0) {
    lines.push('Same problem in several apps:')
    for (const g of data.groups) {
      lines.push(`  ${g.severity.toUpperCase().padEnd(5)} ${g.ruleId} (${g.gate}) — ${g.findingCount} finding(s) in ${g.projectIds.length} app(s)`)
      lines.push(`        ${oneLine(g.sampleMessage, 120)}`)
    }
  }
  const behind = data.sdkSkew.filter((s) => s.status === 'behind')
  if (behind.length > 0) {
    lines.push('SDK behind latest:')
    for (const s of behind) lines.push(`  ${s.projectId}  ${s.package} ${s.version} → ${s.latest}`)
  }
  if (data.holes.length > 0) {
    lines.push('Integration holes (siblings have it, this app does not):')
    for (const h of data.holes) lines.push(`  ${h.projectId}  ${h.integration} — ${oneLine(h.reason, 100)}`)
  }
  if (data.crossProject.length > 0) {
    lines.push('Cross-app findings:')
    for (const f of data.crossProject) lines.push(`  ${(f.severity ?? 'info').toUpperCase().padEnd(5)} ${f.ruleId} — ${oneLine(f.message, 100)}`)
  }
  return lines
}

export function registerPortfolioCommands(program: Command): void {
  const portfolio = program
    .command('portfolio')
    .description('Every app in your team on one screen (needs an account-level key)')

  portfolio
    .command('show')
    .description('Health, open reports, holes, SDK version and last release for each app')
    .option(ORG_HELP, ORG_DESC)
    .option('--page <n>', 'Page of apps (25 per page)', '1')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; page: string; json?: boolean }) => {
      const config = requireConfig()
      const page = Math.max(1, Number.parseInt(opts.page, 10) || 1)
      const result = await apiCall<PortfolioData>(`/v1/admin/orgs/${orgSegment(opts.org)}/portfolio?page=${page}`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderPortfolio(result.data)) console.log(line)
    })

  portfolio
    .command('findings')
    .description('Problems repeated across your apps, SDK skew and integration holes')
    .option(ORG_HELP, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<PortfolioFindingsData>(`/v1/admin/orgs/${orgSegment(opts.org)}/portfolio/findings`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderPortfolioFindings(result.data)) console.log(line)
    })

  portfolio
    .command('resources')
    .description('Accounts, domains and buckets shared between your apps, and their open findings')
    .option(ORG_HELP, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<PortfolioResourcesData>(`/v1/admin/orgs/${orgSegment(opts.org)}/portfolio/resources`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderPortfolioResources(result.data)) console.log(line)
    })
}
