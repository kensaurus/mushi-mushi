/**
 * FILE: packages/agents/src/adapters/mcp.ts
 * PURPOSE: True Model Context Protocol (MCP) client adapter (V5.3 §2.10, M7).
 *          Speaks JSON-RPC 2.0 with `tools/call` and supports SEP-1686 Tasks
 *          for long-running fix generation (poll via tasks/get, cancel via
 *          tasks/cancel).
 *
 *          Connects to any MCP-compliant fix-server (e.g. a self-hosted Claude
 *          Code wrapper, a Codex worker, or a custom in-house agent), as long
 *          as it exposes a `mushi.generate_fix` tool.
 *
 * REFERENCE:
 *   - JSON-RPC 2.0: https://www.jsonrpc.org/specification
 *   - MCP spec (2025-11): https://spec.modelcontextprotocol.io/
 *   - SEP-1686 Tasks:    https://github.com/modelcontextprotocol/specification/pull/1686
 *
 * The official @modelcontextprotocol/sdk client is loaded lazily so this file
 * imports cleanly even when the SDK is not installed in the consumer.
 */

import type { FixAgent, FixContext, FixResult } from '../types.js'
import { checkCircuitBreaker, checkFileScope } from '../scope.js'

export type McpTransport = 'http' | 'stdio'

export interface McpClientOptions {
  /** Base URL for the MCP server (Streamable HTTP transport). */
  serverUrl?: string
  /** Bearer token forwarded as Authorization header on the initial handshake. */
  bearer?: string
  /** Tool name on the server. Defaults to `mushi.generate_fix`. */
  toolName?: string
  /** Wall-clock cap (ms). For tasks-enabled servers, this caps the polling loop. */
  timeoutMs?: number
  /** Polling interval for tasks/get when the server returns a task id (SEP-1686). */
  pollIntervalMs?: number
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | string
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

interface ToolsCallResult {
  content?: Array<{ type: 'text'; text: string } | { type: 'json'; data: unknown }>
  isError?: boolean
  /** SEP-1686: server may return a long-running task instead of a final result. */
  task?: { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' }
}

interface TaskGetResult {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: ToolsCallResult
  error?: { code: number; message: string }
}

export class McpFixAgent implements FixAgent {
  name = 'mcp'
  private serverUrl: string
  private bearer?: string
  private toolName: string
  private timeoutMs: number
  private pollIntervalMs: number
  private nextId = 1

  constructor(opts: McpClientOptions) {
    if (!opts.serverUrl) throw new Error('McpFixAgent requires serverUrl')
    this.serverUrl = opts.serverUrl.replace(/\/$/, '')
    this.bearer = opts.bearer
    this.toolName = opts.toolName ?? 'mushi.generate_fix'
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000
  }

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-${context.reportId.slice(0, 8)}`
    try {
      const callRes = await this.rpc<ToolsCallResult>('tools/call', {
        name: this.toolName,
        arguments: {
          report: context.report,
          reproductionSteps: context.reproductionSteps,
          relevantCode: context.relevantCode.map(f => ({
            path: f.path,
            content: f.content.slice(0, 8000),
          })),
          graphContext: context.graphContext,
          config: {
            maxLines: context.config.maxLines,
            scopeRestriction: context.config.scopeRestriction,
            componentDir: context.report.component,
            branch,
          },
        },
      })

      // SEP-1686 Tasks: server returned a task id; poll until terminal.
      let final: ToolsCallResult = callRes
      if (callRes.task?.id) {
        final = await this.pollTask(callRes.task.id)
      }

      if (final.isError) {
        return failedResult(branch, this.extractText(final) || 'MCP tool returned isError=true')
      }

      const parsed = this.parseFixResult(final, branch)
      return parsed
    } catch (err) {
      return failedResult(branch, String(err))
    }
  }

  validateResult(context: FixContext, result: FixResult): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const lc = checkCircuitBreaker(result.linesChanged, context.config.maxLines)
    if (!lc.allowed && lc.reason) errors.push(lc.reason)
    for (const f of result.filesChanged) {
      const sc = checkFileScope(f, context.report.component, context.config.scopeRestriction)
      if (!sc.allowed && sc.reason) errors.push(sc.reason)
    }
    return { valid: errors.length === 0, errors }
  }

  // -------- internals --------

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params }
    const res = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
    }
    const body = (await res.json()) as JsonRpcResponse<T>
    if (body.error) {
      throw new Error(`MCP error ${body.error.code}: ${body.error.message}`)
    }
    if (body.result === undefined) {
      throw new Error('MCP response missing result')
    }
    return body.result
  }

  /**
   * Poll tasks/get per SEP-1686 until the task reaches a terminal state.
   * Cancels via tasks/cancel if the wall-clock exceeds timeoutMs.
   */
  private async pollTask(taskId: string): Promise<ToolsCallResult> {
    const start = Date.now()
    while (true) {
      if (Date.now() - start > this.timeoutMs) {
        try { await this.rpc<unknown>('tasks/cancel', { id: taskId }) } catch { /* tolerate */ }
        throw new Error(`MCP task ${taskId} timed out after ${this.timeoutMs}ms`)
      }
      const t = await this.rpc<TaskGetResult>('tasks/get', { id: taskId })
      if (t.status === 'completed') {
        if (!t.result) throw new Error(`MCP task ${taskId} completed without result`)
        return t.result
      }
      if (t.status === 'failed' || t.status === 'cancelled') {
        throw new Error(`MCP task ${taskId} ${t.status}: ${t.error?.message ?? 'no error message'}`)
      }
      await sleep(this.pollIntervalMs)
    }
  }

  private extractText(result: ToolsCallResult): string {
    return (result.content ?? [])
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map(c => c.text)
      .join('\n')
  }

  /**
   * Server SHOULD return a single content item with type=json containing the
   * FixResult shape. As a fallback, accept type=text whose body is JSON.
   */
  private parseFixResult(result: ToolsCallResult, branch: string): FixResult {
    const items = result.content ?? []
    const json = items.find((c): c is { type: 'json'; data: unknown } => c.type === 'json')
    if (json) {
      const data = json.data as Partial<FixResult>
      return normalizeFixResult(data, branch)
    }
    const text = this.extractText(result)
    if (text) {
      try {
        return normalizeFixResult(JSON.parse(text) as Partial<FixResult>, branch)
      } catch {
        return failedResult(branch, `MCP tool returned non-JSON text: ${text.slice(0, 500)}`)
      }
    }
    return failedResult(branch, 'MCP tool returned no content')
  }
}

function normalizeFixResult(data: Partial<FixResult>, branch: string): FixResult {
  return {
    success: Boolean(data.success),
    branch: data.branch ?? branch,
    prUrl: data.prUrl,
    filesChanged: Array.isArray(data.filesChanged) ? data.filesChanged : [],
    linesChanged: typeof data.linesChanged === 'number' ? data.linesChanged : 0,
    summary: data.summary ?? '',
    error: data.error,
  }
}

function failedResult(branch: string, error: string): FixResult {
  return {
    success: false,
    branch,
    filesChanged: [],
    linesChanged: 0,
    summary: 'MCP fix-agent call failed',
    error,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
