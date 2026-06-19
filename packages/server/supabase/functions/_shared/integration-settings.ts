/**
 * FILE: packages/server/supabase/functions/_shared/integration-settings.ts
 * PURPOSE: Resolve effective platform integration settings for a project,
 *          merging per-project → org default → host env vars in that order.
 *
 * RESOLUTION ORDER (per field):
 *   1. project_settings (per-project column, wins if non-null / non-empty)
 *   2. organization_integration_settings (org default, inherited when project field absent)
 *   3. Host environment variable (last resort, for self-hosted deployments)
 *
 * USAGE:
 *   const { settings, sourceByField } = await resolveEffectivePlatformSettings(db, projectId)
 *   // settings    — merged PlatformSettings ready for probes/fix-worker
 *   // sourceByField — per-field origin: 'project' | 'org' | 'env' | null
 *   //                 Used by the frontend to render inheritance badges.
 *
 * SECURITY:
 *   - Never logs raw credential values; only their resolved source.
 *   - All vault://<uuid> dereffing is done by the existing dereferenceMaybeVault
 *     helper in integration-probes.ts. This file only surfaces the raw ref
 *     strings; callers (probes, fix-worker) deref at point of use.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { PlatformSettings } from './integration-probes.ts'
import { log as rootLog } from './logger.ts'

// Deno global — edge-function runtime only.
declare const Deno: { env: { get(name: string): string | undefined } }

const log = rootLog.child('integration-settings')

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type FieldSource = 'project' | 'org' | 'env' | null

/** All platform settings fields tracked by the resolver. */
export type PlatformField = keyof PlatformSettings

/** Returned by resolveEffectivePlatformSettings. */
export interface EffectivePlatformSettings {
  /** Merged settings ready for consumption by probes and fix-worker. */
  settings: PlatformSettings
  /**
   * Per-field origin. Useful for the frontend to display
   * "Inherited from org" / "Overridden here" / "Available via environment" badges.
   */
  sourceByField: Record<PlatformField, FieldSource>
  /** The organization_id the project belongs to (null if not in an org). */
  organizationId: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Env-variable fallbacks (mirrors integration-probes.ts runtime checks)
// ──────────────────────────────────────────────────────────────────────────

/** Env vars that back specific platform fields when nothing is configured in DB. */
const FIELD_ENV_VAR: Partial<Record<PlatformField, string>> = {
  langfuse_host: 'LANGFUSE_BASE_URL',
  langfuse_public_key_ref: 'LANGFUSE_PUBLIC_KEY',
  langfuse_secret_key_ref: 'LANGFUSE_SECRET_KEY',
  github_installation_token_ref: 'GITHUB_TOKEN',
  cursor_api_key_ref: 'CURSOR_API_KEY',
  claude_api_key_ref: 'ANTHROPIC_API_KEY',
  slack_bot_token_ref: 'SLACK_BOT_TOKEN',
}

/** Fields present in organization_integration_settings (mirrors the migration columns). */
const ORG_FIELDS: PlatformField[] = [
  'sentry_org_slug',
  'sentry_auth_token_ref',
  'langfuse_host',
  'langfuse_public_key_ref',
  'langfuse_secret_key_ref',
  'github_repo_url',
  'github_installation_token_ref',
  'cursor_api_key_ref',
  'cursor_default_model',
  'claude_api_key_ref',
  'slack_bot_token_ref',
]

/** All project_settings fields that belong to platform integrations. */
const PROJECT_FIELDS: PlatformField[] = [
  'sentry_org_slug',
  'sentry_auth_token_ref',
  'langfuse_host',
  'langfuse_public_key_ref',
  'langfuse_secret_key_ref',
  'github_repo_url',
  'github_installation_token_ref',
  'cursor_api_key_ref',
  'cursor_default_model',
  'claude_api_key_ref',
  'slack_bot_token_ref',
]

// ──────────────────────────────────────────────────────────────────────────
// Main resolver
// ──────────────────────────────────────────────────────────────────────────

/**
 * Resolve the effective platform integration settings for a project by
 * merging (project → org default → env vars).
 *
 * @param db        - Supabase service-role client.
 * @param projectId - The project whose settings should be resolved.
 */
export async function resolveEffectivePlatformSettings(
  db: SupabaseClient,
  projectId: string,
): Promise<EffectivePlatformSettings> {
  // Step 1: Load per-project settings.
  const [projectResult, orgIdResult] = await Promise.all([
    db
      .from('project_settings')
      .select(PROJECT_FIELDS.join(', '))
      .eq('project_id', projectId)
      .maybeSingle(),
    // Find the org this project belongs to (needed for org fallback).
    db
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle(),
  ])

  if (projectResult.error) {
    log.warn('resolveEffectivePlatformSettings: failed to load project_settings', {
      projectId,
      err: projectResult.error.message,
    })
  }

  const projectRow = (projectResult.data ?? {}) as Record<string, string | null>
  const orgId = (orgIdResult.data as { organization_id: string | null } | null)?.organization_id ?? null

  // Step 2: Load org defaults (only if the project belongs to an org).
  let orgRow: Record<string, string | null> = {}
  if (orgId) {
    const { data: orgData, error: orgErr } = await db
      .from('organization_integration_settings')
      .select(ORG_FIELDS.join(', '))
      .eq('organization_id', orgId)
      .maybeSingle()
    if (orgErr) {
      log.warn('resolveEffectivePlatformSettings: failed to load org settings', {
        orgId,
        err: orgErr.message,
      })
    }
    orgRow = (orgData ?? {}) as Record<string, string | null>
  }

  // Step 3: Merge project → org → env, tracking source per field.
  const settings: Record<string, string | null> = {}
  const sourceByField: Record<string, FieldSource> = {}

  for (const field of PROJECT_FIELDS) {
    const projectVal = projectRow[field as string] ?? null
    if (projectVal !== null && projectVal !== '') {
      settings[field] = projectVal
      sourceByField[field] = 'project'
      continue
    }

    const orgVal = orgRow[field as string] ?? null
    if (orgVal !== null && orgVal !== '') {
      settings[field] = orgVal
      sourceByField[field] = 'org'
      continue
    }

    const envVar = FIELD_ENV_VAR[field]
    if (envVar) {
      const envVal = Deno.env.get(envVar)
      if (envVal) {
        // For env-backed fields, store a sentinel so callers (probes) that
        // already do Deno.env.get() directly still work without double-reading.
        // We set the effective value to null here — the existing probe logic
        // already falls back to Deno.env; the source annotation is what matters
        // for the UI badge ("Available via environment").
        settings[field] = null
        sourceByField[field] = 'env'
        continue
      }
    }

    settings[field] = null
    sourceByField[field] = null
  }

  return {
    settings: settings as unknown as PlatformSettings,
    sourceByField: sourceByField as Record<PlatformField, FieldSource>,
    organizationId: orgId,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Vault-aware variant: resolves AND dereferences vault:// refs
// ──────────────────────────────────────────────────────────────────────────

/**
 * Same as resolveEffectivePlatformSettings but additionally dereferences all
 * vault://<uuid> refs in the settings. Use this when you need the actual
 * plaintext values (e.g. fix-worker, probes). The UI should use the non-deref'd
 * version and only show presence/source.
 */
export async function resolveAndDereferencePlatformSettings(
  db: SupabaseClient,
  projectId: string,
): Promise<EffectivePlatformSettings> {
  const result = await resolveEffectivePlatformSettings(db, projectId)
  const { dereferenceMaybeVault } = await import('./integration-probes.ts')

  const derefed: Record<string, string | null> = {}
  for (const [field, val] of Object.entries(result.settings as Record<string, string | null>)) {
    if (val && val.startsWith('vault://')) {
      derefed[field] = await dereferenceMaybeVault(db, val)
    } else {
      derefed[field] = val
    }
  }

  return {
    ...result,
    settings: derefed as unknown as PlatformSettings,
  }
}
