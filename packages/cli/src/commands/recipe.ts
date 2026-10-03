import type { Command } from 'commander'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apiCall, die, fmtDate, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { MushiCliError } from '../errors.js'
import { checkRecipe, MANIFEST, pushPayload, starterManifest } from '../recipe/local.js'
import { describeCheck, localLimitExceeded, pushVerdict, type RecipePushAnswer } from '../recipe/report.js'

const SOURCE_ELEMENTS = ['gates', 'env', 'routes'] as const

interface RecipeSources {
  ok: boolean
  element: string
  reason?: string
  branch?: string
  headSha?: string
  files: Array<{ path: string; exists: boolean; content: string | null; sha: string | null; writable: boolean; reason: string | null }>
}

interface RecipeChangeJob {
  id: string
  element: string
  status: string
  pr_url: string | null
  branch: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

interface RecipeElement {
  label: string
  state: string
  reason: string
}

function headSha(dir: string): string | null {
  const env = process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? null
  if (env) return env
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function headBranch(dir: string): string {
  const env = process.env.GITHUB_REF_NAME ?? process.env.CI_COMMIT_BRANCH ?? null
  if (env) return env
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'main'
  }
}

export function registerRecipeCommands(program: Command): void {
  const recipe = program
    .command('recipe')
    .description("Your app's recipe: design tokens, routes, CI, deploy and env, so a fix uses your own system")

  recipe
    .command('init')
    .description(`Write a starter ${MANIFEST} from what this repo shows`)
    .option('--dir <path>', 'Repo root', '.')
    .option('--force', `Overwrite an existing ${MANIFEST}`)
    .action((opts: { dir: string; force?: boolean }) => {
      const root = resolve(opts.dir)
      const target = join(root, MANIFEST)
      if (existsSync(target) && !opts.force) {
        process.stderr.write(`${MANIFEST} already exists. Use --force to overwrite it.\n`)
        process.exitCode = 1
        return
      }
      writeFileSync(target, `${JSON.stringify(starterManifest(root), null, 2)}\n`)
      console.log(`Wrote ${MANIFEST}. Check the guesses, then run \`mushi recipe check\`.`)
    })

  recipe
    .command('check')
    .description(`Validate ${MANIFEST} and its token files, and score how far the code is from your design system (the same rules Mushi's scan uses)`)
    .option('--dir <path>', 'Repo root', '.')
    .option('--push', "Send the recipe and the scan to Mushi (one extra step in your existing CI job); fails when the score is above the project's limit")
    .option('--max-score <n>', 'Also fail when the deviance score (0–100) is above n, without asking Mushi')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { dir: string; push?: boolean; maxScore?: string; json?: boolean }) => {
      const root = resolve(opts.dir)
      const maxScore = opts.maxScore === undefined ? null : Number(opts.maxScore)
      if (maxScore !== null && (!Number.isInteger(maxScore) || maxScore < 0 || maxScore > 100)) {
        process.stderr.write('error: --max-score must be a whole number from 0 to 100.\n')
        process.exitCode = 1
        return
      }
      const result = checkRecipe(root)
      const json = outputIsJson(opts.json)
      const local = { ok: result.ok, issues: result.issues, tokenCount: result.tokenCount, design: result.design, findings: result.findings }
      if (json && !opts.push) console.log(JSON.stringify(local, null, 2))
      else if (!json) for (const line of describeCheck(result)) console.log(line)
      if (!result.ok) {
        process.exitCode = 1
        return
      }
      const overLocal = localLimitExceeded(result.design?.score ?? null, maxScore)
      if (overLocal) process.stderr.write(`Deviance score ${result.design?.score} is above --max-score ${maxScore}.\n`)
      if (!opts.push) {
        if (overLocal) process.exitCode = 1
        return
      }
      const sha = headSha(root)
      if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) {
        process.stderr.write('error: could not read the commit SHA (set GITHUB_SHA or run inside a git checkout).\n')
        process.exitCode = 1
        return
      }
      const config = requireConfig()
      const deviance = pushPayload(result)
      const res = await apiCall<RecipePushAnswer>('/v1/ingest/recipe', config, {
        method: 'POST',
        body: JSON.stringify({ commitSha: sha, branch: headBranch(root), files: result.files, ...(deviance ? { deviance } : {}) }),
      })
      if (!res.ok) die(res)
      const verdict = pushVerdict(res.data, maxScore, result.design?.score ?? null)
      if (json) console.log(JSON.stringify({ ...res.data, local, failed: verdict.failed }, null, 2))
      else for (const line of verdict.lines) console.log(line)
      for (const line of verdict.errors) process.stderr.write(`${line}\n`)
      if (verdict.failed) process.exitCode = 1
    })

  recipe
    .command('show')
    .description("Show this project's recipe: each part and its state")
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig({ needsProject: !opts.projectId })
      const projectId = requireUuid(opts.projectId ?? config.projectId!, 'project id')
      const res = await apiCall<{ worst: string; elements: Record<string, RecipeElement> }>(`/v1/admin/projects/${projectId}/recipe`, config)
      if (!res.ok) die(res)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(res.data, null, 2))
        return
      }
      console.log(`Worst: ${res.data.worst}`)
      for (const e of Object.values(res.data.elements)) console.log(`  ${e.state.padEnd(14)} ${e.label} — ${e.reason}`)
    })

  recipe
    .command('sources')
    .description('The repo files a recipe change may edit for one element, with the sha to send back as baseSha')
    .requiredOption('--element <element>', SOURCE_ELEMENTS.join(' | '))
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output (includes each file\'s content)')
    .action(async (opts: { element: string; projectId?: string; json?: boolean }) => {
      if (!(SOURCE_ELEMENTS as readonly string[]).includes(opts.element)) {
        throw new MushiCliError('E_INVALID_INPUT', `--element must be one of ${SOURCE_ELEMENTS.join(', ')}`)
      }
      const config = requireConfig({ needsProject: !opts.projectId })
      const projectId = requireUuid(opts.projectId ?? config.projectId!, 'project id')
      const res = await apiCall<RecipeSources>(`/v1/admin/projects/${projectId}/recipe/sources?element=${opts.element}`, config)
      if (!res.ok) die(res)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(res.data, null, 2))
        return
      }
      if (!res.data.ok) {
        console.log(`Nothing editable: ${res.data.reason ?? 'unknown reason'}`)
        return
      }
      console.log(`${res.data.element} on ${res.data.branch ?? '?'} @ ${(res.data.headSha ?? '').slice(0, 7)}`)
      for (const f of res.data.files) {
        const state = !f.exists ? 'new file' : f.content === null ? 'not shown' : `${f.content.length} chars, sha ${(f.sha ?? '').slice(0, 7)}`
        console.log(`  ${f.writable ? 'writable' : 'locked  '} ${f.path}  (${state})${f.reason ? ` — ${f.reason}` : ''}`)
      }
    })

  recipe
    .command('change <jobId>')
    .description('One recipe change job: queued, running, pr_opened, rejected or failed')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (jobId: string, opts: { projectId?: string; json?: boolean }) => {
      const id = requireUuid(jobId, 'job id')
      const config = requireConfig({ needsProject: !opts.projectId })
      const projectId = requireUuid(opts.projectId ?? config.projectId!, 'project id')
      const res = await apiCall<RecipeChangeJob>(`/v1/admin/projects/${projectId}/recipe/changes/${id}`, config)
      if (!res.ok) die(res)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(res.data, null, 2))
        return
      }
      const j = res.data
      console.log(`${j.element} change ${j.id}: ${j.status} (started ${fmtDate(j.created_at)}${j.finished_at ? `, finished ${fmtDate(j.finished_at)}` : ''})`)
      if (j.pr_url) console.log(`  Draft PR: ${j.pr_url}`)
      if (j.error) console.log(`  ${j.error}`)
    })
}
