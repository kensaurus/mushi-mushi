/**
 * test-gen-from-story — User story → Playwright spec + qa_stories row + draft PR
 *
 * Triggered via POST /v1/admin/inventory/:pid/stories/:storyId/generate-test
 *
 * Flow:
 *   1. Load the user story from the project's accepted inventory
 *   2. Ask Claude/GPT to write a Playwright TypeScript test for the story
 *   3. Open a draft GitHub PR (same transport as fix-worker)
 *   4. Insert a qa_stories row with source='test_gen_from_story'
 *      and approval_status driven by the story's automation_mode
 */

import { generateObject } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { z } from 'npm:zod@3'

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withAnthropicOrOpenAi, LlmFailoverError } from '../_shared/llm-failover.ts'
import { STAGE2_MODEL, STAGE2_FALLBACK } from '../_shared/models.ts'
import { logAudit } from '../_shared/audit.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const log = rootLog.child('test-gen-from-story')

const testGenSchema = z.object({
  path: z.string().describe('Repo-relative path for the test file, e.g. tests/user-story-name.spec.ts'),
  contents: z.string().describe('Full TypeScript Playwright test source'),
  firecrawl_actions: z.string().optional().describe('Equivalent Firecrawl Actions YAML for cloud execution'),
  summary: z.string().max(200).describe('One-line PR title fragment'),
  rationale: z.string().describe('Why this test covers the user story'),
  needsHumanReview: z.boolean().describe('True when selectors or flow are uncertain'),
})

const SYSTEM_PROMPT = `You are a senior test engineer writing a Playwright TDD test from a user story.

User stories follow the inventory.yaml schema:
- id: slug identifier
- title: human title  
- goal: what the user wants to achieve
- persona: who the user is
- pages: list of routes in the app

Rules:
1. Write ONE test file in TypeScript using @playwright/test.
2. The test should verify the user story's goal end-to-end.
3. Use data-testid selectors where provided; fall back to role/text selectors.
4. Structure as: setup → navigate → interact → assert (AAA pattern).
5. Keep it executable: use process.env.BASE_URL or a configurable baseURL.
6. ALSO produce firecrawl_actions YAML that runs the same flow in Firecrawl cloud.
7. Set needsHumanReview=true when the page routes or selectors are unknown.
8. Never hardcode passwords, tokens, or secrets.`

const SECRET_PATTERNS = [
  /sk-(ant-|or-|proj-|live-)?[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
  /AKIA[A-Z0-9]{16}/,
]

function hasSecret(s: string) { return SECRET_PATTERNS.some((p) => p.test(s)) }

interface Body {
  project_id?: string
  story_node_id?: string   // inventory user_story.id slug
  automation_mode?: 'auto' | 'review' | 'approve'
  base_url?: string
  open_pr?: boolean
}

interface UserStory {
  id: string
  title: string
  goal: string
  persona?: string
  pages?: string[]
  actions?: string[]
}

async function openGithubPr(opts: {
  token: string
  repoUrl: string
  path: string
  contents: string
  title: string
  summary: string
  storyId: string
}): Promise<string | null> {
  const { token, repoUrl, path, contents, title, summary, storyId } = opts

  const repoMatch = repoUrl.match(/github\.com\/([\w.-]+\/[\w.-]+)/)
  if (!repoMatch) return null
  const repo = repoMatch[1]!.replace(/\.git$/, '')
  const branch = `mushi/test-gen-story-${storyId}-${Date.now()}`
  const apiBase = `https://api.github.com/repos/${repo}`
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-mushi-test-gen-from-story/1.0',
  }

  // Resolve the repo's actual default branch — never assume 'main'. Repos on
  // 'master' (or any custom default) would otherwise 404 on the ref lookup.
  const repoRes = await fetch(apiBase, { headers })
  if (!repoRes.ok) return null
  const { default_branch: defaultBranch } = await repoRes.json() as { default_branch: string }

  // Resolve the default-branch tip SHA so we can branch from it.
  const refRes = await fetch(`${apiBase}/git/ref/heads/${defaultBranch}`, { headers })
  if (!refRes.ok) return null
  const { object: { sha: baseSha } } = await refRes.json() as { object: { sha: string } }

  // Create the working branch from the tip.
  const branchRes = await fetch(`${apiBase}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  })
  if (!branchRes.ok) return null

  // Commit the file via the Contents API (same transport as fix-worker). This
  // sidesteps the blob/tree/commit dance — and the base_tree-must-be-a-tree-SHA
  // pitfall — entirely. `content` must be base64 (utf-8 safe).
  //
  // The Contents API PUT requires the existing file's blob SHA when the path
  // already exists on the branch (e.g. the file was present on the default
  // branch and the new branch inherits it, or a retry runs against a branch
  // that already has the file). Without the SHA the request returns 422. We
  // GET first; a 404 means it's a create (no SHA needed), anything else means
  // it's an update and we include the SHA from the response.
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const existingRes = await fetch(`${apiBase}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, { headers })
  let existingSha: string | undefined
  if (existingRes.ok) {
    const existingData = await existingRes.json() as { sha?: string }
    existingSha = existingData.sha
  }

  const putRes = await fetch(`${apiBase}/contents/${encodedPath}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `test: ${title}`,
      content: btoa(unescape(encodeURIComponent(contents))),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  })
  if (!putRes.ok) return null

  // Open the draft PR against the resolved default branch.
  const prRes = await fetch(`${apiBase}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `🧪 TDD: ${title}`,
      body: `## Generated by Mushi TDD\n\n${summary}\n\n> Auto-generated from user story \`${storyId}\` — review before merging.`,
      head: branch,
      base: defaultBranch,
      draft: true,
    }),
  })
  if (!prRes.ok) return null
  const { html_url } = await prRes.json() as { html_url: string }
  return html_url
}

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({})) as Partial<Body>

    const {
      project_id,
      story_node_id,
      automation_mode = 'review',
      base_url,
      open_pr = true,
    } = body

    if (!project_id || !story_node_id) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'MISSING_PARAMS', message: 'project_id and story_node_id are required' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    log.info('test-gen-from-story started', { project_id, story_node_id, automation_mode })

    // Load the accepted inventory for this project
    const { data: inventoryRow } = await db
      .from('inventories')
      .select('parsed')
      .eq('project_id', project_id)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const parsed = inventoryRow?.parsed as Record<string, unknown> | undefined
    const userStories = (parsed?.user_stories ?? []) as UserStory[]
    const story = userStories.find((s) => s.id === story_node_id)

    if (!story) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'STORY_NOT_FOUND', message: `No accepted inventory with story id '${story_node_id}'` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const pages = parsed?.pages as { id: string; route: string; title?: string }[] | undefined
    const storyPages = story.pages
      ? pages?.filter((p) => story.pages!.includes(p.id)) ?? []
      : []

    const appBaseUrl = base_url ?? (parsed?.app as Record<string, string> | undefined)?.base_url ?? 'http://localhost:3000'

    const prompt = `User Story:
id: ${story.id}
title: ${story.title}
goal: ${story.goal}
persona: ${story.persona ?? 'end user'}
routes: ${storyPages.map((p) => `${p.route} (${p.title ?? ''})`).join(', ') || 'see goal'}
base_url: ${appBaseUrl}
${story.actions?.length ? `actions: ${story.actions.join(', ')}` : ''}

Write a comprehensive Playwright TDD test for this user story.`

    let output: z.infer<typeof testGenSchema>
    try {
      // withAnthropicOrOpenAi takes TWO separate callbacks (anthropicFn,
      // openAiFn) and returns { result, usedProvider }. Each callback receives
      // exactly one ResolvedKey from its own provider pool.
      const { result } = await withAnthropicOrOpenAi(
        db,
        project_id,
        async (anthropicKey) => {
          const { object } = await generateObject({
            model: createAnthropic({ apiKey: anthropicKey.key })(STAGE2_MODEL),
            system: SYSTEM_PROMPT,
            prompt,
            schema: testGenSchema,
            maxTokens: 8000,
          })
          return object
        },
        async (openaiKey) => {
          const { object } = await generateObject({
            model: createOpenAI({ apiKey: openaiKey.key })(STAGE2_FALLBACK, { structuredOutputs: false }),
            system: SYSTEM_PROMPT,
            prompt,
            schema: testGenSchema,
            maxTokens: 8000,
          })
          return object
        },
      )
      output = result
    } catch (err) {
      // Log the raw error server-side, but never echo err.message to the
      // client — raw messages can leak internals (CodeQL js/stack-trace-exposure).
      const detail = err instanceof Error ? err.message : String(err)
      log.error('test-gen-from-story LLM failed', { project_id, error: detail })
      const message = err instanceof LlmFailoverError
        ? 'All LLM keys exhausted. Add backup keys in Settings → API Key Pool.'
        : 'Test generation failed. See server logs for details.'
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'LLM_FAILED', message } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Scan BOTH the test source and the firecrawl_actions YAML — the latter
    // is returned to the caller and executed in Firecrawl cloud, so a leaked
    // secret there is just as dangerous as one in the test body.
    if (hasSecret(output.contents) || (output.firecrawl_actions ? hasSecret(output.firecrawl_actions) : false)) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'SECRET_DETECTED', message: 'LLM emitted a secret in generated code — aborted.' } }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Insert qa_stories row
    const approvalStatus = automation_mode === 'auto' ? 'approved' : 'pending_review'
    const { data: qaStory, error: qaErr } = await db
      .from('qa_stories')
      .insert({
        project_id,
        name: story.title,
        prompt: story.goal,
        script: output.contents,
        script_lang: 'playwright-ts',
        browser_provider: 'local',
        source: 'test_gen_from_story',
        approval_status: approvalStatus,
        automation_mode,
        origin_story_node_id: story.id,
        generation_model: STAGE2_MODEL,
        enabled: automation_mode === 'auto',
      })
      .select('id')
      .single()

    // A failed insert must be fatal: without a qa_stories row the approval /
    // runner flows have nothing to act on, so returning ok:true (and possibly
    // opening a PR) would leave the system in an inconsistent state.
    if (qaErr || !qaStory) {
      log.error('Failed to insert qa_story', { project_id, story_node_id, error: qaErr?.message })
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'QA_STORY_INSERT_FAILED', message: 'Failed to persist the generated QA story.' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const qaStoryId = qaStory.id
    let prUrl: string | null = null

    // Open draft PR if requested
    if (open_pr) {
      try {
        const { data: settings } = await db
          .from('project_settings')
          .select('github_repo_url, github_access_token_ref')
          .eq('project_id', project_id)
          .maybeSingle()

        const repoUrl = settings?.github_repo_url as string | undefined
        const tokenRef = settings?.github_access_token_ref as string | undefined

        if (repoUrl && tokenRef) {
          const { data: secretData } = await db.rpc('vault_get_secret', { secret_id: tokenRef })
          const token = (secretData as string | undefined) ?? ''
          if (token) {
            prUrl = await openGithubPr({
              token,
              repoUrl,
              path: output.path,
              contents: output.contents,
              title: story.title,
              summary: output.summary,
              storyId: story.id,
            })
          }
        }
      } catch (err) {
        log.warn('PR creation failed (non-fatal)', { project_id, error: String(err).slice(0, 200) })
      }
    }

    // Update qa_story with PR url if available. Await + inspect error rather
    // than chaining `.catch` (PostgREST builders have no `.catch`).
    if (qaStoryId && prUrl) {
      const { error: prUpdateErr } = await db.from('qa_stories').update({ generated_pr_url: prUrl }).eq('id', qaStoryId)
      if (prUpdateErr) log.warn('failed to attach PR url to qa_story', { qaStoryId, error: prUpdateErr.message })
    }

    // System actor for automated (non-user) runs. actor_id is NOT NULL with no
    // FK, so a nil UUID is a safe sentinel that keeps these rows distinguishable
    // from real users when filtering the audit log.
    await logAudit(
      db,
      project_id,
      '00000000-0000-0000-0000-000000000000',
      'inventory.test_gen',
      'qa_story',
      qaStoryId ?? story_node_id,
      { story_node_id, automation_mode, approval_status: approvalStatus, pr_url: prUrl },
      { actorType: 'agent' },
    )

    log.info('test-gen-from-story complete', { project_id, story_node_id, qaStoryId, prUrl, approvalStatus })

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          qaStoryId,
          prUrl,
          approvalStatus,
          path: output.path,
          needsHumanReview: output.needsHumanReview,
          firecrawlActionsYaml: output.firecrawl_actions ?? null,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }),
)
