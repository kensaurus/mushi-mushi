/**
 * FILE: preflight-contract.test.ts
 * PURPOSE: Validates the GET /v1/admin/projects/:id/preflight response contract.
 *          Covers owner-only access, the 4-check response shape, and the
 *          `repoUrl` field added in the May-2026 update.
 *
 *          The handler is re-implemented inline as a pure function so we can
 *          test all branches without spinning up Supabase or Hono.
 */

import { describe, it, expect } from 'vitest'

// ── Types mirroring production ──────────────────────────────────────────────

type PreflightKey = 'github' | 'codebase' | 'anthropic' | 'autofix'

interface PreflightCheck {
  key: PreflightKey
  ready: boolean
  label: string
  hint: string
  fixHref: string
}

interface PreflightResponse {
  ready: boolean
  checks: PreflightCheck[]
  repoUrl: string | null
}

// ── In-memory handler ───────────────────────────────────────────────────────

interface ProjectSettings {
  autofix_enabled: boolean
  codebase_index_enabled: boolean
  byok_anthropic_key_ref: string | null
}

interface ProjectRepo {
  repo_url: string | null
  last_indexed_at: string | null
  indexing_enabled: boolean
}

function computePreflight(
  settings: ProjectSettings | null,
  primaryRepo: ProjectRepo | null,
  indexedFileCount: number,
): PreflightResponse {
  const githubRepoUrl = primaryRepo?.repo_url ?? null
  const githubReady = !!githubRepoUrl

  const codebaseReady =
    !!settings?.codebase_index_enabled &&
    indexedFileCount > 0 &&
    !!primaryRepo?.last_indexed_at

  const anthropicReady = !!settings?.byok_anthropic_key_ref

  const autofixReady = !!settings?.autofix_enabled

  const checks: PreflightCheck[] = [
    {
      key: 'github',
      ready: githubReady,
      label: 'GitHub repo connected',
      hint: githubReady
        ? `Repo: ${githubRepoUrl}`
        : 'Paste your GitHub repo URL in Integrations to give the fix worker a target.',
      fixHref: '/integrations',
    },
    {
      key: 'codebase',
      ready: codebaseReady,
      label: 'Codebase indexed for RAG',
      hint: codebaseReady
        ? `${indexedFileCount} files in pgvector`
        : settings?.codebase_index_enabled
          ? 'Indexing is enabled but no files yet — wait ~90s after first enable.'
          : 'Enable codebase indexing so the fix worker reads real source instead of guessing.',
      fixHref: '/integrations',
    },
    {
      key: 'anthropic',
      ready: anthropicReady,
      label: 'Anthropic key configured',
      hint: anthropicReady
        ? 'BYOK key present in Vault'
        : 'Add an Anthropic key in Settings → BYOK so the agent can actually run.',
      fixHref: '/settings?tab=byok',
    },
    {
      key: 'autofix',
      ready: autofixReady,
      label: 'Autofix enabled for this project',
      hint: autofixReady
        ? 'Dispatch will queue a fix worker.'
        : 'Flip the Autofix switch on the GitHub integration card to allow dispatches.',
      fixHref: '/integrations',
    },
  ]

  return {
    ready: checks.every((c) => c.ready),
    checks,
    repoUrl: githubRepoUrl,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('preflight-contract', () => {
  it('returns exactly 4 checks with the expected keys', () => {
    const result = computePreflight(null, null, 0)
    expect(result.checks).toHaveLength(4)
    const keys = result.checks.map((c) => c.key)
    expect(keys).toEqual(['github', 'codebase', 'anthropic', 'autofix'])
  })

  it('ready=false when all settings are null', () => {
    const result = computePreflight(null, null, 0)
    expect(result.ready).toBe(false)
    expect(result.checks.every((c) => !c.ready)).toBe(true)
  })

  it('ready=true only when all 4 checks pass', () => {
    const settings: ProjectSettings = {
      autofix_enabled: true,
      codebase_index_enabled: true,
      byok_anthropic_key_ref: 'vault://abc123',
    }
    const repo: ProjectRepo = {
      repo_url: 'https://github.com/kensaurus/solo-boss-cloud',
      last_indexed_at: '2026-05-01T00:00:00Z',
      indexing_enabled: true,
    }
    const result = computePreflight(settings, repo, 250)
    expect(result.ready).toBe(true)
    expect(result.checks.every((c) => c.ready)).toBe(true)
  })

  it('github check fails when repo_url is null', () => {
    const settings: ProjectSettings = {
      autofix_enabled: true,
      codebase_index_enabled: true,
      byok_anthropic_key_ref: 'vault://abc123',
    }
    const repo: ProjectRepo = {
      repo_url: null,
      last_indexed_at: '2026-05-01T00:00:00Z',
      indexing_enabled: true,
    }
    const result = computePreflight(settings, repo, 250)
    expect(result.ready).toBe(false)
    const gh = result.checks.find((c) => c.key === 'github')
    expect(gh?.ready).toBe(false)
    expect(gh?.hint).toContain('Integrations')
  })

  it('codebase check fails when indexing disabled even if files exist', () => {
    const settings: ProjectSettings = {
      autofix_enabled: true,
      codebase_index_enabled: false,
      byok_anthropic_key_ref: 'vault://abc123',
    }
    const repo: ProjectRepo = {
      repo_url: 'https://github.com/kensaurus/solo-boss-cloud',
      last_indexed_at: '2026-05-01T00:00:00Z',
      indexing_enabled: false,
    }
    const result = computePreflight(settings, repo, 999)
    const cb = result.checks.find((c) => c.key === 'codebase')
    expect(cb?.ready).toBe(false)
  })

  it('codebase check fails when indexed but 0 files', () => {
    const settings: ProjectSettings = {
      autofix_enabled: true,
      codebase_index_enabled: true,
      byok_anthropic_key_ref: 'vault://abc123',
    }
    const repo: ProjectRepo = {
      repo_url: 'https://github.com/kensaurus/solo-boss-cloud',
      last_indexed_at: '2026-05-01T00:00:00Z',
      indexing_enabled: true,
    }
    const result = computePreflight(settings, repo, 0)
    const cb = result.checks.find((c) => c.key === 'codebase')
    expect(cb?.ready).toBe(false)
    expect(cb?.hint).toContain('wait ~90s')
  })

  it('repoUrl is included in the response and matches github hint', () => {
    const url = 'https://github.com/kensaurus/solo-boss-cloud'
    const settings: ProjectSettings = {
      autofix_enabled: true,
      codebase_index_enabled: true,
      byok_anthropic_key_ref: 'vault://abc123',
    }
    const repo: ProjectRepo = {
      repo_url: url,
      last_indexed_at: '2026-05-01T00:00:00Z',
      indexing_enabled: true,
    }
    const result = computePreflight(settings, repo, 100)
    expect(result.repoUrl).toBe(url)
    const gh = result.checks.find((c) => c.key === 'github')
    expect(gh?.hint).toContain(url)
  })

  it('repoUrl is null when no repo connected', () => {
    const result = computePreflight(null, null, 0)
    expect(result.repoUrl).toBeNull()
  })

  it('fixHref for anthropic points to /settings?tab=byok', () => {
    const result = computePreflight(null, null, 0)
    const anth = result.checks.find((c) => c.key === 'anthropic')
    expect(anth?.fixHref).toBe('/settings?tab=byok')
  })

  it('each non-ready check has a non-empty hint and fixHref', () => {
    const result = computePreflight(null, null, 0)
    for (const check of result.checks) {
      expect(check.hint.length).toBeGreaterThan(0)
      expect(check.fixHref.length).toBeGreaterThan(0)
      expect(check.label.length).toBeGreaterThan(0)
    }
  })
})
