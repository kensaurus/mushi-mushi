/**
 * FILE: packages/cli/src/init.ts
 * PURPOSE: `mushi init` wizard — detects framework, asks for credentials,
 *          installs the right SDK, writes env vars, prints next-step snippet.
 *
 * Modeled on the Sentry / PostHog wizard pattern: one shell command, minimal
 * prompts, transparent about every file it touches.
 */

import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectFramework,
  detectPackageManager,
  envVarsToWrite,
  FRAMEWORKS,
  installCommand,
  readPackageJson,
  type Framework,
  type FrameworkId,
  type PackageManager,
} from './detect.js'
import { loadConfig, saveConfig } from './config.js'

export interface InitOptions {
  cwd?: string
  projectId?: string
  apiKey?: string
  framework?: FrameworkId
  skipInstall?: boolean
  yes?: boolean
}

const ENV_FILES = ['.env.local', '.env'] as const

export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()

  p.intro('🐛 Mushi Mushi setup wizard')

  const pkg = readPackageJson(cwd)
  if (!pkg) {
    p.log.warn('No package.json found in this directory.')
    const cont = await p.confirm({
      message: 'Continue anyway? (Mushi will install into the current folder)',
      initialValue: false,
    })
    if (p.isCancel(cont) || !cont) {
      p.cancel('Aborted. Run from your project root and try again.')
      process.exit(0)
    }
  }

  const detected = detectFramework(cwd, pkg)
  const framework = await chooseFramework(detected, options)

  const credentials = await collectCredentials(options)

  const pm = detectPackageManager(cwd)
  const packagesToInstall = framework.needsWebPackage
    ? [framework.packageName, '@mushi-mushi/web']
    : [framework.packageName]

  if (!options.skipInstall) {
    await installPackages(pm, packagesToInstall)
  } else {
    p.log.info(`Skipped install. Run \`${installCommand(pm, packagesToInstall)}\` yourself.`)
  }

  writeEnvFile(cwd, credentials.apiKey, credentials.projectId, framework)
  persistCliConfig(credentials.apiKey, credentials.projectId)

  printNextSteps(framework, credentials.apiKey, credentials.projectId)

  p.outro('Setup complete. Happy bug squashing 🐛')
}

async function chooseFramework(detected: Framework, options: InitOptions): Promise<Framework> {
  if (options.framework) {
    const explicit = FRAMEWORKS[options.framework]
    if (!explicit) throw new Error(`Unknown framework: ${options.framework}`)
    p.log.step(`Using framework: ${explicit.label} (from --framework)`)
    return explicit
  }

  if (options.yes) {
    p.log.step(`Detected ${detected.label} → installing ${detected.packageName}`)
    return detected
  }

  const confirmed = await p.select({
    message: `Detected ${detected.label}. Use this?`,
    initialValue: detected.id,
    options: Object.values(FRAMEWORKS).map((fw) => ({
      value: fw.id,
      label: `${fw.id === detected.id ? '✓ ' : '  '}${fw.label}`,
      hint: fw.packageName,
    })),
  })

  if (p.isCancel(confirmed)) {
    p.cancel('Aborted.')
    process.exit(0)
  }

  return FRAMEWORKS[confirmed]
}

async function collectCredentials(options: InitOptions): Promise<{ apiKey: string; projectId: string }> {
  const existing = loadConfig()

  const projectId = options.projectId ?? existing.projectId ?? (await promptText({
    message: 'Project ID',
    placeholder: 'proj_xxxxxxxxxxxx',
    hint: 'Find this at https://kensaur.us/mushi-mushi/projects',
  }))

  const apiKey = options.apiKey ?? existing.apiKey ?? (await promptText({
    message: 'API key',
    placeholder: 'mushi_xxxxxxxxxxxx',
    hint: 'Treat this like a password — it goes in your env file, not in source.',
  }))

  return { projectId, apiKey }
}

async function promptText(opts: { message: string; placeholder?: string; hint?: string }): Promise<string> {
  const value = await p.text({
    message: opts.message,
    placeholder: opts.placeholder,
    validate: (v) => (v.length === 0 ? 'Required' : undefined),
  })
  if (p.isCancel(value)) {
    p.cancel('Aborted.')
    process.exit(0)
  }
  if (opts.hint) p.log.info(opts.hint)
  return value
}

async function installPackages(pm: PackageManager, packages: string[]): Promise<void> {
  const command = installCommand(pm, packages)
  const spinner = p.spinner()
  spinner.start(`Installing ${packages.join(', ')} via ${pm}…`)

  try {
    await runCommand(pm, packages)
    spinner.stop(`Installed ${packages.join(', ')}`)
  } catch (err) {
    spinner.stop(`Install failed — run \`${command}\` manually.`)
    p.log.error(err instanceof Error ? err.message : String(err))
  }
}

function runCommand(pm: PackageManager, packages: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const verb = pm === 'npm' ? 'install' : 'add'
    const child = spawn(pm, [verb, ...packages], { stdio: 'inherit', shell: true })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${pm} exited with code ${code}`))
    })
  })
}

function writeEnvFile(cwd: string, apiKey: string, projectId: string, framework: Framework): void {
  const target = ENV_FILES.find((f) => existsSync(join(cwd, f))) ?? ENV_FILES[0]
  const targetPath = join(cwd, target)
  const newVars = envVarsToWrite(apiKey, projectId, framework)

  const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : ''
  if (existing.includes('MUSHI_PROJECT_ID')) {
    p.log.warn(`Existing MUSHI_* vars found in ${target} — leaving them untouched.`)
    return
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  appendFileSync(targetPath, `${prefix}\n# Mushi Mushi\n${newVars}\n`)

  if (!existing) {
    writeFileSync(targetPath, readFileSync(targetPath, 'utf-8'))
  }

  p.log.success(`Wrote env vars to ${target}`)
  warnIfMissingFromGitignore(cwd, target)
}

function warnIfMissingFromGitignore(cwd: string, envFile: string): void {
  const gitignorePath = join(cwd, '.gitignore')
  if (!existsSync(gitignorePath)) {
    p.log.warn(`No .gitignore found — make sure ${envFile} is not committed.`)
    return
  }
  const content = readFileSync(gitignorePath, 'utf-8')
  if (!content.split('\n').some((line) => line.trim() === envFile || line.trim() === '.env*')) {
    p.log.warn(`${envFile} is not in .gitignore — add it before committing.`)
  }
}

function persistCliConfig(apiKey: string, projectId: string): void {
  const existing = loadConfig()
  saveConfig({ ...existing, apiKey, projectId })
}

function printNextSteps(framework: Framework, apiKey: string, projectId: string): void {
  p.note(framework.snippet(apiKey, projectId), 'Add this to your app:')

  p.log.message('Verify the install:')
  p.log.message('  • Start your dev server')
  p.log.message('  • Look for the 🐛 button in the bottom-right corner (or shake on mobile)')
  p.log.message('  • Submit a test report — it should appear at https://kensaur.us/mushi-mushi/reports')
}
