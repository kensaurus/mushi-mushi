// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentAdapter, AgentRunOptions } from './agents.js'
import { preflightAdvice, preflightAgent } from './preflight.js'
import type { RunResult } from './proc.js'

const result = (stdout: string, extra: Partial<RunResult> = {}): RunResult => ({ exitCode: 0, timedOut: false, durationMs: 10, tail: stdout.slice(-4096), stdout, ...extra })
const fake = (name: string, answer: (o: AgentRunOptions) => RunResult): AgentAdapter => ({ name, verified: true, run: async (o) => answer(o) })

describe('preflightAgent', () => {
  it('passes when the agent reads the file', async () => {
    const reader = fake('cursor', (o) => {
      const text = readFileSync(join(o.cwd, 'PREFLIGHT.txt'), 'utf8')
      return result(JSON.stringify({ type: 'result', result: text.match(/word is (\w+)/)![1] }))
    })
    expect(await preflightAgent(reader)).toBeNull()
  })

  it('names a hook block, with the Windows shell hint, from the agent’s own words', async () => {
    const blocked = fake('cursor', () => result(JSON.stringify({ type: 'result', result: 'I could not read the file: a preToolUse hook failed and blocked every tool.' })))
    const msg = await preflightAgent(blocked, { model: 'grok-4.7-xhigh' })
    expect(msg).toContain('cursor (grok-4.7-xhigh) answered without reading the file')
    expect(msg).toContain('hook failed')
    expect(preflightAdvice('cursor', 'hook failed', 'win32')).toContain('PowerShell')
  })

  it('says how to sign in when the agent is logged out', async () => {
    const out = fake('cursor', () => result('', { exitCode: 1, tail: 'Error: Not logged in. Run agent login.' }))
    const msg = await preflightAgent(out)
    expect(msg).toContain('exited with code 1')
    expect(msg).toContain('agent login')
  })

  it('reports a timeout and a missing binary without throwing', async () => {
    expect(await preflightAgent(fake('codex', () => result('', { timedOut: true, exitCode: null })), { timeoutMs: 5000 })).toContain('did not answer within 5 s')
    const missing: AgentAdapter = { name: 'claude-code', verified: true, run: async () => Promise.reject(new Error('spawn claude ENOENT')) }
    expect(await preflightAgent(missing)).toContain('Is it installed and on PATH?')
  })
})
