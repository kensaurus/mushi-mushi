// SPDX-License-Identifier: MIT
/**
 * mushi-ux — run your coding agent over every screen of a running app,
 * keep the measured improvements, and watch it happen.
 *
 *   mushi-ux login    --url http://localhost:5173        (once, headed)
 *   mushi-ux discover --url http://localhost:5173        (list screens, no agent)
 *   mushi-ux run --dev "pnpm dev --port {port}" --agent claude-code
 *   mushi-ux ui                                          (studio: pick agent, model, skill; watch runs)
 *   mushi-ux open <runId>                                (dashboard for a past run)
 *
 * Shebang comes from tsup (`tsup.config.ts`).
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command, InvalidArgumentError, Option } from 'commander'
import { chromium } from 'playwright'
import { AGENTS, type AgentName } from './agents.js'
import { openSession } from './capture.js'
import { startDashboard, startStudio, type LaunchInput } from './dashboard.js'
import { discover } from './discover.js'
import { isSafeSelector } from './ignore.js'
import { DEFAULT_JUDGE_MODEL } from './judge.js'
import { agentAccount, studioOptions } from './launcher.js'
import { listModels } from './models.js'
import { DEFAULT_SKILLS_REPO, listSkills, resolveSkill, resolveSkillChain } from './skills.js'
import { startLoop, type LoopEvent, type LoopOptions } from './loop.js'
import { resumeSettings, type ResumeSettings } from './resume.js'
import { runDir } from './state.js'
import { startSync, syncConfigFromEnv, syncProjectMismatch } from './sync.js'
import { repoRootOf } from './worktree.js'

/** Open a URL in the default browser, best effort. */
function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => undefined).unref()
}

/** Per-origin browser profile, outside every repo, never named to an agent. */
export function profileDirFor(url: string): string {
  const origin = new URL(url).origin
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.cache')
  return join(base, 'mushi', 'ux-profiles', createHash('sha1').update(origin).digest('hex').slice(0, 12))
}

const collect = (v: string, prev: string[]) => [...prev, v]

type RunSettings = Omit<LoopOptions, 'repoRoot' | 'signal' | 'events'>

/** Loop options from the settings a run saved when it started, so a resume needs only its id. */
function settingsFromSaved(saved: ResumeSettings, runId: string): RunSettings {
  const o = saved.options
  if (!(o.agent in AGENTS)) throw new Error(`Run ${runId} used the agent ${o.agent}, which this version does not know.`)
  return {
    resumeRunId: runId,
    agent: o.agent as AgentName,
    model: o.model,
    devCommand: o.devCommand,
    installCommand: o.installCommand,
    startPaths: o.startPaths,
    crawl: o.crawl,
    iterations: o.iterations,
    maxSurfaces: o.maxSurfaces,
    agentTimeoutMs: o.agentTimeoutMs,
    skill: saved.skill,
    allow: o.allow,
    ignore: o.ignore,
    judgeModel: o.judgeModel ?? null,
    loginUrl: o.loginUrl ?? null,
    profileDir: o.loginUrl ? profileDirFor(o.loginUrl) : undefined,
    sync: o.sync,
    steps: o.steps,
    checker: o.checker ?? null,
    keepInvisible: o.keepInvisible,
  }
}
const collectSelector = (v: string, prev: string[]) => {
  if (!isSafeSelector(v.trim())) throw new InvalidArgumentError('Not a usable CSS selector (no { } < > ; or backslash, at most 200 characters).')
  return [...prev, v.trim()]
}

const program = new Command()
  .name('mushi-ux')
  .description('Run a coding agent over every screen of your app, one at a time, and keep only measured improvements.')

program
  .command('login')
  .description('Open a browser window to sign in to your app once; later runs reuse the session.')
  .requiredOption('--url <url>', 'Your app, e.g. http://localhost:5173')
  .action(async (o: { url: string }) => {
    const dir = profileDirFor(o.url)
    const ctx = await chromium.launchPersistentContext(dir, { headless: false })
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(o.url)
    console.log('Sign in, then close the browser window. The session stays on this machine only.')
    await new Promise<void>((r) => ctx.on('close', () => r()))
  })

program
  .command('discover')
  .description('List the screens (pages, tabs, dialogs) the loop would work on. Nothing is edited.')
  .requiredOption('--url <url>', 'Running app, e.g. http://localhost:5173')
  .option('--path <path>', 'Start path (repeatable)', collect, [])
  .option('--allow <rule>', 'Allow a non-GET request that only reads, e.g. "POST /rest/v1/rpc/*" (repeatable)', collect, [])
  .option('--ignore <selector>', 'CSS selector that is not part of the app: hidden in screenshots, skipped by checks (repeatable)', collectSelector, [])
  .option('--max-pages <n>', 'Stop after this many pages', '40')
  .option('--src <dir>', 'Read routes from this source directory (default: the current directory)', '.')
  .option('--no-profile', 'Ignore the signed-in session from `login`')
  .action(async (o: { url: string; path: string[]; allow: string[]; ignore: string[]; maxPages: string; src: string; profile: boolean }) => {
    const session = await openSession({ profileDir: o.profile ? profileDirFor(o.url) : undefined, allow: o.allow, ignore: o.ignore })
    try {
      const surfaces = await discover(session, {
        baseUrl: o.url,
        startPaths: o.path,
        sourceDir: o.src,
        maxPages: Number(o.maxPages),
        onProgress: (m) => process.stderr.write(`  ${m}\n`),
      })
      for (const s of surfaces) console.log(`${s.kind.padEnd(6)} ${s.path}${s.steps.length ? ' › ' + s.steps.map((x) => x.label).join(' › ') : ''}`)
      console.log(`\n${surfaces.length} screen(s). Blocked ${session.guard.blocked.length} write request(s) while exploring.`)
    } finally {
      await session.close()
    }
  })

program
  .command('run')
  .description('Create a worktree, start your dev server in it, and run the agent screen by screen.')
  .option('--dev <command>', 'Dev server command; {port} is replaced, PORT is also set. e.g. "pnpm dev --port {port}". Not needed with --resume.')
  .addOption(new Option('--agent <name>', 'Coding agent').choices(Object.keys(AGENTS)).default('claude-code'))
  .option('--model <id>', 'Model for the agent; `mushi-ux models --agent <name>` lists what your account has')
  .option('--path <path>', 'A page to work on (repeatable); with --path, only those pages and the tabs and dialogs they open', collect, [])
  .option('--crawl', 'With --path: also follow links from those pages')
  .option('--steps', 'Plan each screen into small steps first, then make one step per attempt (--iterations caps the steps)')
  .option('--iterations <n>', 'Attempts per screen', '2')
  .option('--max-surfaces <n>', 'Screens to work on', '10')
  .option('--timeout <minutes>', 'Time box per agent attempt', '10')
  .option('--skill <names|path>', 'Skill to apply: a name from the skills package, several names comma-separated to chain them in order, or a SKILL.md / skill folder')
  .option('--skills-repo <repo>', 'Where skill names come from: npm:@scope/pkg[@version] or owner/repo[@ref] on GitHub', DEFAULT_SKILLS_REPO)
  .option('--base <ref>', 'Branch the run from this ref (e.g. origin/main) instead of HEAD', 'HEAD')
  .option('--allow <rule>', 'Allow a non-GET request that only reads (repeatable)', collect, [])
  .option('--ignore <selector>', 'CSS selector that is not part of the app: hidden in screenshots, skipped by checks (repeatable)', collectSelector, [])
  .option('--install <command>', 'Install command for the worktree (default: from the lockfile; "none" to skip)')
  .option('--login-url <url>', 'Reuse the session saved by `mushi-ux login --url <url>`')
  .option('--judge-model <id>', 'Model for the final before/after review (your Anthropic credentials)', DEFAULT_JUDGE_MODEL)
  .option('--no-judge', 'Skip the final review')
  .option('--checker <model>', 'A second model that reviews each kept step and may roll it back, never keep a rejected one (e.g. claude-opus-5-5)')
  .option('--checker-via <how>', 'claude-code (your Claude sign-in) or anthropic-api (ANTHROPIC_API_KEY)', 'claude-code')
  .option('--no-keep-invisible', 'Roll back edits with nothing visible in a screenshot instead of keeping them for review')
  .option('--resume <runId>', 'Continue a stopped run with the settings it started with (other run options are ignored)')
  .option('--no-preflight', 'Skip the one-minute check that the agent can read files')
  .option('--no-dashboard', 'Do not start the local dashboard')
  .option('--sync', 'Mirror the run to the Mushi console (uses MUSHI_API_KEY / MUSHI_PROJECT_ID; `mushi ux` passes your login)')
  .action(
    async (o: {
      dev?: string
      agent: AgentName
      model?: string
      path: string[]
      iterations: string
      maxSurfaces: string
      timeout: string
      skill?: string
      skillsRepo: string
      base: string
      allow: string[]
      ignore: string[]
      install?: string
      loginUrl?: string
      resume?: string
      crawl?: boolean
      steps?: boolean
      sync?: boolean
      judgeModel: string
      judge: boolean
      checker?: string
      checkerVia: string
      keepInvisible: boolean
      dashboard: boolean
      preflight: boolean
    }) => {
      const repoRoot = await repoRootOf(process.cwd())
      let settings: RunSettings
      let wantSync = Boolean(o.sync)
      if (o.resume && !o.dev) {
        try {
          const saved = resumeSettings(repoRoot, o.resume)
          settings = { ...settingsFromSaved(saved, o.resume), preflight: o.preflight, judgeModel: o.judge ? (saved.options.judgeModel ?? null) : null }
          wantSync = wantSync || Boolean(saved.options.sync)
          console.log(`Resuming ${o.resume} with the settings it started with: ${saved.options.agent}${saved.options.model ? ` ${saved.options.model}` : ''}, ${saved.options.devCommand}.`)
        } catch (err) {
          console.error((err as Error).message)
          process.exit(2)
        }
      } else if (!o.dev) {
        console.error('--dev is required (or --resume <runId> to continue a run with the settings it started with).')
        process.exit(2)
      } else {
        settings = {
          crawl: o.crawl,
          devCommand: o.dev,
          installCommand: o.install === 'none' ? null : o.install,
          startPaths: o.path.length ? o.path : undefined,
          agent: o.agent,
          model: o.model ?? null,
          iterations: Number(o.iterations),
          maxSurfaces: Number(o.maxSurfaces),
          agentTimeoutMs: Number(o.timeout) * 60_000,
          skill: o.skill ? await resolveSkillChain(o.skill, { repo: o.skillsRepo }) : null,
          baseRef: o.base,
          allow: o.allow,
          ignore: o.ignore,
          loginUrl: o.loginUrl ?? null,
          profileDir: o.loginUrl ? profileDirFor(o.loginUrl) : undefined,
          resumeRunId: o.resume,
          preflight: o.preflight,
          judgeModel: o.judge ? o.judgeModel : null,
          sync: o.sync,
          steps: o.steps,
          checker: o.checker ? { via: o.checkerVia === 'anthropic-api' ? 'anthropic-api' : 'claude-code', model: o.checker } : null,
          keepInvisible: o.keepInvisible,
        }
      }
      const adapter = AGENTS[settings.agent]
      if (!adapter.verified) {
        console.warn(`Note: the ${settings.agent} adapter is not verified on every platform yet. Report problems with \`mushi feedback\`.`)
      }
      // Read the console credentials first, then drop them from this process,
      // so neither the install, the dev server (dotenv never overrides an
      // existing variable) nor the agent inherits the CLI's key.
      const syncCfg = wantSync ? syncConfigFromEnv() : null
      if (wantSync && !syncCfg) {
        console.error('--sync needs MUSHI_API_KEY and MUSHI_PROJECT_ID (run it as `mushi ux run … --sync` after `mushi login`).')
        process.exit(2)
      }
      const mismatch = syncCfg ? syncProjectMismatch(syncCfg, repoRoot) : null
      if (mismatch) {
        console.error(mismatch)
        process.exit(2)
      }
      for (const k of ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT']) delete process.env[k]
      const events = new EventEmitter()
      events.on('event', (e: LoopEvent) => {
        if (e.type === 'log') console.log(e.message)
      })
      // Ctrl+C stops between steps, kills a running agent and the dev server, and keeps the state.
      const abort = new AbortController()
      process.once('SIGINT', () => {
        console.log('\nStopping… (Ctrl+C again to force)')
        abort.abort()
        process.once('SIGINT', () => process.exit(130))
      })
      const handle = startLoop({ ...settings, repoRoot, signal: abort.signal, events })
      const sync = syncCfg ? startSync(handle.dir, syncCfg, events, (m) => console.warn(m)) : null
      if (syncCfg) console.log(`Syncing to the console (project ${syncCfg.projectId}).`)
      const dash = o.dashboard ? await startDashboard(handle.dir, events) : null
      if (dash) console.log(`Live view: ${dash.url}`)
      console.log(`Run ${handle.runId} — state in ${handle.dir}`)
      try {
        const state = await handle.done
        const by = (st: string) => state.surfaces.filter((s) => s.status === st).length
        console.log(
          `\nImproved ${by('accepted')}, rolled back ${by('reverted')}, unchanged ${by('skipped')}, moved by another change ${by('regressed')}, not finished ${by('blocked')}.`,
        )
        if (state.branch) console.log(`Review: git log ${state.baseSha?.slice(0, 8)}..${state.branch}`)
        if (sync) {
          const err = await sync.finish()
          console.log(err ? `Console sync did not finish: ${err}. Re-run with --resume ${state.runId} --sync to retry.` : 'Synced to the console (Check → UX runs).')
        }
        if (dash) {
          console.log('The dashboard stays up until you press Ctrl+C.')
          await new Promise(() => {})
        }
      } finally {
        await dash?.close()
      }
    },
  )

program
  .command('ui')
  .description('Open the studio: pick an agent, a model from your account and a skill, start a run, and watch every attempt.')
  .option('--port <n>', 'Port on 127.0.0.1 (default: any free port)', '0')
  .option('--skills-repo <repo>', 'Where skill names come from: npm:@scope/pkg[@version] or owner/repo[@ref] on GitHub', DEFAULT_SKILLS_REPO)
  .option('--login-url <url>', 'Reuse the session saved by `mushi-ux login --url <url>`')
  .option('--allow <rule>', 'Allow a non-GET request that only reads (repeatable)', collect, [])
  .option('--no-open', 'Do not open the browser')
  .action(async (o: { port: string; skillsRepo: string; loginUrl?: string; allow: string[]; open: boolean }) => {
    const repoRoot = await repoRootOf(process.cwd())
    // Read the console credentials, then drop them so nothing spawned inherits them.
    const syncCfg = syncConfigFromEnv()
    const mismatch = syncCfg ? syncProjectMismatch(syncCfg, repoRoot) : null
    for (const k of ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT']) delete process.env[k]
    const modelCache = new Map<string, ReturnType<typeof listModels>>()
    const running = new Map<string, AbortController>()
    /** One path for new and resumed runs: start the loop, mirror it when asked, track it for Stop. */
    const startRun = (settings: RunSettings, wantSync: boolean) => {
      // Refuse before anything starts: a run must never land on another app's project.
      if (wantSync && mismatch) throw new Error(mismatch)
      const events = new EventEmitter()
      events.on('event', (e: LoopEvent) => {
        if (e.type === 'log') console.log(e.message)
      })
      const abort = new AbortController()
      const handle = startLoop({ ...settings, repoRoot, signal: abort.signal, events })
      const sync = wantSync && syncCfg ? startSync(handle.dir, syncCfg, events, (m) => console.warn(m)) : null
      running.set(handle.runId, abort)
      void handle.done.finally(() => running.delete(handle.runId)).catch(() => undefined)
      handle.done
        .then(async () => {
          const err = sync ? await sync.finish() : null
          if (err) console.warn(`Console sync did not finish: ${err}`)
        })
        .catch(async (err: Error) => {
          console.error(`Run ${handle.runId} stopped: ${err.message}`)
          if (sync) await sync.finish()
        })
      console.log(`Run ${handle.runId} ${settings.resumeRunId ? 'resumed' : 'started'}.`)
      return { runId: handle.runId, events }
    }
    const launch = async (input: LaunchInput) => {
      if (!(input.agent in AGENTS)) throw new Error(`Unknown agent ${input.agent}`)
      const skill = input.skill ? await resolveSkillChain(input.skill, { repo: o.skillsRepo }) : null
      return startRun(
        {
          crawl: input.crawl,
          devCommand: input.devCommand,
          startPaths: input.startPaths.length ? input.startPaths : undefined,
          agent: input.agent as AgentName,
          model: input.model,
          iterations: input.iterations,
          maxSurfaces: input.maxSurfaces,
          agentTimeoutMs: input.timeoutMin * 60_000,
          skill,
          baseRef: input.baseRef,
          allow: o.allow,
          ignore: input.ignore,
          loginUrl: o.loginUrl ?? null,
          profileDir: o.loginUrl ? profileDirFor(o.loginUrl) : undefined,
          judgeModel: input.judgeModel,
          sync: input.sync,
          steps: input.steps,
          checker: input.checkerModel ? { via: input.checkerVia, model: input.checkerModel } : null,
          keepInvisible: input.keepInvisible,
        },
        input.sync,
      )
    }
    const resume = async (runId: string) => {
      if (running.has(runId)) throw new Error('This run is already running here.')
      const saved = resumeSettings(repoRoot, runId)
      return startRun(settingsFromSaved(saved, runId), Boolean(saved.options.sync))
    }
    const studio = await startStudio({
      repoRoot,
      port: Number(o.port),
      launch,
      resume,
      stop: (runId) => {
        const abort = running.get(runId)
        if (!abort) return false
        abort.abort()
        return true
      },
      listModels: (agent) => {
        // Cache a live list for the session; retry anything else next time.
        const hit = modelCache.get(agent)
        if (hit) return hit
        const p = listModels(agent)
        modelCache.set(agent, p)
        void p.then((l) => {
          if (l.source !== 'live') modelCache.delete(agent)
        })
        return p
      },
      listSkills: () => listSkills({ repo: o.skillsRepo }),
      account: (agent) => agentAccount(agent),
      skillInfo: async (name) => {
        const sk = await resolveSkill(name, { repo: o.skillsRepo })
        return { name: sk.name, related: sk.related ?? [] }
      },
      options: () =>
        studioOptions({
          repoRoot,
          skillsRepo: o.skillsRepo,
          syncAvailable: Boolean(syncCfg) && !mismatch,
          syncNote: mismatch
            ? mismatch
            : syncCfg
            ? `Project ${syncCfg.projectId}`
            : 'Start the studio with `mushi ux ui` after `mushi login` to mirror runs to the console.',
        }),
    })
    console.log(`Studio: ${studio.url}\n(Ctrl+C to stop; runs keep their state in .mushi/ux/)`)
    if (o.open) openInBrowser(studio.url)
  })

program
  .command('models')
  .description('List the models an agent can use, read live from your account where the agent allows it.')
  .addOption(new Option('--agent <name>', 'Coding agent').choices(Object.keys(AGENTS)).default('cursor'))
  .option('--json', 'Print JSON')
  .action(async (o: { agent: string; json?: boolean }) => {
    const list = await listModels(o.agent)
    if (o.json) return console.log(JSON.stringify(list, null, 2))
    for (const m of list.models) {
      const params = m.params?.map((p) => `${p.id}=${p.values.map((v) => v.value).join('|')}`).join(' ')
      console.log(`${m.id.padEnd(36)} ${m.label === m.id ? '' : m.label}${params ? `  [${params}]` : ''}${m.isDefault ? '  (default)' : ''}`)
    }
    if (list.note) console.log(`\n${list.note}`)
  })

program
  .command('skills')
  .description('List the skills --skill accepts by name.')
  .option('--skills-repo <repo>', 'npm:@scope/pkg[@version] or owner/repo[@ref]', DEFAULT_SKILLS_REPO)
  .action(async (o: { skillsRepo: string }) => {
    const skills = await listSkills({ repo: o.skillsRepo })
    let group: string | null | undefined
    for (const s of skills) {
      if (s.group !== group) {
        group = s.group
        console.log(`\n${group ?? 'Skills'}`)
      }
      console.log(`  ${s.name}`)
    }
  })

program
  .command('open')
  .description('Open the dashboard for a past run.')
  .argument('<runId>')
  .action(async (runId: string) => {
    const dir = runDir(await repoRootOf(process.cwd()), runId)
    const dash = await startDashboard(dir)
    console.log(`Dashboard: ${dash.url}  (Ctrl+C to stop)`)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
