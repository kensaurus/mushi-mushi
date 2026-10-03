/**
 * FILE: packages/cli/src/command-helpers.ts
 * PURPOSE: Helpers shared by the console-parity commands (portfolio, connectors,
 *          funnel, releases, outbox, repo, budgets): organization ids, the
 *          account-key hint, explicit confirmation for outbound actions, and
 *          project id resolution.
 */

import type { ApiError } from './cli-shared.js'
import { die, requireUuid } from './cli-shared.js'
import { MushiCliError } from './errors.js'

/**
 * The `:orgId` path segment. `current` lets the server pick the caller's only
 * organization; it answers ORG_REQUIRED with the list when there are several.
 */
export function orgSegment(org: string | undefined): string {
  if (!org || org === 'current') return 'current'
  return encodeURIComponent(requireUuid(org, 'organization id'))
}

/**
 * Print an org-scoped route's error with what to do next, then exit.
 * ORG_REQUIRED lists the organizations to pick from; the *_NEEDS_ACCOUNT_KEY
 * codes mean the configured key is bound to one project.
 */
export function dieOrgError(result: ApiError): never {
  const { code } = result.error
  if (code === 'ORG_REQUIRED') {
    const orgs = Array.isArray(result.error['organizations'])
      ? (result.error['organizations'] as Array<{ id?: unknown; name?: unknown }>)
      : []
    if (orgs.length > 0) {
      process.stderr.write('\n  Pick one and pass it with --org:\n')
      for (const o of orgs) {
        process.stderr.write(`    --org ${String(o.id)}   ${typeof o.name === 'string' ? o.name : ''}\n`)
      }
      process.stderr.write('\n')
    }
  } else if (code.endsWith('_NEEDS_ACCOUNT_KEY')) {
    process.stderr.write(
      '\n  Team-wide views need an account-level key, not a key bound to one project.\n' +
      '  Mint one in the console (Connect → MCP → account key), then:\n\n' +
      '    MUSHI_API_KEY=<account key> mushi <command>\n\n',
    )
  }
  die(result)
}

/**
 * Refuse an outbound or public action (messages reporters, publishes a page)
 * unless the caller passed --yes. Exits 2 (E_INVALID_INPUT).
 */
export function requireYes(yes: boolean | undefined, action: string): void {
  if (yes) return
  throw new MushiCliError(
    'E_INVALID_INPUT',
    `${action} Re-run with --yes to go ahead.`,
    'nothing was sent',
  )
}

/** The project id from --project-id or the configured project, validated. */
export function resolveProjectId(flag: string | undefined, configured: string | undefined): string {
  const raw = flag ?? configured
  if (!raw) {
    throw new MushiCliError(
      'E_PROJECT_MISSING',
      'Project ID not configured.',
      'pass --project-id <uuid> or run `mushi login --project-id <uuid>`',
    )
  }
  return requireUuid(raw, 'project id')
}

/** Short, single-line form of untrusted text (report titles, repo strings) for a table cell. */
export function oneLine(text: string | null | undefined, max = 80): string {
  const flat = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
