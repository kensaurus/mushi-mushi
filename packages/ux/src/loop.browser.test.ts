// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium, spawns a dev
 * server, creates git worktrees). The agent is scripted, so the test proves
 * the loop's own decisions, not a model's:
 *
 * - Home: the agent fixes the low-contrast colour → kept as a commit.
 * - About: the agent adds sideways-scrolling content → rolled back, file restored.
 *   Its second attempt pads the shared body → kept, and Home (finished,
 *   sharing the stylesheet) is re-shot and flagged `regressed`.
 * - The person's own checkout is never touched.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentAdapter } from './agents.js'
import { startLoop } from './loop.js'
import { resumeSettings } from './resume.js'

/**
 * A throwaway git repo holding a two-page static site and a dev server that
 * re-reads files on every request (so edits show up like HMR). Both pages
 * share `site/style.css`, whose `.muted` text fails WCAG contrast, so the
 * loop has a real, measurable problem to fix and a shared file that can move
 * another screen.
 */


const SERVER = `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const routes = { '/': 'site/index.html', '/about': 'site/about.html', '/style.css': 'site/style.css' }
createServer((req, res) => {
  const file = routes[(req.url || '/').split('?')[0]]
  if (!file) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html' })
  res.end(readFileSync(file))
}).listen(Number(process.env.PORT), '127.0.0.1')
`

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"></head>
<body><nav><a href="/">Home</a> <a href="/about">About</a></nav><main><h1>${title}</h1>${body}</main></body></html>
`

const STYLE_LOW_CONTRAST = `body { font-family: sans-serif; margin: 24px; background: #fff; }
.muted { color: #c8c8c8; }
`

function createFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'mushi-ux-repo-'))
  mkdirSync(join(root, 'site'))
  writeFileSync(join(root, 'server.mjs'), SERVER)
  writeFileSync(join(root, 'site', 'style.css'), STYLE_LOW_CONTRAST)
  writeFileSync(join(root, 'site', 'index.html'), page('Home', '<p class="muted">Welcome back. Your reports are below.</p>'))
  writeFileSync(
    join(root, 'site', 'about.html'),
    page('About', '<p class="muted">About this app.</p><ul><li>One</li><li>Two</li><li>Three</li></ul>'),
  )
  // Like a real repo: .gitignore knows nothing about the loop's directories.
  writeFileSync(join(root, '.gitignore'), '.env\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init')
  // An ignored local secret (copied so the dev server works), and an env file
  // the repo forgot to ignore (must never be copied or committed).
  writeFileSync(join(root, '.env'), 'SECRET=ignored-local-value\n')
  writeFileSync(join(root, '.env.staging'), 'SECRET=not-ignored-value\n')
  return root
}

const repo = createFixtureRepo()
afterAll(() => {
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repo })
  } catch {
    /* best effort */
  }
  rmSync(repo, { recursive: true, force: true })
})

const scripted: AgentAdapter = {
  name: 'scripted',
  verified: true,
  async run({ cwd }) {
    const prompt = readFileSync(join(cwd, '.mushi-ux', 'PROMPT.md'), 'utf8')
    const css = join(cwd, 'site', 'style.css')
    if (prompt.startsWith('# UX pass — Home')) {
      writeFileSync(css, readFileSync(css, 'utf8').replace('#c8c8c8', '#4a4a4a'))
    } else if (prompt.startsWith('# UX pass — About') && prompt.includes('Attempt 1.')) {
      const about = join(cwd, 'site', 'about.html')
      writeFileSync(about, readFileSync(about, 'utf8').replace('</main>', '<div style="width:3000px">wide</div></main>'))
    } else if (prompt.startsWith('# UX pass — About')) {
      writeFileSync(css, readFileSync(css, 'utf8').replace('margin: 24px;', 'margin: 24px; padding: 48px 64px;'))
    }
    return { exitCode: 0, timedOut: false, durationMs: 1, tail: 'scripted', stdout: '' }
  },
}

describe('startLoop on a fixture repo', () => {
  it('keeps measured improvements, rolls back regressions, and flags collateral changes', async () => {
    const handle = startLoop({
      repoRoot: repo,
      devCommand: 'node server.mjs',
      installCommand: null,
      agent: 'claude-code',
      agentAdapter: scripted,
      iterations: 2,
      maxSurfaces: 5,
    })
    const state = await handle.done
    const byLabel = (l: string) => state.surfaces.find((s) => s.surface.label === l)
    const home = byLabel('Home')
    const about = byLabel('About')
    if (!home || !about) throw new Error(`surfaces: ${state.surfaces.map((s) => s.surface.label).join(', ')}`)

    // Home: contrast fixed and kept.
    expect(home.iterations[0].outcome).toBe('accepted')
    expect(home.iterations[0].commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(home.baseline.desktop.probes.axe.some((v) => v.id === 'color-contrast')).toBe(true)
    expect(home.iterations[0].after.desktop.probes.axe.some((v) => v.id === 'color-contrast')).toBe(false)

    // About: the overflow attempt was rolled back, the padding attempt kept.
    expect(about.iterations[0].outcome).toBe('rejected')
    expect(about.iterations[0].reason).toMatch(/scrolls sideways/)
    expect(about.iterations[1].outcome).toBe('accepted')
    const wtAbout = readFileSync(join(state.worktree as string, 'site', 'about.html'), 'utf8')
    expect(wtAbout).not.toContain('3000px')

    // The shared-stylesheet change moved Home after it was finished.
    expect(home.status).toBe('regressed')
    expect(home.note).toMatch(/after "About" was kept/)

    // Commits are on the run branch; the main checkout is unchanged.
    const log = execFileSync('git', ['log', '--format=%s', `${state.branch}`], { cwd: repo, encoding: 'utf8' })
    expect(log.split('\n').filter((l) => l.startsWith('ux('))).toHaveLength(2)
    expect(readFileSync(join(repo, 'site', 'style.css'), 'utf8')).toBe(STYLE_LOW_CONTRAST)
    // `git status` is exactly as before the run: only the pre-existing
    // un-ignored env file; none of .mushi/, .worktrees/ or .mushi-ux/.
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('?? .env.staging')

    // The ignored .env reached the worktree; the un-ignored one did not, and
    // no env or scratch file is in any commit on the run branch.
    const wt = state.worktree as string
    expect(readFileSync(join(wt, '.env'), 'utf8')).toContain('ignored-local-value')
    expect(() => readFileSync(join(wt, '.env.staging'))).toThrow()
    const committed = execFileSync('git', ['log', '--name-only', '--format=', `${state.baseSha}..${state.branch}`], {
      cwd: repo,
      encoding: 'utf8',
    })
    expect(committed).not.toMatch(/\.env|\.mushi/)
  }, 180_000)

  it('in steps mode plans each screen, then keeps or rolls back one small step per attempt', async () => {
    const stepRepo = createFixtureRepo()
    try {
      const planner: AgentAdapter = {
        name: 'scripted',
        verified: true,
        async run(o) {
          const prompt = readFileSync(join(o.cwd, '.mushi-ux', 'PROMPT.md'), 'utf8')
          const done = { exitCode: 0, timedOut: false, durationMs: 1, tail: '', stdout: '' }
          if (prompt.startsWith('# UX plan — About')) {
            writeFileSync(join(o.cwd, '.mushi-ux', 'PLAN.md'), '- Darken the muted text in site/style.css\n- Split the page into seven partial files\n- Tidy the heading spacing on About')
            writeFileSync(join(o.cwd, 'site', 'about.html'), 'a planning pass must not keep this')
            return done
          }
          if (prompt.startsWith('# UX plan')) return done // Home: no plan → whole-screen attempts
          if (prompt.includes('## This step (1 of 3)')) {
            const css = join(o.cwd, 'site', 'style.css')
            writeFileSync(css, readFileSync(css, 'utf8').replace('#c8c8c8', '#4a4a4a'))
          } else if (prompt.includes('## This step (2 of 3)')) {
            for (let i = 0; i < 7; i++) writeFileSync(join(o.cwd, 'site', `part-${i}.html`), `<p>part ${i}</p>`)
            const about = join(o.cwd, 'site', 'about.html')
            writeFileSync(about, readFileSync(about, 'utf8').replace('</main>', '<p>Split into parts.</p></main>'))
          }
          return done // step 3: nothing needed
        },
      }
      const state = await startLoop({ repoRoot: stepRepo, devCommand: 'node server.mjs', installCommand: null, agent: 'claude-code', agentAdapter: planner, iterations: 4, maxSurfaces: 5, steps: true, startPaths: ['/about'] }).done
      const about = state.surfaces.find((s) => s.surface.label === 'About')
      expect(about?.plan?.steps.map((p) => p.status)).toEqual(['done', 'failed', 'skipped'])
      expect(about?.iterations.map((i) => i.outcome)).toEqual(['accepted', 'rejected', 'no_change'])
      expect(about?.iterations[0]?.step).toBe('Darken the muted text in site/style.css')
      expect(about?.iterations[1]?.reason).toMatch(/^Step 2\/3: Too big for one step: 8 files changed/)
      const wt = state.worktree as string
      expect(readFileSync(join(wt, 'site', 'about.html'), 'utf8')).not.toMatch(/planning pass|Split into parts/)
      const log = execFileSync('git', ['log', '--format=%s', `${state.branch}`], { cwd: stepRepo, encoding: 'utf8' })
      expect(log).toContain('ux(/about): About: Darken the muted text in site/style.css')
    } finally {
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: stepRepo })
      } catch {
        /* best effort */
      }
      rmSync(stepRepo, { recursive: true, force: true })
    }
  }, 240_000)

  it('asks a timed-out agent to finish in the same session instead of losing what it read', async () => {
    const nudgeRepo = createFixtureRepo()
    try {
      const resumed: string[] = []
      const session = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123456' })
      // Like Grok 4.7 xhigh on glot.it: reads until the box runs out, both when planning and when editing.
      const reader: AgentAdapter = {
        name: 'scripted',
        verified: true,
        canResume: true,
        async run(o) {
          const out = (timedOut: boolean) => ({ exitCode: timedOut ? null : 0, timedOut, durationMs: 1, tail: '', stdout: session })
          if (!o.resumeSession) return out(true)
          resumed.push(o.prompt)
          if (o.prompt.includes('PLAN.md')) {
            writeFileSync(join(o.cwd, '.mushi-ux', 'PLAN.md'), '- Darken the muted text in site/style.css')
          } else {
            const css = join(o.cwd, 'site', 'style.css')
            writeFileSync(css, readFileSync(css, 'utf8').replace('#c8c8c8', '#4a4a4a'))
          }
          return out(false)
        },
      }
      const state = await startLoop({ repoRoot: nudgeRepo, devCommand: 'node server.mjs', installCommand: null, agent: 'claude-code', agentAdapter: reader, iterations: 2, steps: true, startPaths: ['/'] }).done
      const home = state.surfaces.find((s) => s.surface.label === 'Home')
      expect(resumed).toHaveLength(2)
      expect(resumed[0]).toMatch(/^Time is up\. .*PLAN\.md/)
      expect(resumed[1]).toMatch(/^Time is up\. .*Make the one change/)
      expect(home?.plan?.steps).toMatchObject([{ text: 'Darken the muted text in site/style.css', status: 'done' }])
      expect(home?.iterations.map((i) => i.outcome)).toEqual(['accepted'])
    } finally {
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: nudgeRepo })
      } catch {
        /* best effort */
      }
      rmSync(nudgeRepo, { recursive: true, force: true })
    }
  }, 240_000)

  it('gives a timed-out screen a second try, and calls one that never finishes blocked, not unchanged', async () => {
    const slowRepo = createFixtureRepo()
    try {
      const prompts: string[] = []
      const slow: AgentAdapter = {
        name: 'scripted',
        verified: true,
        async run(o) {
          const prompt = readFileSync(join(o.cwd, '.mushi-ux', 'PROMPT.md'), 'utf8')
          prompts.push(prompt)
          const timedOut = { exitCode: null, timedOut: true, durationMs: 1, tail: '', stdout: '' }
          // Home: reads too long once, then fixes the contrast. About: never finishes.
          if (prompt.startsWith('# UX pass — Home') && prompt.includes('Attempt 2.')) return scripted.run(o)
          return timedOut
        },
      }
      const state = await startLoop({ repoRoot: slowRepo, devCommand: 'node server.mjs', installCommand: null, agent: 'claude-code', agentAdapter: slow, iterations: 2, maxSurfaces: 5 }).done
      const home = state.surfaces.find((s) => s.surface.label === 'Home')
      const about = state.surfaces.find((s) => s.surface.label === 'About')
      expect(home?.iterations.map((i) => i.outcome)).toEqual(['agent_failed', 'accepted'])
      expect(home?.iterations[0]?.reason).toMatch(/ran out of time .* without editing anything/)
      expect(prompts.find((p) => p.startsWith('# UX pass — Home') && p.includes('Attempt 2.'))).toMatch(/without making any edit and was stopped/)
      expect(about?.iterations.map((i) => i.outcome)).toEqual(['agent_failed', 'agent_failed'])
      expect(about?.status).toBe('blocked')
    } finally {
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: slowRepo })
      } catch {
        /* best effort */
      }
      rmSync(slowRepo, { recursive: true, force: true })
    }
  }, 240_000)

  it('resumes a run that died mid-attempt with only its id and saved settings', async () => {
    const crashRepo = createFixtureRepo()
    try {
      // Dies during About's first attempt like a killed process: a half-made
      // edit, plus a commit the state never recorded (a crash between an
      // attempt's commit and the save).
      const crashing: AgentAdapter = {
        name: 'scripted',
        verified: true,
        async run(o) {
          const prompt = readFileSync(join(o.cwd, '.mushi-ux', 'PROMPT.md'), 'utf8')
          if (!prompt.startsWith('# UX pass — About')) return scripted.run(o)
          writeFileSync(join(o.cwd, 'site', 'about.html'), 'CRASHED half edit')
          writeFileSync(join(o.cwd, 'stray.txt'), 'not recorded')
          execFileSync('git', ['add', 'stray.txt'], { cwd: o.cwd })
          execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'unrecorded'], { cwd: o.cwd })
          throw new Error('process killed')
        },
      }
      const first = startLoop({
        repoRoot: crashRepo,
        devCommand: 'node server.mjs',
        installCommand: null,
        agent: 'claude-code',
        agentAdapter: crashing,
        iterations: 2,
        maxSurfaces: 5,
      })
      await expect(first.done).rejects.toThrow('process killed')

      // A resume needs only the id: everything else was saved when it started.
      const saved = resumeSettings(crashRepo, first.runId)
      expect(saved.options).toMatchObject({ devCommand: 'node server.mjs', installCommand: null, iterations: 2, maxSurfaces: 5 })
      const resumed = startLoop({
        repoRoot: crashRepo,
        resumeRunId: first.runId,
        agent: 'claude-code',
        agentAdapter: scripted,
        devCommand: saved.options.devCommand,
        installCommand: saved.options.installCommand,
        iterations: saved.options.iterations,
        maxSurfaces: saved.options.maxSurfaces,
      })
      const state = await resumed.done
      expect(state).toMatchObject({ phase: 'done', error: null, stopped: false })
      const about = state.surfaces.find((s) => s.surface.label === 'About')
      expect(about?.iterations.map((i) => i.outcome)).toEqual(['rejected', 'accepted'])
      // The half edit and the unrecorded commit are gone; Home's kept commit stays.
      const wt = state.worktree as string
      expect(readFileSync(join(wt, 'site', 'about.html'), 'utf8')).not.toContain('CRASHED')
      const log = execFileSync('git', ['log', '--format=%s', `${state.branch}`], { cwd: crashRepo, encoding: 'utf8' })
      expect(log).not.toContain('unrecorded')
      expect(log.split('\n').filter((l) => l.startsWith('ux('))).toHaveLength(2)
      expect(readFileSync(join(crashRepo, '.mushi', 'ux', first.runId, 'run.log'), 'utf8')).toMatch(/moved it back[\s\S]*Resumed/)
    } finally {
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: crashRepo })
      } catch {
        /* best effort */
      }
      rmSync(crashRepo, { recursive: true, force: true })
    }
  }, 240_000)
})
