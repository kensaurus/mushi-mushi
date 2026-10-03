/**
 * FILE: packages/cli/src/commands/repo.ts
 * PURPOSE: `mushi repo digest` and `mushi repo diagram show|generate|publish|unpublish`
 *          — console parity for the Explore page's repo digest (one
 *          token-budgeted text of the connected repo for an LLM) and the
 *          architecture diagram (/v1/admin/projects/:id/codebase/{digest,diagram}).
 *          Publishing makes the diagram a public page, so it shows the
 *          preview and needs --yes.
 */

import type { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { apiCall, die, fmtDate, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { oneLine, requireYes, resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** A cache miss reads the GitHub tree and file contents. */
const DIGEST_TIMEOUT_MS = 90_000
/** Generating a diagram is one LLM call over the repo tree. */
const DIAGRAM_TIMEOUT_MS = 120_000
/** Publishing writes the static page and its Markdown twin. */
const PUBLISH_TIMEOUT_MS = 60_000

export interface RepoDigestData {
  owner: string
  repo: string
  sha: string
  ref: string
  budget_tokens: number
  total_tokens: number
  eligible_files: number
  files: Array<{ path: string; tokens: number; truncated: boolean }>
  dropped_counts: Record<string, number>
  redacted: Array<{ path: string; label: string }>
  tree_truncated: boolean
  scope: { kind: string; label: string }
  cached: boolean
  text: string
}

interface DiagramRow {
  id: string
  commit_sha: string
  repo_owner: string
  repo_name: string
  graph: { groups: Array<{ id: string; label: string }>; nodes: Array<{ id: string; label: string; group: string; path: string | null }>; edges: unknown[] }
  model: string | null
  updated_at: string
}

type Publication =
  | { published: false }
  | { published: true; url: string; markdown_url?: string; badge_markdown: string; indexable: boolean; commit_sha: string }

export interface DiagramData {
  diagram: DiagramRow | null
  publication: Publication
  reused?: boolean
}

export interface PublishPreview {
  diagram_id: string
  repo_private: boolean
  payload_hash: string
  url: string
  can_publish: boolean
  publish_blocked_reason: string | null
}

export function digestQuery(opts: { report?: string; path?: string; ref?: string; budget?: string; include?: string; exclude?: string }): URLSearchParams {
  const qs = new URLSearchParams()
  if (opts.report) qs.set('report_id', requireUuid(opts.report, 'report id'))
  if (opts.path) qs.set('path', opts.path)
  if (opts.ref) qs.set('ref', opts.ref)
  if (opts.budget) qs.set('budget', opts.budget)
  if (opts.include) qs.set('include', opts.include)
  if (opts.exclude) qs.set('exclude', opts.exclude)
  return qs
}

export function digestSummary(d: RepoDigestData): string[] {
  const dropped = Object.entries(d.dropped_counts).filter(([, n]) => n > 0).map(([why, n]) => `${n} ${why}`).join(', ')
  const lines = [
    `${d.owner}/${d.repo}@${d.sha.slice(0, 7)} (${d.ref}) — ${d.scope.label}`,
    `  ${d.files.length} of ${d.eligible_files} files, ~${d.total_tokens} of ${d.budget_tokens} tokens${d.cached ? ' (cached)' : ''}`,
  ]
  if (dropped) lines.push(`  left out: ${dropped}`)
  if (d.redacted.length > 0) lines.push(`  secrets removed from ${d.redacted.length} file(s)`)
  if (d.tree_truncated) lines.push('  GitHub returned a partial tree (very large repo): some paths are missing.')
  return lines
}

export function renderDiagram(data: DiagramData): string[] {
  const d = data.diagram
  if (!d) return ['No diagram yet. Make one with: mushi repo diagram generate']
  const lines = [`${d.repo_owner}/${d.repo_name}@${d.commit_sha.slice(0, 7)} — updated ${fmtDate(d.updated_at)}${d.model ? ` by ${d.model}` : ''}`]
  for (const g of d.graph.groups) {
    const parts = d.graph.nodes.filter((n) => n.group === g.id)
    lines.push(`  ${oneLine(g.label, 40)}`)
    for (const n of parts) lines.push(`    - ${oneLine(n.label, 40)}${n.path ? `  (${n.path})` : ''}`)
  }
  lines.push(`  ${d.graph.edges.length} connection(s)`)
  lines.push(data.publication.published ? `Public page: ${data.publication.url}` : 'Not published. Publish it with: mushi repo diagram publish --yes')
  return lines
}

export function registerRepoCommands(program: Command): void {
  const repo = program
    .command('repo')
    .description('Your connected GitHub repo: a digest for an LLM and an architecture diagram')

  repo
    .command('digest')
    .description('One token-budgeted text of the repo (tree + the files that matter), secrets removed')
    .option('--report <id>', "Start from the files linked to this report's stack trace and fixes")
    .option('--path <folder>', 'Only this folder')
    .option('--ref <ref>', 'Branch, tag or commit (default: the default branch)')
    .option('--budget <tokens>', 'Token budget')
    .option('--include <globs>', 'Comma-separated globs a file must match')
    .option('--exclude <globs>', 'Comma-separated globs to leave out')
    .option('--out <file>', 'Write the digest text to this file instead of stdout')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output (metadata and text)')
    .action(async (opts: { report?: string; path?: string; ref?: string; budget?: string; include?: string; exclude?: string; out?: string; projectId?: string; json?: boolean }) => {
      const qs = digestQuery(opts)
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const suffix = qs.toString() ? `?${qs}` : ''
      const result = await apiCall<RepoDigestData>(`/v1/admin/projects/${projectId}/codebase/digest${suffix}`, config, {}, { timeoutMs: DIGEST_TIMEOUT_MS })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      if (opts.out) {
        try {
          writeFileSync(opts.out, result.data.text, 'utf8')
        } catch (err) {
          throw new MushiCliError('E_FILE_PERMISSION', `Could not write ${opts.out}`, 'pick a path you can write to', err)
        }
        for (const line of digestSummary(result.data)) console.log(line)
        console.log(`Wrote ${opts.out}.`)
        return
      }
      // Summary on stderr, so `mushi repo digest > digest.txt` captures only the text.
      for (const line of digestSummary(result.data)) process.stderr.write(`${line}\n`)
      process.stdout.write(result.data.text.endsWith('\n') ? result.data.text : `${result.data.text}\n`)
    })

  const diagram = repo
    .command('diagram')
    .description('The architecture diagram of your repo')

  diagram
    .command('show')
    .description('The latest diagram as an outline, and its public page if published')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<DiagramData>(`/v1/admin/projects/${projectId}/codebase/diagram`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderDiagram(result.data)) console.log(line)
    })

  diagram
    .command('generate')
    .description('Draw the diagram for the latest commit (reuses the one for that commit unless --force)')
    .option('--force', 'Draw it again even if this commit already has one')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { force?: boolean; projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<DiagramData>(
        `/v1/admin/projects/${projectId}/codebase/diagram`,
        config,
        { method: 'POST', body: JSON.stringify({ force: opts.force === true }) },
        { timeoutMs: DIAGRAM_TIMEOUT_MS },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      if (result.data.reused) console.log('This commit already has a diagram (pass --force to draw it again).')
      for (const line of renderDiagram(result.data)) console.log(line)
    })

  diagram
    .command('publish')
    .description('Publish the latest diagram as a public page (project owners and admins)')
    .option('--yes', 'Confirm: the diagram becomes public')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { yes?: boolean; projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const preview = await apiCall<PublishPreview>(`/v1/admin/projects/${projectId}/codebase/diagram/publish-preview`, config)
      if (!preview.ok) die(preview)
      const p = preview.data
      if (!p.can_publish) {
        throw new MushiCliError('E_INVALID_INPUT', p.publish_blocked_reason ?? 'This diagram cannot be published.', 'publish it from the console instead')
      }
      console.log(`Will publish to ${p.url}${p.repo_private ? ' (the repo is private on GitHub)' : ''}.`)
      requireYes(opts.yes, 'Publishing makes the diagram public.')
      // The hash pins exactly what the preview showed; the server refuses a stale one.
      const result = await apiCall<{ url: string; commit_sha: string; badge_markdown: string }>(
        `/v1/admin/projects/${projectId}/codebase/diagram/publish`,
        config,
        { method: 'POST', body: JSON.stringify({ diagram_id: p.diagram_id, payload_hash: p.payload_hash }) },
        { timeoutMs: PUBLISH_TIMEOUT_MS },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Published: ${result.data.url}`)
      console.log(`README badge: ${result.data.badge_markdown}`)
    })

  diagram
    .command('unpublish')
    .description('Take the public diagram page down')
    .option('--yes', 'Confirm the unpublish')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .action(async (opts: { yes?: boolean; projectId?: string }) => {
      requireYes(opts.yes, 'This removes the public diagram page.')
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<{ published: false }>(`/v1/admin/projects/${projectId}/codebase/diagram/publish`, config, { method: 'DELETE' })
      if (!result.ok) die(result)
      console.log('The public diagram page is down.')
    })
}
