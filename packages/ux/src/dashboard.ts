// SPDX-License-Identifier: MIT
/**
 * The local studio: start a run (agent, model, skill, pages) and watch it:
 * phase and progress, the burndown, every attempt's screenshot against the
 * baseline with a slider and a diff overlay, problem scores, and the agent's
 * output as it streams. Served on 127.0.0.1 only, behind a random token,
 * reading nothing but `.mushi/ux/` in the repo.
 *
 * `mushi-ux ui` opens it with the launcher; `mushi-ux run` and `open` open it
 * on one run, read-only.
 */

import { randomBytes } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { z } from 'zod'
import { PNG } from 'pngjs'
import { attemptLogBase } from './agent-events.js'
import { changeRegions } from './image.js'
import { isSafeSelector } from './ignore.js'
import type { AgentAccount } from './launcher.js'
import type { LoopEvent } from './loop.js'
import type { ModelList } from './models.js'
import type { SkillListItem } from './skills.js'
import { loadState, type RunState } from './state.js'
import { STUDIO_PAGE } from './studio-page.js'

export interface Dashboard {
  url: string
  close(): Promise<void>
}

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/

/** Pure: resolve a requested shot path inside the run dir, or null if it escapes. */
export function safeShotPath(runDirPath: string, requested: string): string | null {
  if (!/^shots\/[\w./-]+\.png$/.test(requested) || requested.includes('..')) return null
  const abs = normalize(join(runDirPath, requested))
  return abs.startsWith(normalize(runDirPath) + sep) ? abs : null
}

/** What the launcher form sends. Everything is checked here before a run starts. */
export const LaunchInput = z
  .object({
    agent: z.string().regex(/^[a-z][a-z-]{1,30}$/),
    model: z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/?=&-]*$/).nullable().default(null),
    skill: z.string().max(300).nullable().default(null),
    devCommand: z.string().min(1).max(500),
    baseRef: z.string().max(200).regex(/^[\w./@^~-]+$/).default('HEAD'),
    startPaths: z.array(z.string().regex(/^\/[^\s]{0,200}$/)).max(20).default([]),
    iterations: z.number().int().min(1).max(5).default(2),
    maxSurfaces: z.number().int().min(1).max(100).default(10),
    timeoutMin: z.number().int().min(1).max(60).default(10),
    judgeModel: z.string().max(120).nullable().default(null),
    /** Follow links from the start pages too; off visits only the pages named. */
    crawl: z.boolean().default(false),
    /** Plan each screen into small steps, then one step per attempt. */
    steps: z.boolean().default(false),
    /** A second model that may roll a kept step back (ADR 0021); null = measurements alone. */
    checkerModel: z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).nullable().default(null),
    checkerVia: z.enum(['claude-code', 'anthropic-api']).default('claude-code'),
    /** Keep edits with nothing visible, flagged for review. */
    keepInvisible: z.boolean().default(true),
    /** Selectors that are not the app's UI; added to DEFAULT_IGNORE. */
    ignore: z
      .array(z.string().trim().refine(isSafeSelector, 'Not a usable CSS selector (no { } < > ; or backslash, at most 200 characters).'))
      .max(20)
      .default([]),
    sync: z.boolean().default(false),
  })
  .strict()
export type LaunchInput = z.infer<typeof LaunchInput>

export interface StudioOptions {
  repoRoot: string
  /** Loop events of a run started outside the studio (`mushi-ux run`). */
  events?: EventEmitter
  /** Run to show first. */
  runId?: string
  /** Enables the launcher: starts a run and returns its id and event stream. */
  launch?: (input: LaunchInput) => Promise<{ runId: string; events: EventEmitter }>
  /** Stops a run this studio started; false when it is not running here. */
  stop?: (runId: string) => boolean
  /** Opens the finished run's PR (or adds it to its base branch's PR); rejects with the reason it cannot. */
  openPr?: (runId: string) => Promise<{ url: string; number: number; added: boolean }>
  /** Continues a stopped run with its saved settings; rejects with the reason it cannot. */
  resume?: (runId: string) => Promise<{ runId: string; events: EventEmitter }>
  listModels?: (agent: string) => Promise<ModelList>
  listSkills?: () => Promise<SkillListItem[]>
  /** One skill's hand-offs, for the launcher's "next skill" suggestions. */
  skillInfo?: (name: string) => Promise<{ name: string; related: string[] }>
  /** The account an agent would spend (null when the agent does not say). */
  account?: (agent: string) => Promise<AgentAccount | null>
  /** Launcher defaults: agents found, dev command guesses, refs, page suggestions. */
  options?: () => Promise<Record<string, unknown>>
  port?: number
}

interface RunSummary {
  runId: string
  createdAt: string
  agent: string
  model: string | null
  skill: string | null
  phase: string | null
  total: number
  done: number
}

function summarize(s: RunState): RunSummary {
  const finished = new Set(['accepted', 'reverted', 'skipped', 'regressed', 'blocked'])
  return {
    runId: s.runId,
    createdAt: s.createdAt,
    agent: s.agent,
    model: s.model,
    skill: s.skill?.name ?? null,
    phase: s.phase ?? null,
    total: s.surfaces.length,
    done: s.surfaces.filter((x) => finished.has(x.status)).length,
  }
}

async function readBody(req: IncomingMessage, limit = 64_000): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('Request too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function startStudio(opts: StudioOptions): Promise<Dashboard> {
  const token = randomBytes(16).toString('hex')
  const uxDir = join(opts.repoRoot, '.mushi', 'ux')
  const clients = new Set<ServerResponse>()
  let active: { runId: string; events: EventEmitter } | null = null
  const send = (payload: unknown) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) res.write(data)
  }
  const subscribe = (runId: string, events: EventEmitter) => {
    const onEvent = (e: LoopEvent) => send({ ...e, runId })
    events.on('event', onEvent)
    return () => events.off('event', onEvent)
  }
  const unsubscribers: Array<() => void> = []
  if (opts.events && opts.runId) {
    active = { runId: opts.runId, events: opts.events }
    unsubscribers.push(subscribe(opts.runId, opts.events))
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const runDirOf = (runId: string | null) => (runId && RUN_ID_RE.test(runId) ? join(uxDir, runId) : null)

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.searchParams.get('t') !== token) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      return res.end('Open the link printed by mushi-ux; it carries the access token.')
    }
    const handle = async () => {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(STUDIO_PAGE)
      }
      if (req.method === 'GET' && url.pathname === '/api/meta') {
        return json(res, 200, { launcher: Boolean(opts.launch), canStop: Boolean(opts.stop), canResume: Boolean(opts.resume), canOpenPr: Boolean(opts.openPr), active: active?.runId ?? null, initial: opts.runId ?? null, repo: basename(opts.repoRoot) })
      }
      if (req.method === 'GET' && url.pathname === '/api/runs') {
        const ids = existsSync(uxDir) ? readdirSync(uxDir).filter((d) => RUN_ID_RE.test(d)) : []
        const runs = ids
          .map((id) => loadState(join(uxDir, id)))
          .filter((s): s is RunState => s !== null)
          .map(summarize)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return json(res, 200, { runs })
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const dir = runDirOf(url.searchParams.get('run'))
        return json(res, 200, dir ? loadState(dir) : null)
      }
      if (req.method === 'GET' && url.pathname === '/api/log') {
        const dir = runDirOf(url.searchParams.get('run'))
        const file = dir ? join(dir, 'run.log') : null
        const lines = file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-400) : []
        return json(res, 200, { lines })
      }
      if (req.method === 'GET' && url.pathname === '/api/steps') {
        // The agent's readable steps for one screen's attempt (latest when
        // attempt is absent), so a reloaded page still shows what it is doing.
        const dir = runDirOf(url.searchParams.get('run'))
        const key = url.searchParams.get('surface') ?? ''
        const n = url.searchParams.get('attempt')
        if (!dir || !/^[\w.:-]{1,160}$/.test(key) || (n !== null && !/^[0-9]{1,2}$/.test(n))) return json(res, 400, { error: 'bad request' })
        const agentDir = join(dir, 'agent')
        const prefix = attemptLogBase(key, 0).slice(0, -1)
        const attempts = existsSync(agentDir)
          ? readdirSync(agentDir)
              .map((f) => (f.startsWith(prefix) && f.endsWith('.steps.log') ? Number(f.slice(prefix.length, -'.steps.log'.length)) : NaN))
              .filter((a) => Number.isInteger(a) && a > 0)
          : []
        const attempt = n !== null ? Number(n) : attempts.length ? Math.max(...attempts) : null
        const file = attempt !== null && attempts.includes(attempt) ? join(agentDir, `${prefix}${attempt}.steps.log`) : null
        const lines = file ? readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-200) : []
        return json(res, 200, { attempt, lines })
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write(': connected\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }
      if (req.method === 'GET' && url.pathname === '/shot') {
        const dir = runDirOf(url.searchParams.get('run'))
        const abs = dir ? safeShotPath(dir, url.searchParams.get('p') ?? '') : null
        if (!abs || !existsSync(abs)) {
          res.writeHead(404)
          return res.end()
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' })
        return res.end(readFileSync(abs))
      }
      // Change areas from a saved diff image, for attempts recorded before they were stored.
      if (req.method === 'GET' && url.pathname === '/api/changes') {
        const dir = runDirOf(url.searchParams.get('run'))
        const abs = dir ? safeShotPath(dir, url.searchParams.get('p') ?? '') : null
        if (!abs || !existsSync(abs)) return json(res, 404, { error: 'No such diff image' })
        const png = PNG.sync.read(readFileSync(abs))
        return json(res, 200, { width: png.width, height: png.height, boxes: changeRegions(png) })
      }
      if (req.method === 'GET' && url.pathname === '/api/options') {
        return json(res, 200, opts.options ? await opts.options() : {})
      }
      if (req.method === 'GET' && url.pathname === '/api/models') {
        const agent = url.searchParams.get('agent') ?? ''
        if (!opts.listModels || !/^[a-z][a-z-]{1,30}$/.test(agent)) return json(res, 400, { error: 'Unknown agent' })
        return json(res, 200, await opts.listModels(agent))
      }
      if (req.method === 'GET' && url.pathname === '/api/skill') {
        const name = url.searchParams.get('name') ?? ''
        if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name) || !opts.skillInfo) return json(res, 400, { error: 'Unknown skill' })
        return json(res, 200, await opts.skillInfo(name).catch(() => ({ name, related: [] })))
      }
      if (req.method === 'GET' && url.pathname === '/api/account') {
        const agent = url.searchParams.get('agent') ?? ''
        if (!/^[a-z][a-z-]{1,30}$/.test(agent)) return json(res, 400, { error: 'Unknown agent' })
        return json(res, 200, { account: opts.account ? await opts.account(agent).catch(() => null) : null })
      }
      if (req.method === 'GET' && url.pathname === '/api/skills') {
        if (!opts.listSkills) return json(res, 200, { skills: [] })
        const skills = await opts.listSkills().catch((err: Error) => {
          throw new Error(`Could not list skills: ${err.message}`)
        })
        return json(res, 200, { skills })
      }
      const stopMatch = url.pathname.match(/^\/api\/runs\/([0-9]{8}-[0-9]{6}-[a-z0-9]{4})\/stop$/)
      if (req.method === 'POST' && stopMatch) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${(server.address() as AddressInfo).port}`) return json(res, 403, { error: 'Wrong origin' })
        if (!opts.stop?.(stopMatch[1])) return json(res, 409, { error: 'That run is not running in this studio.' })
        return json(res, 202, { stopping: true })
      }
      const prMatch = url.pathname.match(/^\/api\/runs\/([0-9]{8}-[0-9]{6}-[a-z0-9]{4})\/pr$/)
      if (req.method === 'POST' && prMatch) {
        if (!opts.openPr) return json(res, 404, { error: 'This view is read-only. Start the studio with `mushi-ux ui`.' })
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${(server.address() as AddressInfo).port}`) return json(res, 403, { error: 'Wrong origin' })
        const pr = await opts.openPr(prMatch[1]).catch((err: Error) => err)
        if (pr instanceof Error) return json(res, 409, { error: pr.message })
        return json(res, 201, pr)
      }
      const resumeMatch = url.pathname.match(/^\/api\/runs\/([0-9]{8}-[0-9]{6}-[a-z0-9]{4})\/resume$/)
      if (req.method === 'POST' && resumeMatch) {
        if (!opts.resume) return json(res, 404, { error: 'This view is read-only. Start the studio with `mushi-ux ui`.' })
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${(server.address() as AddressInfo).port}`) return json(res, 403, { error: 'Wrong origin' })
        if (active && active.runId !== resumeMatch[1]) {
          const state = loadState(join(uxDir, active.runId))
          if (state && !['done', 'failed'].includes(state.phase ?? '')) return json(res, 409, { error: `Run ${active.runId} is still going. Stop it first.` })
        }
        // Not resumable (still alive elsewhere, finished, from before saved settings): say why, as a 409.
        const started = await opts.resume(resumeMatch[1]).catch((err: Error) => err)
        if (started instanceof Error) return json(res, 409, { error: started.message })
        active = started
        unsubscribers.push(subscribe(started.runId, started.events))
        send({ type: 'started', runId: started.runId })
        return json(res, 202, { runId: started.runId })
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        if (!opts.launch) return json(res, 404, { error: 'This view is read-only. Start the studio with `mushi-ux ui`.' })
        // A form post from another site cannot set this header or read the token.
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${(server.address() as AddressInfo).port}`) return json(res, 403, { error: 'Wrong origin' })
        if (active) {
          const state = loadState(join(uxDir, active.runId))
          if (state && !['done', 'failed'].includes(state.phase ?? '')) return json(res, 409, { error: `Run ${active.runId} is still going.` })
        }
        const parsed = LaunchInput.safeParse(await readBody(req))
        if (!parsed.success) return json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid settings' })
        const started = await opts.launch(parsed.data)
        active = started
        unsubscribers.push(subscribe(started.runId, started.events))
        send({ type: 'started', runId: started.runId })
        return json(res, 201, { runId: started.runId })
      }
      res.writeHead(404)
      res.end()
    }
    handle().catch((err: Error) => {
      if (!res.headersSent) json(res, 500, { error: err.message.slice(0, 500) })
      else res.end()
    })
  })
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r))
  const { port: bound } = server.address() as AddressInfo
  const initial = opts.runId ? `&run=${opts.runId}` : ''
  return {
    url: `http://127.0.0.1:${bound}/?t=${token}${initial}`,
    close: () =>
      new Promise<void>((r) => {
        for (const off of unsubscribers) off()
        for (const res of clients) res.end()
        server.close(() => r())
      }),
  }
}

/** One run, read-only (used by `mushi-ux run` and `open`). `dir` is `<repo>/.mushi/ux/<runId>`. */
export async function startDashboard(dir: string, events?: EventEmitter, port = 0): Promise<Dashboard> {
  const repoRoot = dirname(dirname(dirname(dir)))
  return startStudio({ repoRoot, events, runId: basename(dir), port })
}
