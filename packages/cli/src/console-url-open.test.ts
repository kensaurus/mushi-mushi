import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// An opener that starts and then outlives the CLI (rundll32 on Windows does).
const spawned = vi.hoisted(() => [] as Array<{ cmd: string; args: string[] }>)
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawned.push({ cmd, args })
    const child = Object.assign(new EventEmitter(), { unref: () => undefined })
    queueMicrotask(() => child.emit('spawn'))
    return child
  },
}))

import { openInBrowser } from './console-url.js'

describe('openInBrowser', () => {
  it('returns once the browser opener starts, without waiting for it to exit', async () => {
    // Waiting for 'exit' on an unref'd child let Node end `mushi login` with
    // code 0 right after its banner (Windows, 2026-10-06).
    await expect(openInBrowser('https://kensaur.us/mushi-mushi/admin/cli-auth?code=ABCD-1234')).resolves.toBeUndefined()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].args.at(-1)).toBe('https://kensaur.us/mushi-mushi/admin/cli-auth?code=ABCD-1234')
  })

  it('opens nothing that is not http(s)', async () => {
    spawned.length = 0
    await openInBrowser('file:///etc/passwd')
    await openInBrowser('javascript:alert(1)')
    expect(spawned).toHaveLength(0)
  })
})
