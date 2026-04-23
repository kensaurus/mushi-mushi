/**
 * library-modernizer — weekly cron.
 *
 * For each project_repos row that's primary + indexed, fetch the top-level
 * dependency manifest (package.json / pyproject.toml / requirements.txt /
 * Cargo.toml), ask Sonnet (BYOK) which deps look "materially behind" by
 * checking changelog_url via Firecrawl, and persist findings into
 * `modernization_findings`. Each high/medium severity finding also creates
 * a synthetic `reports` row (category='other', tagged 'modernization') so
 * it lands in the existing triage queue.
 *
 * Auth: pg_cron POSTs with the service-role bearer; we re-validate
 * identically to sentry-seer-poll. Never accept external requests.
 *
 * Cost control:
 *   - Per project, max 10 deps per repo, top-level only.
 *   - Per dep, max 1 firecrawl scrape (cached 24h).
 *   - LLM call uses BYOK Anthropic; project skipped if no key + no env fallback.
 */

import { Hono } from 'npm:hono@4'
import { generateObject } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { z } from 'npm:zod@3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { firecrawlScrape } from '../_shared/firecrawl.ts'
import { MODERNIZER_MODEL } from '../_shared/models.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

ensureSentry('library-modernizer')

const log = rootLog.child('library-modernizer')
const app = new Hono()
app.onError(sentryHonoErrorHandler)

function getDb() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
}

// Wave S (2026-04-23): mirror prompt-auto-tune — delegate to shared
// `requireServiceRoleAuth` so pg_cron callers passing
// `MUSHI_INTERNAL_CALLER_SECRET` are accepted. See auth.ts for the
// constant-time compare rationale.

async function readVaultSecret(
  db: ReturnType<typeof getDb>,
  ref: string | null | undefined,
): Promise<string | null> {
  if (!ref) return null
  if (!ref.startsWith('vault://')) return ref
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: ref.slice('vault://'.length) })
  if (error) return null
  return typeof data === 'string' ? data : null
}

const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
] as const

type ManifestKind = typeof MANIFEST_FILES[number]

interface ParsedDep {
  name: string
  version: string
}

function parseManifest(kind: ManifestKind, contents: string): ParsedDep[] {
  try {
    if (kind === 'package.json') {
      const pkg = JSON.parse(contents) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const deps: ParsedDep[] = []
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        deps.push({ name, version: String(version) })
      }
      // Skip devDependencies — too noisy for the first pass.
      return deps
    }
    if (kind === 'requirements.txt') {
      return contents
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .map((l) => {
          const m = l.match(/^([A-Za-z0-9_.-]+)\s*([=<>~!^]=?\s*[A-Za-z0-9._*+-]+)?/)
          return m ? { name: m[1], version: (m[2] ?? '').trim() } : null
        })
        .filter((d): d is ParsedDep => d !== null)
    }
    if (kind === 'go.mod') {
      const lines = contents.split('\n')
      const deps: ParsedDep[] = []
      let inRequire = false
      for (const raw of lines) {
        const line = raw.trim()
        if (line.startsWith('require (')) { inRequire = true; continue }
        if (inRequire && line === ')') { inRequire = false; continue }
        const single = line.match(/^require\s+([^\s]+)\s+(\S+)/)
        if (single) {
          deps.push({ name: single[1], version: single[2] })
          continue
        }
        if (inRequire) {
          const m = line.match(/^([^\s]+)\s+(\S+)/)
          if (m) deps.push({ name: m[1], version: m[2] })
        }
      }
      return deps
    }
    if (kind === 'pyproject.toml' || kind === 'Cargo.toml') {
      // Cheap section-level grep — full TOML parsing would pull a heavy
      // dep we don't otherwise need. Only top-level dependencies.
      const deps: ParsedDep[] = []
      const sectionMatch = contents.match(kind === 'pyproject.toml'
        ? /\[project\.dependencies\]([^\[]*)/m
        : /\[dependencies\]([^\[]*)/m,
      )
      if (sectionMatch) {
        for (const raw of sectionMatch[1].split('\n')) {
          const line = raw.trim()
          if (!line || line.startsWith('#')) continue
          const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/)
          if (m) deps.push({ name: m[1], version: m[2] })
        }
      }
      return deps
    }
  } catch (err) {
    log.warn('parseManifest failed', { kind, error: String(err).slice(0, 120) })
  }
  return []
}

async function fetchManifest(
  token: string | null,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
  const res = await fetch(url, { headers })
  if (!res.ok) return null
  const text = await res.text()
  if (text.length > 500_000) return null
  return text
}

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const cleaned = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
  const m = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/)
  return m ? { owner: m[1], repo: m[2] } : null
}

const findingSchema = z.object({
  findings: z.array(z.object({
    name: z.string().describe('Package/dep name as it appears in the manifest.'),
    currentVersion: z.string(),
    suggestedVersion: z.string().describe('Latest stable version you recommend upgrading to.'),
    severity: z.enum(['major', 'minor', 'security', 'deprecated']),
    summary: z.string().min(20).max(400)
      .describe('2-3 sentences: what changed, why upgrading matters, and any breaking-change risk.'),
    changelogUrl: z.string().url().nullable().optional(),
  })).max(8),
})

interface ProjectRow {
  project_id: string
  repo_id: string
  repo_url: string
  default_branch: string
}

async function processRepo(
  db: ReturnType<typeof getDb>,
  row: ProjectRow,
): Promise<{ scanned: number; created: number; skipped: string | null }> {
  const parsed = parseRepoUrl(row.repo_url)
  if (!parsed) return { scanned: 0, created: 0, skipped: 'bad_repo_url' }

  // GitHub token for the repo (vault-stored or env fallback). We tolerate
  // a missing token for public repos — the contents API still works.
  const { data: settings } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', row.project_id)
    .maybeSingle()
  const ghToken = await readVaultSecret(db, settings?.github_installation_token_ref as string | null) ?? Deno.env.get('GITHUB_TOKEN') ?? null

  let manifestPath: string | null = null
  let manifestKind: ManifestKind | null = null
  let manifestContents: string | null = null
  for (const candidate of MANIFEST_FILES) {
    const txt = await fetchManifest(ghToken, parsed.owner, parsed.repo, row.default_branch, candidate)
    if (txt) {
      manifestPath = candidate
      manifestKind = candidate
      manifestContents = txt
      break
    }
  }

  if (!manifestKind || !manifestContents) {
    return { scanned: 0, created: 0, skipped: 'no_manifest' }
  }

  const deps = parseManifest(manifestKind, manifestContents).slice(0, 10)
  if (deps.length === 0) return { scanned: 0, created: 0, skipped: 'empty_manifest' }

  const anthropic = await resolveLlmKey(db, row.project_id, 'anthropic')
  if (!anthropic) return { scanned: deps.length, created: 0, skipped: 'no_llm_key' }

  // Best-effort scrape changelog for first 3 deps with a likely upstream URL.
  // The model gets either real release-notes or a single-line "no changelog".
  const releaseNotes: Array<{ name: string; notes: string }> = []
  for (const dep of deps.slice(0, 3)) {
    const guesses = guessChangelogUrls(manifestKind, dep.name)
    for (const url of guesses.slice(0, 2)) {
      try {
        const scraped = await firecrawlScrape(db, row.project_id, url)
        const md = scraped.markdown.slice(0, 4000)
        if (md.length > 200) {
          releaseNotes.push({ name: dep.name, notes: md })
          break
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === 'FIRECRAWL_NOT_CONFIGURED') {
          // No firecrawl key → fall back to manifest-only LLM analysis.
          break
        }
        if (msg !== 'FIRECRAWL_DOMAIN_NOT_ALLOWED' && msg !== 'FIRECRAWL_HTTP_404') {
          log.warn('firecrawl scrape failed', { dep: dep.name, error: msg })
        }
      }
    }
  }

  const client = createAnthropic({ apiKey: anthropic.key })
  let model: ReturnType<typeof client>
  try {
    model = client(MODERNIZER_MODEL)
  } catch (err) {
    log.warn('anthropic client init failed', { error: String(err).slice(0, 200) })
    return { scanned: deps.length, created: 0, skipped: 'llm_init_failed' }
  }

  let plan: z.infer<typeof findingSchema>
  try {
    const result = await generateObject({
      model,
      schema: findingSchema,
      system: `You are a senior dependency auditor. Identify which of the provided top-level dependencies look materially behind their latest stable release. Use the optional release-notes excerpts to set severity. Mark security CVEs as 'security'; deprecated/yanked packages as 'deprecated'; otherwise 'major' (breaking) vs 'minor'. Return at most 8 findings — only flag genuinely actionable ones.`,
      prompt: `Manifest: ${manifestPath} (${manifestKind})\n\nDependencies:\n${deps.map((d) => `- ${d.name}@${d.version}`).join('\n')}\n\nRelease-notes excerpts (best-effort web scrape, may be empty):\n${releaseNotes.map((n) => `### ${n.name}\n${n.notes}`).join('\n\n') || '(no excerpts available — base your judgement on the version strings only)'}`,
      maxTokens: 2_000,
    })
    plan = result.object
  } catch (err) {
    log.warn('LLM call failed for modernizer', { repo: row.repo_url, error: String(err).slice(0, 200) })
    return { scanned: deps.length, created: 0, skipped: 'llm_failed' }
  }

  let created = 0
  for (const f of plan.findings) {
    const { error: insErr, data: insData } = await db
      .from('modernization_findings')
      .upsert({
        project_id: row.project_id,
        repo_id: row.repo_id,
        dep_name: f.name,
        current_version: f.currentVersion,
        suggested_version: f.suggestedVersion,
        manifest_path: manifestPath,
        summary: f.summary,
        severity: f.severity,
        changelog_url: f.changelogUrl ?? null,
      }, { onConflict: 'project_id,repo_id,dep_name,suggested_version', ignoreDuplicates: true })
      .select('id, related_report_id, status')
      .maybeSingle()

    if (insErr) {
      log.warn('finding insert failed', { dep: f.name, error: insErr.message })
      continue
    }
    if (!insData) continue

    if (!insData.related_report_id && (f.severity === 'security' || f.severity === 'major' || f.severity === 'deprecated')) {
      const { data: report } = await db.from('reports').insert({
        project_id: row.project_id,
        category: 'other',
        description: `[Library Modernization] ${f.name} ${f.currentVersion} → ${f.suggestedVersion}\n\n${f.summary}`,
        summary: `Update ${f.name} (${f.severity})`,
        component: f.name,
        severity: f.severity === 'security' ? 'high' : 'medium',
        status: 'classified',
        confidence: 0.9,
        bug_ontology_tags: ['modernization', f.severity],
        reporter_token_hash: 'cron:library-modernizer',
        environment: { source: 'library-modernizer', changelogUrl: f.changelogUrl ?? null },
      }).select('id').maybeSingle()

      if (report) {
        await db
          .from('modernization_findings')
          .update({ related_report_id: report.id })
          .eq('id', insData.id)
      }
    }
    created++
  }

  return { scanned: deps.length, created, skipped: null }
}

function guessChangelogUrls(kind: ManifestKind, name: string): string[] {
  if (kind === 'package.json') {
    const safeName = name.replace(/^@/, '').replace('/', '-')
    return [
      `https://www.npmjs.com/package/${name}`,
      `https://github.com/${safeName}/releases`,
    ]
  }
  if (kind === 'requirements.txt' || kind === 'pyproject.toml') {
    return [`https://pypi.org/project/${name}/`]
  }
  if (kind === 'Cargo.toml') {
    return [`https://crates.io/crates/${name}`]
  }
  if (kind === 'go.mod') {
    return [`https://pkg.go.dev/${name}`]
  }
  return []
}

app.get('/library-modernizer/health', (c) => c.json({ ok: true }))

app.post('/library-modernizer', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized
  const db = getDb()

  const { data: rows, error } = await db
    .from('project_repos')
    .select('project_id, id, repo_url, default_branch, indexing_enabled')
    .eq('is_primary', true)
    .eq('indexing_enabled', true)
    .limit(50)

  if (error) {
    log.error('project_repos query failed', { error: error.message })
    return c.json({ ok: false, error: error.message }, 500)
  }

  const summary: Array<{ projectId: string; repoId: string; scanned: number; created: number; skipped: string | null }> = []
  for (const r of rows ?? []) {
    try {
      const result = await processRepo(db, {
        project_id: r.project_id,
        repo_id: r.id,
        repo_url: r.repo_url,
        default_branch: r.default_branch ?? 'main',
      })
      summary.push({ projectId: r.project_id, repoId: r.id, ...result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('repo processing failed', { repoId: r.id, error: msg })
      summary.push({ projectId: r.project_id, repoId: r.id, scanned: 0, created: 0, skipped: `error:${msg.slice(0, 80)}` })
    }
  }

  return c.json({ ok: true, processed: summary.length, results: summary })
})

Deno.serve(app.fetch)
