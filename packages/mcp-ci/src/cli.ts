#!/usr/bin/env node
import * as core from '@actions/core'

/**
 * Wave G2 — GitHub Action entrypoint.
 *
 * Intentionally NOT a full MCP client. The Action runs in a short-lived CI
 * job where spinning up an MCP server + stdio transport would add latency
 * for zero benefit. We hit the same REST endpoints the MCP tools call
 * (`/v1/admin/*`) directly, forward the result, and fail/pass the step.
 *
 * If a user wants the full MCP experience in CI, they install the
 * `@mushi-mushi/mcp` npm package and talk to it over stdio from their own
 * Claude Code / Codex CLI step. This Action is the 80% glue path: "hey CI,
 * block merging until Mushi finishes triaging my reports".
 */

interface ApiResp<T = unknown> { ok: boolean; data?: T; error?: { code: string; message: string } }

async function api<T>(endpoint: string, apiKey: string, projectId: string, path: string, init?: RequestInit): Promise<ApiResp<T>> {
  const res = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': apiKey,
      'X-Mushi-Project': projectId,
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: ApiResp<T>
  try { body = JSON.parse(text) as ApiResp<T> } catch { body = { ok: false, error: { code: `HTTP_${res.status}`, message: text.slice(0, 500) } } }
  return body
}

async function main(): Promise<void> {
  const apiKey = core.getInput('api-key', { required: true })
  const projectId = core.getInput('project-id', { required: true })
  const endpoint = core.getInput('api-endpoint').replace(/\/$/, '')
  const command = core.getInput('command', { required: true })
  const failOnQuota = core.getInput('fail-on-quota') !== 'false'

  switch (command) {
    case 'trigger-judge': {
      const res = await api(endpoint, apiKey, projectId, '/v1/admin/judge/run', {
        method: 'POST',
        body: JSON.stringify({ limit: 50, projectId }),
      })
      handleResult(res, failOnQuota)
      break
    }
    case 'dispatch-fix': {
      const reportId = core.getInput('report-id', { required: true })
      const res = await api(endpoint, apiKey, projectId, '/v1/admin/fixes/dispatch', {
        method: 'POST',
        body: JSON.stringify({ reportId }),
      })
      handleResult(res, failOnQuota)
      break
    }
    case 'check-coverage': {
      const minCoverage = Number(core.getInput('min-coverage') || '0.8')
      const res = await api<{ total: number; classified: number }>(endpoint, apiKey, projectId, '/v1/admin/stats')
      if (!res.ok || !res.data) {
        core.setFailed(`stats query failed: ${res.error?.message ?? 'unknown'}`)
        return
      }
      const ratio = res.data.total === 0 ? 1 : res.data.classified / res.data.total
      core.setOutput('coverage', ratio.toFixed(3))
      core.setOutput('result', JSON.stringify(res.data))
      if (ratio < minCoverage) {
        core.setFailed(`classification coverage ${ratio.toFixed(3)} below threshold ${minCoverage}`)
      } else {
        core.info(`classification coverage ${ratio.toFixed(3)} >= ${minCoverage} ✓`)
      }
      break
    }
    case 'query': {
      const question = core.getInput('question', { required: true })
      const res = await api(endpoint, apiKey, projectId, '/v1/admin/query', {
        method: 'POST',
        body: JSON.stringify({ question }),
      })
      handleResult(res, failOnQuota)
      break
    }
    case 'discover-api': {
      // Mushi v2 Gate 3 helper — walk the customer repo for Next.js
      // route handlers + OpenAPI + (optionally) Supabase introspection
      // and POST the resulting `discovered_apis` to the inventory-gates
      // function. The next gates run consumes this blob to compute the
      // api_contract diff.
      const { discoverRoutes } = await import('./api-contract.js')
      const repoRoot = core.getInput('repo-root') || process.cwd()
      const openapiFile = core.getInput('openapi-file') || undefined
      const supabaseUrl = core.getInput('supabase-url') || undefined
      const supabaseAnonKey = core.getInput('supabase-anon-key') || undefined
      const routes = await discoverRoutes({
        repoRoot,
        openapiFile,
        supabaseUrl,
        supabaseAnonKey,
      })
      core.info(`Discovered ${routes.length} routes`)
      core.setOutput('result', JSON.stringify({ routes }))
      // Persist as a synthetic crawl summary so Gate 3 picks it up
      // without needing a real crawl run.
      const persist = await api(
        endpoint,
        apiKey,
        projectId,
        `/v1/admin/inventory/${projectId}/gates/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            gates: ['api_contract'],
            findings: [],
            commit_sha: process.env.GITHUB_SHA,
            discovered_apis: routes,
          }),
        },
      )
      handleResult(persist, failOnQuota)
      break
    }
    case 'gates': {
      // Mushi v2: run all five pre-release gates against the current
      // commit and post a single composite GitHub status.
      //
      // Gates 1 + 2 (lint) run inside this Action's checkout; Gates 3
      // + 4 + 5 are server-side and reachable via /v1/admin/inventory.
      // The Action then reads back the consolidated gate_runs and
      // sets a single pass/fail on the calling workflow.
      const commitSha = core.getInput('commit-sha') || process.env.GITHUB_SHA || ''
      const prNumber = core.getInput('pr-number') || ''
      const gatesArg = core.getInput('gates') || 'all'
      const gates =
        gatesArg === 'all'
          ? ['dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim']
          : gatesArg.split(',').map((g) => g.trim()).filter(Boolean)

      const body = {
        commit_sha: commitSha || undefined,
        pr_number: prNumber ? Number(prNumber) : undefined,
        gates,
      }
      const res = await api<{
        runs: Array<{ gate: string; status: string; findings_count: number }>
      }>(
        endpoint,
        apiKey,
        projectId,
        `/v1/admin/inventory/${projectId}/gates/run`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      core.setOutput('result', JSON.stringify(res))
      if (!res.ok) {
        if (res.error?.code === 'QUOTA_EXCEEDED' && !failOnQuota) {
          core.warning(`quota exceeded, skipping: ${res.error?.message}`)
          break
        }
        core.setFailed(`gates run failed: ${res.error?.code ?? 'unknown'} ${res.error?.message ?? ''}`)
        break
      }
      const runs = res.data?.runs ?? []
      const failed = runs.filter((r) => r.status === 'fail')
      const warned = runs.filter((r) => r.status === 'warn')
      const summary = runs
        .map((r) => `${gateGlyph(r.status)} ${r.gate} (${r.findings_count})`)
        .join(' · ')
      core.info(`Mushi gates: ${summary}`)
      if (failed.length > 0) {
        core.setFailed(
          `Mushi gate failures: ${failed.map((r) => r.gate).join(', ')}. ` +
            `View details on /inventory in the admin console.`,
        )
      } else if (warned.length > 0) {
        core.warning(`Mushi gate warnings: ${warned.map((r) => r.gate).join(', ')}.`)
      }
      break
    }
    case 'discovery-status': {
      // Mushi v2.1 — read out how much SDK passive-discovery data the
      // server has. Useful in CI to gate "should we propose yet?".
      const res = await api<{
        routes: unknown[]
        total_events: number
        ready_to_propose: boolean
      }>(endpoint, apiKey, projectId, `/v1/admin/inventory/${projectId}/discovery`)
      core.setOutput('result', JSON.stringify(res))
      if (!res.ok) {
        core.setFailed(`discovery-status failed: ${res.error?.code ?? 'unknown'}`)
        break
      }
      const ready = res.data?.ready_to_propose ?? false
      core.setOutput('ready_to_propose', String(ready))
      core.setOutput('total_events', String(res.data?.total_events ?? 0))
      core.setOutput('route_count', String((res.data?.routes ?? []).length))
      core.info(
        `Mushi discovery: ${res.data?.total_events ?? 0} events across ${(res.data?.routes ?? []).length} routes; ${ready ? 'ready to propose' : 'not yet ready'}.`,
      )
      break
    }
    case 'propose': {
      // Mushi v2.1 — kick off the LLM proposer. Synchronous: returns
      // the proposalId so a follow-up step can comment on the PR.
      const res = await api<{ proposalId: string; storyCount: number; pageCount: number }>(
        endpoint,
        apiKey,
        projectId,
        `/v1/admin/inventory/${projectId}/propose`,
        { method: 'POST', body: '{}' },
      )
      handleResult(res, failOnQuota)
      if (res.ok && res.data) {
        core.info(
          `Mushi proposed ${res.data.storyCount} stories / ${res.data.pageCount} pages — open /inventory ▸ Discovery to review.`,
        )
        core.setOutput('proposal_id', res.data.proposalId)
      }
      break
    }
    case 'auth-bootstrap': {
      // Mushi v2.1 — refresh the crawler cookie via the scripted-auth
      // runner. We don't run Playwright inside this Action's process
      // (browsers add ~600 MB to the image); instead we invoke the
      // published @mushi-mushi/inventory-auth-runner via `npx`. The
      // runner POSTs the cookie back to the settings endpoint we
      // expose; this Action just orchestrates.
      //
      // The bin name (`mushi-mushi-auth`) intentionally differs from
      // the unscoped package name (`inventory-auth-runner`), so we use
      // `-p <package> <bin>` instead of the bare `npx <package>` form
      // — the bare form would fail with `command not found` because
      // npx tries to invoke a bin that matches the unscoped name.
      const cmd = `npx --yes -p @mushi-mushi/inventory-auth-runner mushi-mushi-auth refresh`
      core.info(`mushi auth-bootstrap → ${cmd}`)
      const env = {
        ...process.env,
        MUSHI_API_KEY: apiKey,
        MUSHI_PROJECT: projectId,
        MUSHI_API_ENDPOINT: endpoint,
      }
      const { spawnSync } = await import('node:child_process')
      const res = spawnSync(cmd, { shell: true, env, stdio: 'inherit' })
      if ((res.status ?? 0) !== 0) {
        core.setFailed(`auth-bootstrap failed (exit ${res.status})`)
      } else {
        core.info('auth-bootstrap: cookie refreshed.')
      }
      break
    }
    default:
      core.setFailed(
        `unknown command: ${command}. Expected trigger-judge | dispatch-fix | check-coverage | query | gates | discover-api | discovery-status | propose | auth-bootstrap.`,
      )
  }
}

function gateGlyph(status: string): string {
  if (status === 'pass') return '✅'
  if (status === 'fail') return '❌'
  if (status === 'warn') return '⚠️'
  if (status === 'skipped') return '⏭️'
  return '⏺️'
}

function handleResult(res: ApiResp<unknown>, failOnQuota: boolean): void {
  core.setOutput('result', JSON.stringify(res))
  if (!res.ok) {
    if (res.error?.code === 'QUOTA_EXCEEDED' && !failOnQuota) {
      core.warning(`quota exceeded, skipping: ${res.error?.message}`)
      return
    }
    core.setFailed(`${res.error?.code ?? 'ERROR'}: ${res.error?.message ?? 'unknown'}`)
    return
  }
  core.info(`Mushi ok: ${JSON.stringify(res.data).slice(0, 500)}`)
}

main().catch((err) => {
  core.setFailed((err as Error).message)
})
