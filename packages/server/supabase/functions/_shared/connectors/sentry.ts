/**
 * FILE: packages/server/supabase/functions/_shared/connectors/sentry.ts
 * PURPOSE: The Sentry connector (Plan 019 §2b): legacy-backed — the existing
 *          `project_settings.sentry_auth_token_ref`, org slug and project
 *          slug. Read-only: projects and the latest release. Drift:
 *          integration_declared_missing, sentry_project_mismatch.
 *
 * The token is only ever sent to sentry.io (or a region host under it), so a
 * configured URL can never carry it elsewhere.
 *
 * config: { orgSlug, projectSlug, host? }  readCredential: the auth token.
 */

import { integrationDrift } from '../recipe-drift.ts'
import { failureOfStatus, fetchJson, statusReason, vendorError } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type DriftFinding, type RecipeConnector } from './types.ts'

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function base(ctx: ConnectorContext): string {
  const host = typeof ctx.config.host === 'string' ? ctx.config.host.toLowerCase() : 'sentry.io'
  return /^([a-z0-9-]+\.)?sentry\.io$/.test(host) ? `https://${host}` : 'https://sentry.io'
}

function sentry(ctx: ConnectorContext, path: string) {
  return fetchJson<any>(ctx, `${base(ctx)}/api/0${path}`, { headers: { Authorization: `Bearer ${ctx.readCredential}` } })
}

export const sentryConnector: RecipeConnector = {
  kind: 'sentry',
  title: 'Sentry',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['org:read', 'project:read', 'event:read'] },
  credentialNote: 'Uses the Sentry token already connected to this project. Mushi reads projects and releases only.',
  async probe(ctx) {
    const org = ctx.config.orgSlug
    if (typeof org !== 'string' || !SLUG.test(org)) return notConnected('Connect Sentry and set the organization slug.')
    if (!ctx.readCredential) return notConnected('No Sentry token is stored for this project.')
    const res = await sentry(ctx, `/organizations/${org}/projects/`)
    if (res.status === 200) return { ok: true, status: 'connected', granted: ['org:read', 'project:read'], missing: [] }
    return { ok: false, status: 'error', granted: [], missing: res.status === 403 ? ['org:read', 'project:read'] : [], reason: statusReason('Sentry', res.status), failure: failureOfStatus(res.status) }
  },
  async snapshot(ctx) {
    const org = ctx.config.orgSlug
    const project = ctx.config.projectSlug
    if (typeof org !== 'string' || !SLUG.test(org) || !ctx.readCredential) throw new ConnectorError('Sentry is not connected for this project.', 'not_connected')
    const projects = await sentry(ctx, `/organizations/${org}/projects/`)
    if (projects.status !== 200) throw vendorError('Sentry', projects.status)
    const slugs = ((projects.body ?? []) as Array<{ slug?: string }>).map((p) => String(p.slug ?? '')).filter(Boolean)
    let latestRelease: string | null = null
    if (typeof project === 'string' && SLUG.test(project) && slugs.includes(project)) {
      const rel = await sentry(ctx, `/projects/${org}/${project}/releases/?per_page=1`)
      if (rel.status === 200) latestRelease = ((rel.body ?? []) as Array<{ version?: string }>)[0]?.version ?? null
    }
    return {
      observedAt: ctx.now().toISOString(),
      elements: { integrations: { summary: { sentryProjects: slugs.length, latestRelease } } },
      resources: typeof project === 'string' ? [{ kind: 'sentry_project', externalId: `${org}/${project}`, role: 'errors' }] : [],
      facts: { orgSlug: org, projectSlug: typeof project === 'string' ? project : null, projects: slugs, latestRelease },
    }
  },
  detectDrift(_prev, next, manifest) {
    const f = next.facts as { projectSlug: string | null; projects: string[] }
    const declared = (manifest as { integrations?: { sentry?: { project?: string } } } | null)?.integrations ?? {}
    const out = integrationDrift({
      declared: { sentry: declared.sentry },
      configured: { sentry: { projectSlug: f.projectSlug } },
      health: [],
      now: new Date(next.observedAt),
    })
    if (f.projectSlug && !f.projects.includes(f.projectSlug)) {
      out.push({ gate: 'env_drift', ruleId: 'sentry_project_mismatch', severity: 'warn', message: `The connected Sentry project ${f.projectSlug} does not exist in that organization.`, suggestedFix: { kind: 'prompt', text: 'Reconnect Sentry and pick the project this app reports to.' } })
    }
    return out.map((d): DriftFinding => ({ gate: d.gate, ruleId: d.ruleId, severity: d.severity, message: d.message, filePath: d.filePath ?? null, suggestedFix: d.suggestedFix }))
  },
}
