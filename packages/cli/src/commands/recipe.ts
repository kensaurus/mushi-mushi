import type { Command } from 'commander'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apiCall, die, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { checkRecipe, MANIFEST, starterManifest } from '../recipe/local.js'

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
    .description(`Validate ${MANIFEST} and its token files, and find colours that match no token`)
    .option('--dir <path>', 'Repo root', '.')
    .option('--push', 'Send the recipe and findings to Mushi (one extra step in your existing CI job)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { dir: string; push?: boolean; json?: boolean }) => {
      const root = resolve(opts.dir)
      const result = checkRecipe(root)
      const json = outputIsJson(opts.json)
      if (json && !opts.push) {
        console.log(JSON.stringify({ ok: result.ok, issues: result.issues, tokenCount: result.tokenCount, scannedFiles: result.scannedFiles, findings: result.findings }, null, 2))
      } else if (!json) {
        console.log(`${result.ok ? 'OK' : 'FAIL'}  ${MANIFEST}: ${result.tokenCount} tokens, ${result.scannedFiles} files scanned.`)
        for (const i of result.issues) console.log(`  ${i.severity.toUpperCase().padEnd(5)} ${i.message}`)
        for (const f of result.findings.slice(0, 50)) console.log(`  WARN  ${f.filePath}:${f.line} ${f.value} matches no design token`)
        if (result.findings.length > 50) console.log(`  … and ${result.findings.length - 50} more`)
      }
      if (!result.ok) {
        process.exitCode = 1
        return
      }
      if (!opts.push) return
      const sha = headSha(root)
      if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) {
        process.stderr.write('error: could not read the commit SHA (set GITHUB_SHA or run inside a git checkout).\n')
        process.exitCode = 1
        return
      }
      const config = requireConfig()
      const res = await apiCall<{ state: string; reason: string; tokenCount: number; findingsStored: number }>('/v1/ingest/recipe', config, {
        method: 'POST',
        body: JSON.stringify({ commitSha: sha, branch: headBranch(root), files: result.files, findings: result.findings, scannedFiles: result.scannedFiles }),
      })
      if (!res.ok) die(res)
      if (json) console.log(JSON.stringify(res.data, null, 2))
      else console.log(`Sent to Mushi: ${res.data.reason} ${res.data.findingsStored} findings stored.`)
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
}
