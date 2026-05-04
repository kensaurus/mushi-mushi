// test-gen-from-report — report → Playwright spec + draft PR (whitepaper §4.5)
//
// Invoked from `api` POST …/test-gen/from-report/:reportId with the service-role
// bearer. Loads the report + GitHub repo settings, asks the project BYOK LLM for
// a single new Playwright test file, then opens a draft PR via GitHub REST
// (same transport pattern as fix-worker — no Octokit in Deno).

import { generateObject, NoObjectGeneratedError } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { z } from 'npm:zod@3'

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { STAGE2_FALLBACK, STAGE2_MODEL } from '../_shared/models.ts'
import { logAudit } from '../_shared/audit.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const log = rootLog.child('test-gen-from-report')

const testGenSchema = z.object({
  path: z.string().describe('Repo-relative path for the new test file, under tests/ or e2e/'),
  contents: z.string().describe('Full TypeScript source for a Playwright test'),
  summary: z.string().max(200).describe('One-line PR title fragment'),
  rationale: z.string().describe('Why this test covers the report'),
  needsHumanReview: z.boolean().describe('True when selectors or flow are uncertain'),
})

type TestGenOutput = z.infer<typeof testGenSchema>

const SYSTEM_PROMPT = `You are a senior test engineer writing a Playwright regression test from a bug report.

Rules:
1. Output exactly ONE test file in TypeScript using @playwright/test.
2. Prefer role- and text-based selectors; use data-testid only when the report's environment provides nearest_testid.
3. The test should fail on the reported bug and pass once the product is fixed — assert something concrete (visible copy, URL, or network).
4. Never hardcode secrets, tokens, or production passwords. Use test.only / .skip only if the user must supply credentials — default to a normal test.
5. Keep the file self-contained: import test, expect from '@playwright/test', use a relative baseURL pattern or process.env.BASE_URL if needed.
6. Do NOT emit placeholders like "TODO" as the entire test body — write a real flow or set needsHumanReview=true with a minimal skeleton.`

const SECRET_PATTERNS = [
  /sk-(ant-|or-|proj-|live-)?[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
  /AKIA[A-Z0-9]{16}/,
]

function containsObviousSecret(content: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(content))
}

interface Body {
  project_id?: string
  report_id?: string
  triggered_by?: string
}

interface ResolvedRepo {
  owner: string
  repo: string
  defaultBranch: string
  scopeDirectory?: string
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const cleaned = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

async function resolveRepo(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  settings: Record<string, unknown> | null,
): Promise<ResolvedRepo | null> {
  const { data: primaryRepo } = await db
    .from('project_repos')
    .select('repo_url, default_branch, path_globs')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()

  const url =
    primaryRepo?.repo_url ??
    (settings?.github_repo_url as string | undefined) ??
    (settings?.codebase_repo_url as string | undefined) ??
    ''
  if (!url) return null
  const parsed = parseGithubUrl(url)
  if (!parsed) return null
  const globs = (primaryRepo?.path_globs as string[] | null) ?? null
  const scopeDirectory =
    globs && globs.length > 0 && typeof globs[0] === 'string'
      ? globs[0].replace(/\/\*\*?$/, '').replace(/^\.?\//, '')
      : undefined

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch: primaryRepo?.default_branch ?? 'main',
    scopeDirectory,
  }
}

const TEST_PATH_PATTERNS = [/__tests__\//, /\.test\./, /\.spec\./, /^test\//, /^tests\//, /^e2e\//]

function isAllowedTestPath(filePath: string, scopeDir: string | undefined): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  // Tests usually live at repo root (e2e/, tests/) — always allow recognized
  // test paths even when `path_globs` scopes app source to a subdirectory.
  if (TEST_PATH_PATTERNS.some((p) => p.test(normalized))) return true
  if (!scopeDir) return false
  return normalized.startsWith(scopeDir.replace(/\\/g, '/'))
}

async function resolveGithubToken(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!error && data?.github_installation_token_ref) {
    const ref = String(data.github_installation_token_ref)
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length)
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id })
      if (!vaultErr && typeof secret === 'string' && secret.length > 0) return secret
    } else if (ref.length > 0) return ref
  }
  return Deno.env.get('GITHUB_TOKEN') ?? null
}

function buildUserPrompt(report: Record<string, unknown>, repo: ResolvedRepo): string {
  const env = (report.environment ?? {}) as Record<string, unknown>
  const repro = (report.reproduction_steps ?? []) as string[]
  const classification = report.classification ?? null

  return `## Bug report
id: ${report.id}
summary: ${report.summary ?? '(none)'}
description: ${report.description ?? '(none)'}
category: ${report.category} | severity: ${report.severity ?? 'n/a'}
component: ${report.component ?? 'n/a'}

## Stage 2
${JSON.stringify(report.stage2_analysis ?? {}, null, 2)}

## Reproduction steps
${repro.length > 0 ? repro.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none)'}

## Capture environment (JSON)
${JSON.stringify(env, null, 2)}

## Classification (graph / triage hints)
${JSON.stringify(classification, null, 2)}

## Target repository
${repo.owner}/${repo.repo} (default: ${repo.defaultBranch})
${repo.scopeDirectory ? `Scope directory prefix for app code: ${repo.scopeDirectory} — place tests under tests/ or e2e/ at repo root unless the repo clearly uses another convention.` : ''}

## Task
Write one Playwright spec that reproduces this bug. Prefer stable selectors from nearest_testid or role-based queries.`
}

async function ghFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub ${init.method ?? 'GET'} ${url} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function ghFetchOptional(url: string, init: RequestInit): Promise<unknown | null> {
  const res = await fetch(url, init)
  if (res.status === 404) return null
  if (!res.ok) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

interface PrResult {
  url: string
  number: number
  branch: string
}

async function createTestGenPr(input: {
  token: string
  owner: string
  repo: string
  defaultBranch: string
  reportId: string
  out: TestGenOutput
}): Promise<PrResult> {
  const { token, owner, repo, defaultBranch, reportId, out } = input
  const branch = `mushi/test-gen-${reportId.slice(0, 8)}-${Date.now().toString(36)}`

  const baseHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi-test-gen/1.0',
  }

  const refRes = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
    { headers: baseHeaders },
  )
  const baseSha = (refRes as { object: { sha: string } }).object.sha

  await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  })

  const existing = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(out.path)}?ref=${encodeURIComponent(branch)}`,
    { headers: baseHeaders },
  )
  const existingSha =
    existing && typeof (existing as Record<string, unknown>).sha === 'string'
      ? (existing as { sha: string }).sha
      : undefined

  await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(out.path)}`,
    {
      method: 'PUT',
      headers: baseHeaders,
      body: JSON.stringify({
        message: `test: ${out.summary}`,
        content: btoa(unescape(encodeURIComponent(out.contents))),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  )

  const title = `test: ${out.summary.trim()}`.slice(0, 240)
  const reviewBanner = out.needsHumanReview
    ? '> ⚠️ **The test generator flagged this PR for human review** — verify selectors and assertions.\n\n'
    : ''
  const body =
    `${reviewBanner}## Mushi Mushi — test from report \`${reportId}\`\n\n${out.rationale}\n\n---\n*Generated by Mushi test-gen-from-report. Review before merging.*`

  const prRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      title,
      head: branch,
      base: defaultBranch,
      draft: true,
      body,
    }),
  }) as { number: number; html_url: string }

  await ghFetchOptional(`https://api.github.com/repos/${owner}/${repo}/issues/${prRes.number}/labels`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ labels: ['mushi-test-gen'] }),
  })

  return { url: prRes.html_url, number: prRes.number, branch }
}

async function handler(req: Request): Promise<Response> {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  let body: Body
  try {
    const raw: unknown = await req.json()
    body = raw as Body
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'BAD_JSON', message: 'Body must be JSON' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  const reportId = typeof body.report_id === 'string' ? body.report_id : ''
  const triggeredBy = typeof body.triggered_by === 'string' ? body.triggered_by : 'system'

  if (!projectId || !reportId) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'VALIDATION', message: 'project_id and report_id required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const db = getServiceClient()

  const [{ data: report, error: reportErr }, { data: settings }] = await Promise.all([
    db
      .from('reports')
      .select(
        'id, project_id, description, summary, category, severity, component, classification, ' +
          'stage2_analysis, reproduction_steps, environment',
      )
      .eq('id', reportId)
      .eq('project_id', projectId)
      .maybeSingle(),
    db
      .from('project_settings')
      .select('github_repo_url, codebase_repo_url, stage2_model')
      .eq('project_id', projectId)
      .maybeSingle(),
  ])

  if (reportErr || !report) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found for project' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const repo = await resolveRepo(db, projectId, settings as Record<string, unknown> | null)
  if (!repo) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'NO_REPO', message: 'No GitHub repository configured for this project' },
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const token = await resolveGithubToken(db, projectId)
  if (!token) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'NO_GITHUB_TOKEN', message: 'GitHub token not configured' },
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const anthropicResolved = await resolveLlmKey(db, projectId, 'anthropic')
  const openaiResolved = await resolveLlmKey(db, projectId, 'openai')
  if (!anthropicResolved && !openaiResolved) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'NO_LLM',
          message: 'No Anthropic or OpenAI BYOK key configured for this project',
        },
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const modelId =
    typeof settings?.stage2_model === 'string' && settings.stage2_model.length > 0
      ? settings.stage2_model
      : STAGE2_MODEL

  let generated: TestGenOutput
  try {
    if (anthropicResolved) {
      const anthropic = createAnthropic({ apiKey: anthropicResolved.key })
      const result = await generateObject({
        model: anthropic(modelId),
        schema: testGenSchema,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(report as Record<string, unknown>, repo),
        maxRetries: 1,
      })
      generated = result.object
    } else {
      const openai = createOpenAI({
        apiKey: openaiResolved!.key,
        ...(openaiResolved!.baseUrl ? { baseURL: openaiResolved!.baseUrl } : {}),
      })
      const result = await generateObject({
        model: openai(STAGE2_FALLBACK),
        schema: testGenSchema,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(report as Record<string, unknown>, repo),
        maxRetries: 1,
      })
      generated = result.object
    }
  } catch (err) {
    const msg = err instanceof NoObjectGeneratedError
      ? err.message
      : err instanceof Error
      ? err.message
      : String(err)
    log.error('LLM test generation failed', { reportId, projectId, msg })
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'LLM_FAILED', message: msg.slice(0, 500) } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (!isAllowedTestPath(generated.path, repo.scopeDirectory)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'PATH_REJECTED',
          message: 'Generated path must be a test file under tests/, e2e/, or **/*.(spec|test).ts',
        },
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (containsObviousSecret(generated.contents)) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'SECRET_PATTERN', message: 'Generated test matched secret heuristic' } }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const pr = await createTestGenPr({
      token,
      owner: repo.owner,
      repo: repo.repo,
      defaultBranch: repo.defaultBranch,
      reportId,
      out: generated,
    })

    await logAudit(db, projectId, triggeredBy, 'inventory.test_gen', 'report', reportId, {
      pr_url: pr.url,
      path: generated.path,
      branch: pr.branch,
    })

    return new Response(
      JSON.stringify({
        ok: true,
        data: { prUrl: pr.url, prNumber: pr.number, branch: pr.branch, path: generated.path },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('PR creation failed', { reportId, msg })
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'GITHUB_ERROR', message: msg.slice(0, 500) } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('test-gen-from-report', handler))
}
