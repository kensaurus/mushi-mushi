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
    default:
      core.setFailed(`unknown command: ${command}. Expected trigger-judge | dispatch-fix | check-coverage | query.`)
  }
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
