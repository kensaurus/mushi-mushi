// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import { cursorCloudAdapter, cursorModel, httpsRepoUrl } from './cursor-cloud.js'

const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' })

let root = ''
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  root = ''
})

describe('helpers', () => {
  it('normalizes GitHub remotes and model specs', () => {
    expect(httpsRepoUrl('git@github.com:kensaurus/glot.it.git')).toBe('https://github.com/kensaurus/glot.it')
    expect(httpsRepoUrl('https://x-access-token@github.com/o/r.git')).toBe('https://github.com/o/r')
    expect(httpsRepoUrl('https://gitlab.com/o/r')).toBeNull()
    expect(cursorModel('grok-4.7?reasoning_effort=xhigh&context=500k')).toEqual({
      id: 'grok-4.7',
      params: [{ id: 'reasoning_effort', value: 'xhigh' }, { id: 'context', value: '500k' }],
    })
    expect(cursorModel('composer-2.5')).toEqual({ id: 'composer-2.5' })
  })
})

describe('cursorCloudAdapter', () => {
  it('pushes the run branch, starts the agent there, and applies its edit uncommitted', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-cloud-'))
    const origin = join(root, 'origin.git')
    const work = join(root, 'work')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['clone', '-q', origin, work])
    writeFileSync(join(work, 'style.css'), '.muted { color: #ccc; }\n')
    g(work, 'add', '-A')
    g(work, 'commit', '-q', '-m', 'init')
    g(work, 'checkout', '-q', '-b', 'mushi-ux/20261006-000000-abcd')
    mkdirSync(join(work, '.mushi-ux'))
    writeFileSync(join(work, '.mushi-ux', 'PROMPT.md'), '# UX pass — Home\nScreenshots: .mushi-ux/desktop.png')
    const png = new PNG({ width: 8, height: 6 })
    writeFileSync(join(work, '.mushi-ux', 'desktop.png'), PNG.sync.write(png))

    const posts: Array<Record<string, unknown>> = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/v1/agents')) {
        posts.push(JSON.parse(String(init.body)))
        // workOnCurrentBranch: the "agent" commits onto the pushed run branch.
        const agent = join(root, 'agent')
        execFileSync('git', ['clone', '-q', '-b', 'mushi-ux/20261006-000000-abcd', origin, agent])
        writeFileSync(join(agent, 'style.css'), '.muted { color: #555; }\n')
        g(agent, 'commit', '-q', '-am', 'contrast')
        g(agent, 'push', '-q', 'origin', 'mushi-ux/20261006-000000-abcd')
        return new Response(JSON.stringify({ agent: { id: 'bc-1' }, run: { id: 'run-1' } }), { status: 201 })
      }
      return new Response(JSON.stringify({ status: 'FINISHED', result: 'Darkened .muted', git: { branches: [{ branch: 'mushi-ux/20261006-000000-abcd' }] } }))
    }) as typeof fetch

    const adapter = cursorCloudAdapter({ fetch: fakeFetch, apiKey: 'k', repoUrl: 'https://github.com/o/r', sleep: async () => {} })
    const res = await adapter.run({ cwd: work, prompt: 'ignored', model: 'grok-4.7?reasoning_effort=xhigh', timeoutMs: 60_000 })

    expect(res.exitCode).toBe(0)
    expect(posts[0]).toMatchObject({
      repos: [{ url: 'https://github.com/o/r', startingRef: 'mushi-ux/20261006-000000-abcd' }],
      workOnCurrentBranch: true,
      autoCreatePR: false,
      model: { id: 'grok-4.7', params: [{ id: 'reasoning_effort', value: 'xhigh' }] },
    })
    const prompt = posts[0].prompt as { text: string; images: Array<{ mimeType: string; data: string }> }
    expect(prompt.text).toContain('the attached desktop screenshot')
    expect(prompt.images).toHaveLength(1)
    expect(prompt.images[0].mimeType).toBe('image/png')
    // Applied to the worktree, not committed: the loop decides.
    // autocrlf on Windows checkouts turns \n into \r\n.
    expect(readFileSync(join(work, 'style.css'), 'utf8').replace(/\r\n/g, '\n')).toBe('.muted { color: #555; }\n')
    expect(g(work, 'status', '--porcelain', '--', 'style.css').trim()).toBe('M style.css')
    // The run branch was pushed so the agent could start from it.
    expect(g(origin, 'branch', '--list', 'mushi-ux/*').trim()).toContain('mushi-ux/20261006-000000-abcd')
  }, 60_000)

  it('replaces a rejected agent commit on the next attempt instead of failing the lease', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-cloud-'))
    const origin = join(root, 'origin.git')
    const work = join(root, 'work')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['clone', '-q', origin, work], { stdio: 'pipe' })
    writeFileSync(join(work, 'a.css'), 'a {}\n')
    g(work, 'add', '-A')
    g(work, 'commit', '-q', '-m', 'init')
    g(work, 'checkout', '-q', '-b', 'mushi-ux/20261006-000000-wxyz')
    mkdirSync(join(work, '.mushi-ux'))
    writeFileSync(join(work, '.mushi-ux', 'PROMPT.md'), 'x')
    let n = 0
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/v1/agents')) {
        n++
        const agent = join(root, `agent${n}`)
        execFileSync('git', ['clone', '-q', '-b', 'mushi-ux/20261006-000000-wxyz', origin, agent])
        writeFileSync(join(agent, 'a.css'), `a { color: #${n}${n}${n}; }\n`)
        g(agent, 'commit', '-q', '-am', `try ${n}`)
        g(agent, 'push', '-q', 'origin', 'mushi-ux/20261006-000000-wxyz')
        return new Response(JSON.stringify({ agent: { id: `bc-${n}` }, run: { id: `run-${n}` } }), { status: 201 })
      }
      return new Response(JSON.stringify({ status: 'FINISHED', git: { branches: [{ branch: 'mushi-ux/20261006-000000-wxyz' }] } }))
    }) as typeof fetch
    const adapter = cursorCloudAdapter({ fetch: fakeFetch, apiKey: 'k', repoUrl: 'https://github.com/o/r', sleep: async () => {} })
    expect((await adapter.run({ cwd: work, prompt: '', timeoutMs: 60_000 })).exitCode).toBe(0)
    // The loop rejects attempt 1 and reverts the worktree, as loop.ts does.
    g(work, 'checkout', '--', '.')
    const second = await adapter.run({ cwd: work, prompt: '', timeoutMs: 60_000 })
    expect(second.tail).not.toMatch(/Could not push/)
    expect(second.exitCode).toBe(0)
    expect(readFileSync(join(work, 'a.css'), 'utf8').replace(/\r\n/g, '\n')).toBe('a { color: #222; }\n')
  }, 60_000)

  it('says what is missing instead of guessing', async () => {
    const res = await cursorCloudAdapter({ apiKey: '' }).run({ cwd: tmpdir(), prompt: '', timeoutMs: 1000 })
    expect(res.exitCode).toBe(1)
    expect(res.tail).toMatch(/CURSOR_API_KEY/)
  })
})
