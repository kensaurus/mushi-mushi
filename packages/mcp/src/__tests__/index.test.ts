/**
 * FILE: packages/mcp/src/__tests__/index.test.ts
 * PURPOSE: Unit tests for the Mushi MCP server — tool registration and parameter validation.
 *
 * OVERVIEW:
 * - Verifies the McpServer registers the expected tool names
 * - Tests that tool handlers exist for each registered tool
 * - Validates the expected tool set matches the implementation
 *
 * DEPENDENCIES:
 * - vitest for test runner and mocking
 * - @modelcontextprotocol/sdk and @mushi-mushi/core mocked
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const registeredTools = new Map<string, { description: string; handler: Function }>()
const registeredResources = new Map<string, { handler: Function }>()

const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(class {
    tool = vi.fn((name: string, description: string, _schema: unknown, handler: Function) => {
      registeredTools.set(name, { description, handler })
    })
    resource = vi.fn((_name: string, uri: string, _opts: unknown, handler: Function) => {
      registeredResources.set(uri, { handler })
    })
    connect = mockConnect
  }),
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))

vi.mock('@mushi-mushi/core', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  })),
}))

const EXPECTED_TOOLS = [
  'get_recent_reports',
  'get_report_detail',
  'search_reports',
  'get_fix_context',
  'submit_fix_result',
  'get_similar_bugs',
  'get_blast_radius',
  'trigger_judge',
  'dispatch_fix',
  'transition_status',
  'run_nl_query',
  'get_knowledge_graph',
]

const originalExit = process.exit

beforeAll(async () => {
  process.exit = vi.fn() as unknown as typeof process.exit
  process.env.MUSHI_API_KEY = 'test-key'
  process.env.MUSHI_PROJECT_ID = 'test-project'
  await import('../../src/index')
})

afterAll(() => {
  process.exit = originalExit
  delete process.env.MUSHI_API_KEY
  delete process.env.MUSHI_PROJECT_ID
})

describe('MCP Server tool registration', () => {
  it('registers all expected tools', () => {
    for (const toolName of EXPECTED_TOOLS) {
      expect(registeredTools.has(toolName), `tool "${toolName}" should be registered`).toBe(true)
    }
  })

  it('registers exactly the expected number of tools', () => {
    expect(registeredTools.size).toBe(EXPECTED_TOOLS.length)
  })

  it('each tool has a handler function', () => {
    for (const [name, tool] of registeredTools) {
      expect(typeof tool.handler, `handler for "${name}" should be a function`).toBe('function')
    }
  })

  it('each tool has a non-empty description', () => {
    for (const [name, tool] of registeredTools) {
      expect(tool.description.length, `description for "${name}" should be non-empty`).toBeGreaterThan(0)
    }
  })

  it('registers the project_stats resource', () => {
    expect(registeredResources.has('project://stats')).toBe(true)
  })
})
