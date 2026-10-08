// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { describeAgentLine, formatStep, shortPath } from './agent-events.js'

const lines = (...evs: unknown[]) => evs.map((e) => JSON.stringify(e))

describe('describeAgentLine', () => {
  it('reads the Cursor CLI stream (documented example sequence)', () => {
    const cwd = 'C:\\repo\\.worktrees\\run'
    const steps = lines(
      { type: 'system', subtype: 'init', model: 'Grok 4.7', cwd },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Read .mushi-ux/PROMPT.md' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: "I'll read the brief" }] } },
      { type: 'tool_call', subtype: 'started', call_id: 'a', tool_call: { readToolCall: { args: { path: 'C:/repo/.worktrees/run/app/page.tsx' } } } },
      { type: 'tool_call', subtype: 'completed', call_id: 'a', tool_call: { readToolCall: { args: { path: 'app/page.tsx' }, result: { success: {} } } } },
      { type: 'tool_call', subtype: 'started', call_id: 'b', tool_call: { editToolCall: { args: { path: 'app/globals.css' } } } },
      { type: 'tool_call', subtype: 'started', call_id: 'c', tool_call: { shellToolCall: { args: { command: 'pnpm lint' } } } },
      { type: 'tool_call', subtype: 'started', call_id: 'd', tool_call: { grepToolCall: { args: { pattern: 'skip-link' } } } },
      { type: 'tool_call', subtype: 'started', call_id: 'e', tool_call: { function: { name: 'todo_write', arguments: '{"todos":[]}' } } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Done' },
    ).flatMap((l) => describeAgentLine(l, cwd))
    expect(steps.map(formatStep)).toEqual([
      '[tool] Started (Grok 4.7)',
      "› I'll read the brief",
      '[read] app/page.tsx',
      '[edit] app/globals.css',
      '[run] pnpm lint',
      '[find] skip-link',
      '[tool] todo_write',
      '[done] Finished',
    ])
    expect(steps.find((s) => s.kind === 'edit')?.path).toBe('app/globals.css')
  })

  it('skips Cursor partial-output flushes that repeat text', () => {
    const [flush] = lines({ type: 'assistant', model_call_id: 'x', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'dup' }] } })
    expect(describeAgentLine(flush!)).toEqual([])
  })

  it('reads Claude Code text and tool_use blocks in one message', () => {
    const [line] = lines({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Fixing contrast.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/w/src/App.css' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/w/src/App.tsx' } },
        ],
      },
    })
    expect(describeAgentLine(line!, '/w').map(formatStep)).toEqual(['› Fixing contrast.', '[edit] src/App.css', '[read] src/App.tsx'])
  })

  it('reads Codex exec --json items', () => {
    const steps = lines(
      { type: 'item.started', item: { type: 'command_execution', command: 'rg nav' } },
      { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.tsx', kind: 'update' }, { path: 'b.css' }] } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } },
    ).flatMap((l) => describeAgentLine(l))
    expect(steps.map(formatStep)).toEqual(['[run] rg nav', '[edit] a.tsx', '[edit] b.css', '› Done.'])
  })

  it('reports a failed result and keeps plain lines', () => {
    expect(describeAgentLine(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Tool blocked by hook' }))[0]).toEqual({
      kind: 'error',
      text: 'Tool blocked by hook',
    })
    expect(describeAgentLine('Cloud agent status: RUNNING')).toEqual([{ kind: 'say', text: 'Cloud agent status: RUNNING' }])
    expect(describeAgentLine('   ')).toEqual([])
    expect(describeAgentLine('{"type":"user"}')).toEqual([])
  })

  it('clips long text to one line', () => {
    const [step] = describeAgentLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a\n'.repeat(400) }] } }))
    expect(step!.text.length).toBeLessThanOrEqual(300)
    expect(step!.text).not.toContain('\n')
  })
})

describe('shortPath', () => {
  it('makes worktree paths relative, any slash style or case', () => {
    expect(shortPath('C:\\Repo\\wt\\app\\x.tsx', 'c:/repo/wt')).toBe('app/x.tsx')
    expect(shortPath('/elsewhere/x.tsx', '/w')).toBe('/elsewhere/x.tsx')
  })
})
