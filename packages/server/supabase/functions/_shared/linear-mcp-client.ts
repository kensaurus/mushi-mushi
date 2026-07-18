// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Linear remote MCP client.
 *
 * Calls Linear's hosted MCP server at https://mcp.linear.app/mcp
 * (Streamable HTTP, MCP 2025-03-26) using the project's vault-backed
 * Linear OAuth token. Used by Mushi's classify-report, fix-worker, and
 * hosted MCP server to give agentic workers Linear tool access.
 *
 * See: https://linear.app/docs/mcp
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { getLinearToken } from './linear.ts'

const log = rootLog.child('linear-mcp-client')

const LINEAR_MCP_ENDPOINT = 'https://mcp.linear.app/mcp'

// ── MCP JSON-RPC types ────────────────────────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

interface McpResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

// ── Low-level call ────────────────────────────────────────────────────────────

/**
 * Makes a JSON-RPC request to Linear's hosted MCP server.
 * Uses the project's vault-backed OAuth access token (or static API key fallback).
 */
async function mcpRequest<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const reqBody: McpRequest = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method,
    ...(params !== undefined ? { params } : {}),
  }

  const res = await fetch(LINEAR_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(reqBody),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Linear MCP HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const contentType = res.headers.get('content-type') ?? ''

  // Streamable HTTP: may return SSE or plain JSON
  let rawBody: string
  if (contentType.includes('text/event-stream')) {
    // Collect all SSE data lines and join — the last non-empty data is the result
    rawBody = await res.text()
    const lines = rawBody.split('\n').filter((l) => l.startsWith('data: '))
    const last = lines[lines.length - 1]?.slice('data: '.length) ?? '{}'
    rawBody = last
  } else {
    rawBody = await res.text()
  }

  const json: McpResponse<T> = JSON.parse(rawBody)
  if (json.error) {
    throw new Error(`Linear MCP error ${json.error.code}: ${json.error.message}`)
  }
  if (json.result === undefined) {
    throw new Error('Linear MCP returned no result')
  }
  return json.result
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calls a named tool on Linear's remote MCP server, using the project's
 * vault-backed credentials. Returns null if no credentials are configured.
 */
export async function callLinearMcpTool<T = unknown>(
  db: SupabaseClient,
  projectId: string,
  toolName: string,
  toolArgs: Record<string, unknown> = {},
): Promise<T | null> {
  const token = await getLinearToken(db, projectId)
  if (!token) {
    log.warn('callLinearMcpTool: no Linear token configured', { projectId, toolName })
    return null
  }

  try {
    const result = await mcpRequest<{ content: Array<{ type: string; text: string }> }>(
      token,
      'tools/call',
      { name: toolName, arguments: toolArgs },
    )
    // MCP tool results are arrays of content blocks; extract the first text block
    const text = result?.content?.find((c) => c.type === 'text')?.text
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  } catch (err) {
    log.error('callLinearMcpTool failed', { projectId, toolName, err: String(err) })
    throw err
  }
}

// ── Convenience tool wrappers ─────────────────────────────────────────────────

export interface LinearIssueSearchResult {
  id: string
  identifier: string
  title: string
  state: { name: string; type: string }
  url: string
}

/**
 * Search Linear issues. Used by classify-report to find duplicate tickets
 * before creating a new one.
 */
export async function linearSearchIssues(
  db: SupabaseClient,
  projectId: string,
  query: string,
  teamId?: string,
): Promise<LinearIssueSearchResult[]> {
  const result = await callLinearMcpTool<LinearIssueSearchResult[]>(
    db,
    projectId,
    'linear_search_issues',
    { query, ...(teamId ? { teamId } : {}) },
  )
  return result ?? []
}

/**
 * Get a single Linear issue by identifier (e.g. "ENG-123").
 */
export async function linearGetIssue(
  db: SupabaseClient,
  projectId: string,
  issueIdentifier: string,
): Promise<LinearIssueSearchResult | null> {
  return callLinearMcpTool<LinearIssueSearchResult>(
    db,
    projectId,
    'linear_get_issue',
    { issueId: issueIdentifier },
  )
}

/**
 * Post a comment on a Linear issue.
 */
export async function linearCreateComment(
  db: SupabaseClient,
  projectId: string,
  issueId: string,
  body: string,
): Promise<void> {
  await callLinearMcpTool(db, projectId, 'linear_create_comment', { issueId, body })
}

/**
 * Update a Linear issue's status. `stateName` should match the workflow state name
 * (e.g. "In Progress", "Done").
 */
export async function linearUpdateIssueStatus(
  db: SupabaseClient,
  projectId: string,
  issueId: string,
  stateName: string,
): Promise<void> {
  await callLinearMcpTool(db, projectId, 'linear_update_issue_status', { issueId, stateName })
}
