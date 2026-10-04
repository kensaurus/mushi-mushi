/**
 * Request-body checks for integration settings and routing configs
 * (api/routes/integrations.ts). Pure, so the rules are unit-tested without
 * loading the route module.
 */
import { isVaultRef } from './vault-ref.ts'
import { assertSafeOutboundUrl } from './inventory-guards.ts'
import { parseSentryDsnSetting, sentrySelfHostedHosts } from './sentry-dsn.ts'

export type BodyError = { code: string; message: string }

// Tenant-set hosts the server later calls with credentials attached.
const PLATFORM_URL_FIELDS = new Set(['langfuse_host'])
const ROUTING_URL_FIELDS = new Set(['baseUrl', 'base_url', 'url', 'webhookUrl', 'webhook_url'])
const GITHUB_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

function vaultRefError(field: string): BodyError {
  return {
    code: 'VAULT_REF_NOT_ALLOWED',
    message: `${field}: paste the secret itself. Mushi stores it in Vault and keeps the reference.`,
  }
}

function unsafeUrlError(field: string, reason: string): BodyError {
  return { code: 'UNSAFE_URL', message: `${field} must be a public https URL (${reason}).` }
}

/**
 * Shapes a settings body must never carry: a `vault://` reference (the server
 * mints those, see vault-ref.ts) or an outbound URL that is not public https.
 */
/**
 * Claude Code Agent settings that end up in the workflow YAML the console
 * hands out (`repository_dispatch.types`) or in a dispatch payload. Plain
 * identifiers only, so a saved value can never break or inject into the YAML.
 */
const CLAUDE_AGENT_FIELD_RULES: Record<string, { re: RegExp; message: string }> = {
  claude_workflow_event: {
    re: /^[A-Za-z0-9_.-]{1,100}$/,
    message: 'Workflow event can use letters, digits, ".", "-" and "_" only (up to 100), e.g. mushi_claude_fix.',
  },
  claude_default_branch: {
    re: /^(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/,
    message: 'Base branch must be a plain branch name such as main or release/2026.',
  },
  claude_default_model: {
    re: /^[A-Za-z0-9._:-]{1,100}$/,
    message: 'Default model must be a model id such as claude-opus-4-1.',
  },
}

export function validatePlatformBody(body: Record<string, unknown>): BodyError | null {
  for (const [k, v] of Object.entries(body)) {
    if (isVaultRef(v)) return vaultRefError(k)
    const rule = CLAUDE_AGENT_FIELD_RULES[k]
    if (rule && typeof v === 'string' && v.trim() !== '' && !rule.re.test(v.trim())) {
      return { code: 'VALIDATION_ERROR', message: rule.message }
    }
    if (PLATFORM_URL_FIELDS.has(k) && typeof v === 'string' && v.trim() !== '') {
      const safe = assertSafeOutboundUrl(v.trim())
      if (!safe.ok) return unsafeUrlError(k, safe.reason)
    }
    // The server forwards events to this DSN, so it gets the same check as
    // PATCH /v1/admin/settings: a Sentry host or an allowlisted self-hosted one.
    if (k === 'sentry_dsn') {
      const verdict = parseSentryDsnSetting(v, sentrySelfHostedHosts())
      if (!verdict.ok) return { code: 'VALIDATION_ERROR', message: verdict.message }
    }
  }
  return null
}

/** A Sentry project slug, as the import route accepts it (sentry-import.ts). */
export const SENTRY_PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/
/** Mirrors CHECK (cardinality(sentry_extra_project_slugs) <= 10). */
export const MAX_SENTRY_EXTRA_PROJECT_SLUGS = 10

/**
 * `sentry_extra_project_slugs` on PUT /v1/admin/integrations/platform/sentry:
 * a string array of Sentry project slugs, trimmed and deduped, at most 10.
 * `null`, `''` and `[]` clear it to `{}` (the column is NOT NULL).
 */
export function parseSentryExtraProjectSlugs(
  raw: unknown,
): { ok: true; slugs: string[] } | { ok: false; error: BodyError } {
  if (raw === null || raw === '') return { ok: true, slugs: [] }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'sentry_extra_project_slugs must be an array of Sentry project slugs.' },
    }
  }
  const slugs = [...new Set((raw as string[]).map((s) => s.trim()).filter((s) => s.length > 0))]
  const bad = slugs.find((s) => !SENTRY_PROJECT_SLUG_RE.test(s))
  if (bad !== undefined) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `"${bad.slice(0, 60)}" is not a Sentry project slug (lowercase letters, digits, "-" or "_").`,
      },
    }
  }
  if (slugs.length > MAX_SENTRY_EXTRA_PROJECT_SLUGS) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `At most ${MAX_SENTRY_EXTRA_PROJECT_SLUGS} extra Sentry projects per Mushi project.`,
      },
    }
  }
  return { ok: true, slugs }
}

/** Same rules for a routing provider's config, plus plain GitHub names. */
export function validateRoutingConfig(type: string, config: Record<string, unknown>): BodyError | null {
  for (const [k, v] of Object.entries(config)) {
    if (isVaultRef(v)) return vaultRefError(k)
    if (ROUTING_URL_FIELDS.has(k) && typeof v === 'string' && v.trim() !== '') {
      const safe = assertSafeOutboundUrl(v.trim())
      if (!safe.ok) return unsafeUrlError(k, safe.reason)
    }
  }
  if (type === 'github') {
    // "owner/repo" in `repo` would also match the push-routing lookup in
    // webhooks-github-indexer for someone else's repository.
    for (const k of ['owner', 'repo']) {
      const v = config[k]
      if (v == null || v === '') continue
      if (typeof v !== 'string' || !GITHUB_NAME_RE.test(v)) {
        return { code: 'VALIDATION_ERROR', message: `${k} must be a plain GitHub name without "/".` }
      }
    }
  }
  return null
}
