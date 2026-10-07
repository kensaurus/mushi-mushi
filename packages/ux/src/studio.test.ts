// SPDX-License-Identifier: MIT
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startStudio, type Dashboard } from './dashboard.js'
import { devCommandGuesses, lastWorkingRun, parseCursorAbout } from './launcher.js'
import { fromCursorApi, listModels, parseCursorCliModels } from './models.js'
import { listSkills, resolveSkill } from './skills.js'

let root = ''
let studio: Dashboard | null = null
afterEach(async () => {
  await studio?.close()
  studio = null
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('models', () => {
  it('reads ids from `agent models` output and ignores prose', () => {
    const out = [
      'Available models',
      '',
      'auto - Auto (current)',
      'grok-4.7-xhigh-500k - Grok 4.7 Extra High 500K',
      'claude-opus-5-5 - Opus 5.5',
      '\u001b[32m✓\u001b[0m composer-2.5 - Composer 2.5',
      'Tip: use --model <id> to pick one',
    ].join('\n')
    expect(parseCursorCliModels(out)).toEqual([
      { id: 'grok-4.7-xhigh-500k', label: 'Grok 4.7 Extra High 500K' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
    ])
  })

  it('keeps each Cursor Cloud model’s own settings', () => {
    expect(
      fromCursorApi([
        { id: 'grok-4.7', displayName: 'Grok 4.7', parameters: [{ id: 'reasoning_effort', values: [{ value: 'high' }, { value: 'xhigh', displayName: 'Extra high' }] }] },
        { id: 'bad id', displayName: 'x' },
      ]),
    ).toEqual([{ id: 'grok-4.7', label: 'Grok 4.7', params: [{ id: 'reasoning_effort', label: 'reasoning_effort', values: [{ value: 'high', label: 'high' }, { value: 'xhigh', label: 'Extra high' }] }] }])
  })

  it('says why when there is no list instead of inventing one', async () => {
    const signedOut = await listModels('cursor', { cursorCli: async () => ({ exitCode: 1, stdout: '', tail: 'Not logged in' }) })
    expect(signedOut).toMatchObject({ source: 'none', models: [] })
    expect(signedOut.note).toMatch(/agent login/)
    expect((await listModels('cursor-cloud', { env: {} })).note).toMatch(/CURSOR_API_KEY/)
    expect((await listModels('claude-code', { env: {} })).source).toBe('aliases')
  })
})

describe('skills', () => {
  it('resolves a name from a local skills checkout, references included', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-skills-'))
    const dir = join(root, 'skills', 'enhance-mobile-native-feel')
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: enhance-mobile-native-feel\n---\n# Native feel')
    writeFileSync(join(dir, 'references', 'native-feel-scorecard.md'), '# Scorecard')
    writeFileSync(join(root, 'skills.sh.json'), JSON.stringify({ groupings: [{ title: 'Enhance', skills: ['enhance-mobile-native-feel', '../evil'] }] }))
    const skill = await resolveSkill('enhance-mobile-native-feel', { localDir: root })
    expect(skill.name).toBe('enhance-mobile-native-feel')
    expect(Object.keys(skill.files).sort()).toEqual(['SKILL.md', 'references/native-feel-scorecard.md'])
    expect(await listSkills({ localDir: root })).toEqual([{ name: 'enhance-mobile-native-feel', group: 'Enhance' }])
  })

  it('lists the skill folders, not a stale index', async () => {
    const { mergeSkillList } = await import('./skills.js')
    const index = [
      { name: 'audit-security', group: 'Audit' },
      { name: 'folded-into-references', group: 'Audit' },
    ]
    expect(mergeSkillList(['audit-security', 'enhance-mobile-native-feel', '.git'], index)).toEqual([
      { name: 'audit-security', group: 'Audit' },
      { name: 'enhance-mobile-native-feel', group: 'Other' },
    ])
    expect(mergeSkillList(['b', 'a'], null)).toEqual([
      { name: 'a', group: null },
      { name: 'b', group: null },
    ])
  })

  it('fetches a skill folder from GitHub when there is no checkout', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      if (url.includes('/contents/skills/demo?')) {
        return Response.json([
          { type: 'file', path: 'skills/demo/SKILL.md', size: 20, download_url: 'https://raw.test/SKILL.md' },
          { type: 'dir', path: 'skills/demo/references', size: 0, download_url: null },
        ])
      }
      if (url.includes('/contents/skills/demo/references?')) {
        return Response.json([{ type: 'file', path: 'skills/demo/references/a.md', size: 3, download_url: 'https://raw.test/a.md' }])
      }
      if (url === 'https://raw.test/SKILL.md') return new Response('---\nname: demo\n---\nhi')
      if (url === 'https://raw.test/a.md') return new Response('ref')
      return new Response('', { status: 404 })
    }) as typeof fetch
    const skill = await resolveSkill('demo', { localDir: null, fetch: fakeFetch, repo: 'o/r@v1' })
    expect(skill.source).toBe('o/r@v1')
    expect(skill.files['references/a.md'].toString()).toBe('ref')
    expect(calls[0]).toBe('https://api.github.com/repos/o/r/contents/skills/demo?ref=v1')
    await expect(resolveSkill('../etc', { localDir: null, fetch: fakeFetch })).rejects.toThrow(/neither a file nor a skill name/)
  })
})

describe('dev command guesses', () => {
  it('prefers the framework command and warns about predev hooks', () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-dev-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: { predev: 'node scripts/clean-dev.mjs', dev: 'cross-env CAP_DEV_PORT=3847 NEXT_PUBLIC_X=1 next dev --webpack -p 3847' },
        dependencies: { next: '16' },
        devDependencies: { 'cross-env': '7' },
      }),
    )
    const g = devCommandGuesses(root)
    expect(g.commands[0]).toBe('npx cross-env NEXT_PUBLIC_X=1 next dev --webpack -p {port}')
    expect(g.commands).toContain('npm run dev -- --port {port}')
    expect(g.warning).toMatch(/predev/)
  })
})

describe('studio', () => {
  async function open(launch?: (i: unknown) => Promise<{ runId: string; events: EventEmitter }>) {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-studio-'))
    studio = await startStudio({ repoRoot: root, launch: launch as never, listModels: async (agent) => ({ agent, source: 'live', models: [{ id: 'm1', label: 'M1' }] }) })
    const u = new URL(studio.url)
    return { base: `${u.origin}`, t: u.searchParams.get('t')! }
  }

  it('needs the token, serves the page, and lists models', async () => {
    const { base, t } = await open()
    expect((await fetch(`${base}/api/runs`)).status).toBe(403)
    const page = await fetch(`${base}/?t=${t}`)
    expect(await page.text()).toContain('Mushi UX studio')
    expect(await (await fetch(`${base}/api/models?agent=cursor&t=${t}`)).json()).toMatchObject({ models: [{ id: 'm1' }] })
    expect((await fetch(`${base}/api/models?agent=../x&t=${t}`)).status).toBe(400)
  })

  it('starts a run only from a same-origin JSON post with valid settings', async () => {
    const started: unknown[] = []
    const { base, t } = await open(async (input) => {
      started.push(input)
      return { runId: '20261006-120000-abcd', events: new EventEmitter() }
    })
    const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
      fetch(`${base}/api/runs?t=${t}`, { method: 'POST', headers, body: JSON.stringify(body) })
    expect((await post({ agent: 'cursor', devCommand: 'x' }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post({ agent: 'cursor', devCommand: 'x' }, { 'content-type': 'application/json', origin: 'https://evil.test' })).status).toBe(403)
    expect((await post({ agent: 'cursor', devCommand: 'x', model: 'a; rm -rf /' })).status).toBe(400)
    const ok = await post({ agent: 'cursor', devCommand: 'npx next dev -p {port}', model: 'grok-4.7?reasoning_effort=xhigh', skill: 'enhance-mobile-native-feel', baseRef: 'origin/main' })
    expect(ok.status).toBe(201)
    expect(started[0]).toMatchObject({ agent: 'cursor', model: 'grok-4.7?reasoning_effort=xhigh', iterations: 2, maxSurfaces: 10, sync: false, ignore: [] })
    // Selectors go into an injected stylesheet: one that could break out of it is refused.
    expect((await post({ agent: 'cursor', devCommand: 'x', ignore: ['a} body{display:none'] })).status).toBe(400)
    expect((await post({ agent: 'cursor', devCommand: 'x', ignore: [' .dev-badge ', '[data-env="qa"]'] })).status).toBe(201)
    expect(started[1]).toMatchObject({ ignore: ['.dev-badge', '[data-env="qa"]'] })
  })

  it('serves a page script that parses (escapes inside the template literal)', async () => {
    const { STUDIO_PAGE } = await import('./studio-page.js')
    const script = STUDIO_PAGE.slice(STUDIO_PAGE.indexOf('<script>') + 8, STUDIO_PAGE.lastIndexOf('</script>'))
    // Wrapped in an async function so top-level await parses; it is never called.
    expect(() => new Function(`return async () => {\n${script}\n}`)).not.toThrow()
  })

  it('is read-only without a launcher', async () => {
    const { base, t } = await open()
    const res = await fetch(`${base}/api/runs?t=${t}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(404)
  })
})

describe('page suggestions', () => {
  it('offers concrete pages only, shallow first', async () => {
    const { pageSuggestions } = await import('./launcher.js')
    expect(pageSuggestions(['/learn/thai-tones', '/${path}', '/404', '/', '/auth/callback', '/dev/force-error', '/chat', '/words/[id]', '/api/x'])).toEqual([
      '/',
      '/chat',
      '/learn/thai-tones',
    ])
  })
})

describe('studio run log', () => {
  it('serves the saved log of a past run and nothing outside .mushi/ux', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-log-'))
    const dir = join(root, '.mushi', 'ux', '20261006-120000-abcd')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'run.log'), '06:14:42 Creating a worktree for the agent…\n06:18:01 The dev server answered HTTP 500\n')
    studio = await startStudio({ repoRoot: root })
    const u = new URL(studio.url)
    const t = u.searchParams.get('t')
    const ok = await (await fetch(`${u.origin}/api/log?run=20261006-120000-abcd&t=${t}`)).json()
    expect(ok.lines).toEqual(['06:14:42 Creating a worktree for the agent…', '06:18:01 The dev server answered HTTP 500'])
    expect((await (await fetch(`${u.origin}/api/log?run=../../etc&t=${t}`)).json()).lines).toEqual([])
  })

  it('serves an attempt’s saved steps, latest by default, so a reload still shows them', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-steps-'))
    const agentDir = join(root, '.mushi', 'ux', '20261006-120000-abcd', 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'root-42099b-1.steps.log'), '[read] app/page.tsx\n')
    writeFileSync(join(agentDir, 'root-42099b-2.steps.log'), '[read] app/layout.tsx\n[edit] app/globals.css\n')
    writeFileSync(join(agentDir, 'root-42099b-2.log'), '{"raw":"stays out"}\n')
    studio = await startStudio({ repoRoot: root })
    const u = new URL(studio.url)
    const t = u.searchParams.get('t')
    const get = (q: string) => fetch(`${u.origin}/api/steps?run=20261006-120000-abcd&${q}&t=${t}`)
    expect(await (await get('surface=root-42099b')).json()).toEqual({ attempt: 2, lines: ['[read] app/layout.tsx', '[edit] app/globals.css'] })
    expect(await (await get('surface=root-42099b&attempt=1')).json()).toEqual({ attempt: 1, lines: ['[read] app/page.tsx'] })
    expect(await (await get('surface=other-1')).json()).toEqual({ attempt: null, lines: [] })
    expect((await get('surface=../../x')).status).toBe(400)
    expect((await get('surface=root-42099b&attempt=x')).status).toBe(400)
  })
})

describe('run controls', () => {
  it('maps UI model settings to the Cursor CLI bracket form', async () => {
    const { cursorCliModel } = await import('./agents.js')
    expect(cursorCliModel('grok-4.7-xhigh')).toBe('grok-4.7-xhigh')
    expect(cursorCliModel('claude-opus-4-8?context=1m&effort=high')).toBe('claude-opus-4-8[context=1m,effort=high]')
  })

  it('skips error, callback, API and dev-only routes', async () => {
    const { isWorthVisiting } = await import('./routes.js')
    expect(['/', '/practice', '/words'].every(isWorthVisiting)).toBe(true)
    expect(['/dev/force-error', '/auth/callback', '/api/x', '/404', '/words/[id]', '/${path}'].some(isWorthVisiting)).toBe(false)
  })

  it('stops a running run from the studio, and only runs it started', async () => {
    const stopped: string[] = []
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-stop-'))
    studio = await startStudio({ repoRoot: root, stop: (id) => (id === '20261006-120000-abcd' ? (stopped.push(id), true) : false) })
    const u = new URL(studio.url)
    const t = u.searchParams.get('t')
    const post = (id: string) => fetch(`${u.origin}/api/runs/${id}/stop?t=${t}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect((await post('20261006-120000-abcd')).status).toBe(202)
    expect((await post('20261006-120000-zzzz')).status).toBe(409)
    expect((await fetch(`${u.origin}/api/runs/20261006-120000-abcd/stop?t=${t}`, { method: 'POST', body: '{}' })).status).toBe(415)
    expect(stopped).toEqual(['20261006-120000-abcd'])
  })

  it('resumes a stopped run from the studio, and says why when it cannot', async () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-resume-route-'))
    const resumed: string[] = []
    studio = await startStudio({
      repoRoot: root,
      resume: async (id) => {
        if (id !== '20261006-120000-abcd') throw new Error('Run 20261006-120000-zzzz saved its state less than a minute ago, so it is still running somewhere.')
        resumed.push(id)
        return { runId: id, events: new EventEmitter() }
      },
    })
    const u = new URL(studio.url)
    const t = u.searchParams.get('t')
    const post = (id: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
      fetch(`${u.origin}/api/runs/${id}/resume?t=${t}`, { method: 'POST', headers, body: '{}' })
    expect(await (await fetch(`${u.origin}/api/meta?t=${t}`)).json()).toMatchObject({ canResume: true })
    expect((await post('20261006-120000-abcd', { 'content-type': 'application/json', origin: 'https://evil.test' })).status).toBe(403)
    expect((await post('20261006-120000-abcd', { 'content-type': 'text/plain' })).status).toBe(415)
    const ok = await post('20261006-120000-abcd')
    expect(ok.status).toBe(202)
    expect(await (await fetch(`${u.origin}/api/meta?t=${t}`)).json()).toMatchObject({ active: '20261006-120000-abcd' })
    const refused = await post('20261006-120000-zzzz')
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toMatch(/still running somewhere/)
    expect(resumed).toEqual(['20261006-120000-abcd'])
  })
})

describe('screen names', () => {
  it('names pages that share one title from their path', async () => {
    const { pageLabel } = await import('./discover.js')
    const title = 'glot.it – Learn Thai'
    expect(pageLabel(title, '/', [])).toBe(title)
    expect(pageLabel(title, '/words/', [{ label: title }])).toBe('Words')
    expect(pageLabel('', '/', [])).toBe('Home')
    expect(pageLabel(title, '/account/settings/', [{ label: title }])).toBe('Account / Settings')
    expect(pageLabel(title, '/words?tab=2', [{ label: title }, { label: 'Words' }])).toBe('Words (/words?tab=2)')
  })
})

describe('launcher account and last working run', () => {
  it('reads the account and plan from `agent about --format json`, and nothing else', () => {
    const out = 'Using Node v22\n{"cliVersion":"2026.10.01","subscriptionTier":"Ultra","userEmail":"dev@example.com","model":"Grok 4.7"}'
    expect(parseCursorAbout(out)).toEqual({ email: 'dev@example.com', plan: 'Ultra', usageUrl: 'https://cursor.com/dashboard/usage' })
    expect(parseCursorAbout('{"cliVersion":"x"}')).toBeNull()
    expect(parseCursorAbout('not json')).toBeNull()
  })

  it('offers the dev command of the newest run that mapped screens, never one that found none', () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-last-'))
    const write = (id: string, devCommand: string, screens: number) => {
      const dir = join(root, '.mushi', 'ux', id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 1, runId: id, options: { devCommand, startPaths: ['/practice'] }, surfaces: Array.from({ length: screens }, () => ({})) }))
    }
    write('20261006-141328-dkvu', 'npx next dev --webpack -p {port}', 3)
    write('20261007-032240-inna', 'npx next dev -p {port}', 0)
    expect(lastWorkingRun(root)).toEqual({ runId: '20261006-141328-dkvu', devCommand: 'npx next dev --webpack -p {port}', startPaths: ['/practice'] })
    expect(lastWorkingRun(join(root, 'nowhere'))).toBeNull()
  })
})
