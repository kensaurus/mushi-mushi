// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/cli/src/commands/selfhost.ts
 * PURPOSE: `mushi selfhost up` / `mushi selfhost doctor` / `mushi selfhost secrets`
 *
 * `mushi selfhost up` wraps the Supabase CLI steps of the self-hosting docs
 * (apps/docs/content/self-hosting) into one command, run from a clone of the
 * mushi-mushi repo:
 *   1. supabase link --project-ref <ref>   (when --project-ref is given)
 *   2. supabase db push                    (all migrations)
 *   3. supabase secrets set --env-file     (MUSHI_INTERNAL_CALLER_SECRET, MUSHI_INSTANCE_MODE,
 *                                           LLM keys, ADMIN_BASE_URL + MUSHI_ADMIN_ORIGIN_ALLOWLIST)
 *   4. supabase db query --file            (mushi_runtime_config: supabase_url,
 *                                           service_role_key, internal_caller_token;
 *                                           and the private `screenshots` bucket)
 *   5. supabase functions deploy           (every function; config.toml decides verify_jwt).
 *                                           _shared/deploy-info.ts is stamped with the
 *                                           commit first and restored after, with the
 *                                           clone's own scripts/deploy-edge-function.mjs
 *                                           (deployInfoSource), so GET /health reports
 *                                           the deployed commit instead of "dev"
 *   6. save endpoint + consoleUrl to the CLI config
 *   7. proof step: GET <endpoint>/health
 *
 * Step 4 matters: the migrations seed mushi_runtime_config.supabase_url with the
 * Mushi Mushi Cloud URL (ON CONFLICT DO NOTHING), so until it is overwritten every
 * pg_cron job on a self-hosted project calls Mushi Mushi Cloud.
 *
 * Secrets never reach argv: they go through 0600 temp files that are deleted
 * after the step. Supabase CLI 3.x asks for consent before every hosted change
 * and cannot ask when stdout is piped, so `up` asks once itself (or takes
 * --yes) and passes SUPABASE_YES=1 to the child processes.
 *
 * When the supabase CLI is absent or --print-commands is passed the command
 * prints the exact commands instead, with placeholders for every secret.
 *
 * `mushi selfhost secrets` writes a .env for deploy/docker-compose.yml with a
 * random Postgres password, JWT secret, internal caller secret, and anon /
 * service_role JWTs minted from the JWT secret.
 *
 * `mushi selfhost doctor` calls GET /v1/admin/doctor, adds what only the CLI
 * can see (the console answers at its address; /health reports a stamped,
 * self-hosted deploy) and prints OK/INFO/WARN/FAIL lines. INFO is an optional
 * thing not set up and never changes the exit code.
 */

import type { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeEndpointHealth } from '../cli-shared.js'
import { CONFIG_PATH, loadConfig, saveConfig } from '../config.js'
import { assertEndpoint } from '../endpoint.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** The installed supabase CLI version, or null when it is not on PATH. */
function supabaseCliVersion(): string | null {
  try {
    const r = spawnSync('supabase', ['--version'], { encoding: 'utf8', timeout: 5_000 })
    return r.status === 0 ? (r.stdout ?? '').trim() : null
  } catch {
    return null
  }
}

/** @internal Exported for tests only. Major version of a `supabase --version` string. */
export function supabaseCliMajor(version: string | null | undefined): number | undefined {
  const m = /(\d+)\.\d+\.\d+/.exec(version ?? '')
  return m ? Number(m[1]) : undefined
}

/**
 * @internal Exported for tests only.
 * The flag that sends `db push` / `db query` to the linked project. CLI 3.x
 * targets the LOCAL database by default and spells it `--remote`; 2.x targets
 * the linked project and only knows `--linked` (3.x still accepts it, 4.x
 * will not).
 */
export function linkedTargetFlag(cliMajor: number | undefined): string {
  return cliMajor !== undefined && cliMajor < 3 ? '--linked' : '--remote'
}

/** @internal Exported for tests only. One `supabase` CLI invocation of `selfhost up`. */
export interface SelfhostStep {
  label: string
  /** Arguments after `supabase`, passed as an argv array with no shell. */
  args: string[]
  critical?: boolean
  /** Files the step reads: written with mode 0600 before it runs, deleted after. */
  files?: Array<{ path: string; content: string }>
  /** Stamp _shared/deploy-info.ts with the commit while this step runs (the function deploy). */
  stampDeployInfo?: boolean
}

/** @internal Exported for tests only. The copy-pasteable command line `--print-commands` shows for a step. */
export function selfhostStepCommand(step: SelfhostStep): string {
  return `supabase ${step.args.join(' ')}`
}

/** Replace every occurrence of a secret with a marker before echoing CLI output. */
function redact(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) if (s) out = out.split(s).join('<redacted>')
  return out
}

/**
 * Run `supabase <args>` without a shell and return { ok, stdout, stderr }.
 * supabaseCliVersion() spawns the same way, so a CLI that only resolves through
 * a shell (a Windows .cmd shim) already sent us to --print-commands instead.
 */
function runSupabase(
  step: SelfhostStep,
  opts: { cwd?: string; secrets: string[] },
): { ok: boolean; stderr: string } {
  process.stdout.write(`  › ${step.label} … `)
  for (const f of step.files ?? []) writeFileSync(f.path, f.content, { mode: 0o600 })
  try {
    const r = spawnSync('supabase', step.args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: 900_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The operator already confirmed (prompt or --yes): CLI 3.x reads consent
      // for hosted changes from SUPABASE_YES in the process environment.
      env: { ...process.env, SUPABASE_YES: '1' },
    })
    if (r.error || r.status !== 0) {
      process.stdout.write('✗\n')
      const stderr = redact((r.stderr ?? '').trim() || (r.stdout ?? '').trim(), opts.secrets)
      return { ok: false, stderr: stderr || r.error?.message || `exited with ${r.status ?? r.signal}` }
    }
    process.stdout.write('✓\n')
    return { ok: true, stderr: '' }
  } finally {
    for (const f of step.files ?? []) rmSync(f.path, { force: true })
  }
}

const KEY_RE = /^[A-Za-z0-9_-]+$/
const SECRET_RE = /^[A-Za-z0-9_-]{32,}$/
const PLAIN_URL_RE = /^[A-Za-z0-9:/._~-]+$/

function isPlainHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return (u.protocol === 'https:' || u.protocol === 'http:') && PLAIN_URL_RE.test(value)
  } catch {
    return false
  }
}

/** @internal Exported for tests only. Which provider a pasted LLM key belongs to. */
export function llmProviderOfKey(key: string): 'anthropic' | 'openai' {
  return key.startsWith('sk-ant-') ? 'anthropic' : 'openai'
}

/**
 * @internal Exported for tests only.
 * SQL that points this project's cron jobs at itself and makes sure the
 * private `screenshots` bucket exists (the first migration creates it; the
 * insert is a no-op then). `edge_function_post` reads `supabase_url` and
 * `service_role_key`; `mushi_internal_auth_header()` (pipeline recovery) reads
 * `internal_caller_token`. Both tokens must equal MUSHI_INTERNAL_CALLER_SECRET,
 * which requireServiceRoleAuth accepts.
 */
export function buildRuntimeConfigSql(supabaseUrl: string, internalToken: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  return [
    '-- Written by `mushi selfhost up`: point pg_cron jobs at this project, not Mushi Mushi Cloud.',
    'insert into public.mushi_runtime_config (key, value) values',
    `  ('supabase_url', ${q(supabaseUrl)}),`,
    `  ('service_role_key', ${q(internalToken)}),`,
    `  ('internal_caller_token', ${q(internalToken)})`,
    'on conflict (key) do update set value = excluded.value, updated_at = now();',
    '',
    '-- Private, service-role only (same row as 20260416000000_phase0_initial_schema.sql).',
    'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)',
    "values ('screenshots', 'screenshots', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])",
    'on conflict (id) do nothing;',
    '',
    SELFHOST_PLAN_SQL,
  ].join('\n')
}

/**
 * @internal Exported for tests only.
 * Orgs on a fresh instance resolve to a Mushi Mushi Cloud plan row
 * (`free_cloud` for personal orgs, the `hobby` column default otherwise,
 * _shared/org-billing.ts): on Free, 300 diagnoses a month (then reports stop at
 * `quota_exceeded`), 3 apps, 1 seat, 30-day retention, no Pro features. On
 * your own instance there is nothing to bill, so lift them on every row,
 * whichever one an org lands on. Re-applied on every `up`, after `db push`,
 * so a later migration that reshapes a plan does not bring the limits back.
 * NULL limits mean unlimited; retention needs a number (NULL falls back to 7
 * days). `inventory_v2` and `soc2` stay as the plan has them: they start
 * crawler and evidence jobs.
 */
export const SELFHOST_PLAN_SQL = [
  '-- Self-hosted: no billing, so no Mushi Mushi Cloud plan limits on any plan.',
  'update public.pricing_plans set',
  '  included_diagnoses_per_month = null,',
  '  max_projects = null,',
  '  seat_limit = null,',
  '  retention_days = greatest(coalesce(retention_days, 0), 3650),',
  `  feature_flags = coalesce(feature_flags, '{}'::jsonb) || '{"byok": true, "sso": true, "plugins": true, "intelligence_reports": true, "audit_log": true, "self_hosted": true, "teams": true}'::jsonb`,
  'where true;',
  '',
].join('\n')

/** The Mushi Mushi Cloud project: `selfhost up` must never run against it. */
const CLOUD_PROJECT_REF = 'dxptnwrhwsqckaftyymj'

/** The self-hosting docs; CLI hints link here. */
const SELF_HOST_DOCS = 'https://kensaur.us/mushi-mushi/docs/self-hosting'

/** @internal Exported for tests only. Inputs of {@link buildSelfhostSteps}, already resolved. */
export interface SelfhostPlanInput {
  projectRef?: string
  /** https://<ref>.supabase.co, or a custom domain. Placeholder in print mode. */
  supabaseUrl: string
  anthropicKey?: string
  openaiKey?: string
  /** Where the admin console is served; becomes ADMIN_BASE_URL. */
  consoleUrl?: string
  skipDeploy?: boolean
  cliMajor?: number
}

/**
 * @internal Exported for tests only.
 * The supabase CLI steps of `selfhost up`, or why the inputs are refused.
 * Every value travels as one argv element or inside a 0600 file under
 * `tmpDir`, so no value can change the command; the checks below reject
 * values that are not what they claim to be.
 */
export function buildSelfhostSteps(
  input: SelfhostPlanInput,
  printOnly: boolean,
  internalToken: string,
  tmpDir: string,
): { ok: true; steps: SelfhostStep[] } | { ok: false; error: string } {
  const steps: SelfhostStep[] = []
  const target = linkedTargetFlag(input.cliMajor)

  if (input.projectRef && !/^[a-z0-9-]+$/i.test(input.projectRef)) {
    return { ok: false, error: `--project-ref must be alphanumeric (got: ${input.projectRef}).` }
  }
  if (input.projectRef === CLOUD_PROJECT_REF || input.supabaseUrl.includes(CLOUD_PROJECT_REF)) {
    return {
      ok: false,
      error: 'That is the Mushi Mushi Cloud project. selfhost up deploys to your own Supabase project.',
    }
  }
  if (!printOnly && !isPlainHttpUrl(input.supabaseUrl)) {
    return { ok: false, error: `--supabase-url must be a plain http(s) URL (got: ${input.supabaseUrl}).` }
  }
  for (const [flag, key] of [
    ['--anthropic-key', input.anthropicKey],
    ['--openai-key', input.openaiKey],
  ] as const) {
    if (key && !KEY_RE.test(key)) {
      return {
        ok: false,
        error: `${flag} does not look like an API key (letters, digits, - and _ only).`,
      }
    }
  }
  if (input.consoleUrl && !isPlainHttpUrl(input.consoleUrl)) {
    return { ok: false, error: `--console-url must be a plain http(s) URL (got: ${input.consoleUrl}).` }
  }
  if (!printOnly && !SECRET_RE.test(internalToken)) {
    return {
      ok: false,
      error: 'MUSHI_INTERNAL_CALLER_SECRET must be at least 32 characters of letters, digits, - and _.',
    }
  }

  if (input.projectRef) {
    steps.push({
      label: `link to Supabase project ${input.projectRef}`,
      args: ['link', '--project-ref', input.projectRef],
      critical: true,
    })
  }

  steps.push({ label: 'apply database migrations', args: ['db', 'push', target], critical: true })

  // Function secrets. Print mode never shows a real value.
  const token = printOnly ? '<YOUR_INTERNAL_CALLER_SECRET>' : internalToken
  // MUSHI_INSTANCE_MODE: the server says "self-hosted" on /health even behind a
  // custom domain (_shared/instance-mode.ts), so the console and doctor agree.
  const secretLines = [`MUSHI_INTERNAL_CALLER_SECRET=${token}`, 'MUSHI_INSTANCE_MODE=self-hosted']
  if (input.anthropicKey) secretLines.push(`ANTHROPIC_API_KEY=${printOnly ? 'sk-ant-...' : input.anthropicKey}`)
  if (input.openaiKey) secretLines.push(`OPENAI_API_KEY=${printOnly ? 'sk-...' : input.openaiKey}`)
  if (input.consoleUrl) {
    // ADMIN_BASE_URL: links and the CLI sign-in page open your console.
    // MUSHI_ADMIN_ORIGIN_ALLOWLIST: the api answers the console's browser
    // calls (CORS); the server's defaults cover only kensaur.us and localhost dev ports.
    secretLines.push(`ADMIN_BASE_URL=${input.consoleUrl}`)
    secretLines.push(`MUSHI_ADMIN_ORIGIN_ALLOWLIST=${new URL(input.consoleUrl).origin}`)
  }
  const secretsFile = join(tmpDir, 'mushi-secrets.env')
  steps.push({
    label: `set function secrets (${secretLines.map((l) => l.split('=')[0]).join(', ')})`,
    args: ['secrets', 'set', '--env-file', secretsFile],
    critical: true,
    files: [{ path: secretsFile, content: `${secretLines.join('\n')}\n` }],
  })

  const sqlFile = join(tmpDir, 'mushi-runtime-config.sql')
  steps.push({
    label: 'point cron jobs at this project (mushi_runtime_config) + screenshots bucket',
    args: ['db', 'query', target, '--file', sqlFile],
    critical: true,
    files: [{ path: sqlFile, content: buildRuntimeConfigSql(input.supabaseUrl, token) }],
  })

  if (!input.skipDeploy) {
    // No names: the CLI deploys every directory under supabase/functions
    // (`_shared` has no entrypoint and is skipped) and reads each function's
    // verify_jwt from config.toml, the same as the production deploy.
    steps.push({ label: 'deploy every edge function', args: ['functions', 'deploy'], stampDeployInfo: true })
  }

  return { ok: true, steps }
}

/**
 * @internal Exported for tests only.
 * The CLI config after `selfhost up`, or null when it must not be touched:
 * a saved key for a different endpoint (e.g. Mushi Mushi Cloud) would be sent
 * to the self-hosted API, so the operator switches deliberately instead.
 */
export function selfhostConfigPatch(
  existing: { apiKey?: string; endpoint?: string },
  endpoint: string,
  consoleUrl: string | undefined,
): { endpoint: string; consoleUrl?: string } | null {
  if (existing.apiKey && existing.endpoint !== endpoint) return null
  return consoleUrl ? { endpoint, consoleUrl } : { endpoint }
}

// ─── deploy stamp ────────────────────────────────────────────────────────────

/** The file every function bundles; GET /health reads its `sha` (relative to the repo root). */
export const DEPLOY_INFO_PATH = join('packages', 'server', 'supabase', 'functions', '_shared', 'deploy-info.ts')

/** @internal Exported for tests only. What scripts/deploy-edge-function.mjs exports for stamping. */
export interface DeployStamper {
  deployInfoSource(sha: string, deployedAt: string): string
  resolveDeploySha(cwd?: string): string
}

/**
 * @internal Exported for tests only.
 * The stamping helpers of the clone being deployed: the stamp's format lives
 * next to the file it overwrites, so it is never copied into the CLI. Null
 * for an older clone without them (the deploy then reports "dev").
 */
export async function loadDeployStamper(root: string): Promise<DeployStamper | null> {
  const script = join(root, 'scripts', 'deploy-edge-function.mjs')
  if (!existsSync(script)) return null
  try {
    const mod = (await import(pathToFileURL(script).href)) as Partial<DeployStamper>
    return typeof mod.deployInfoSource === 'function' && typeof mod.resolveDeploySha === 'function'
      ? (mod as DeployStamper)
      : null
  } catch {
    return null
  }
}

/**
 * @internal Exported for tests only.
 * Writes the stamped deploy-info.ts and returns how to put the checked-in
 * file back (idempotent). Null when the file is missing.
 */
export function stampDeployInfo(
  root: string,
  stamper: DeployStamper,
  now: Date = new Date(),
): { sha: string; restore: () => void } | null {
  const file = join(root, DEPLOY_INFO_PATH)
  let original: string
  try {
    original = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const sha = stamper.resolveDeploySha(root)
  writeFileSync(file, stamper.deployInfoSource(sha, now.toISOString()))
  let restored = false
  return {
    sha,
    restore: () => {
      if (restored) return
      restored = true
      writeFileSync(file, original)
    },
  }
}

/** Runs one step with deploy-info.ts stamped, and always restores it (also on Ctrl-C). */
function runStamped(
  step: SelfhostStep,
  root: string,
  stamper: DeployStamper | null,
  run: () => { ok: boolean; stderr: string },
): { ok: boolean; stderr: string } {
  const stamp = step.stampDeployInfo && stamper ? stampDeployInfo(root, stamper) : null
  if (!stamp) return run()
  const onSignal = () => {
    stamp.restore()
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('exit', stamp.restore)
  try {
    return run()
  } finally {
    stamp.restore()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('exit', stamp.restore)
  }
}

// ─── selfhost up ─────────────────────────────────────────────────────────────

interface UpOptions {
  projectRef?: string
  supabaseUrl?: string
  anthropicKey?: string
  openaiKey?: string
  consoleUrl?: string
  adminBaseUrl?: string
  printCommands?: boolean
  skipDeploy?: boolean
  endpoint?: string
  cwd?: string
  yes?: boolean
}

function readLinkedRef(supabaseDir: string): string | undefined {
  try {
    const ref = readFileSync(join(supabaseDir, '.temp', 'project-ref'), 'utf8').trim()
    return /^[a-z0-9-]+$/i.test(ref) ? ref : undefined
  } catch {
    return undefined
  }
}

function isInteractive(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY)
}

/** Flag, then environment, then (interactive only) one prompt that accepts either provider. */
async function resolveLlmKeys(
  opts: UpOptions,
  printOnly: boolean,
): Promise<{ anthropicKey?: string; openaiKey?: string }> {
  const fromEnv = (name: string) => {
    const v = process.env[name]?.trim()
    if (v && !printOnly) console.log(`  Using ${name} from your shell.`)
    return v || undefined
  }
  const anthropicKey = opts.anthropicKey || fromEnv('ANTHROPIC_API_KEY')
  const openaiKey = opts.openaiKey || fromEnv('OPENAI_API_KEY')
  if (anthropicKey || openaiKey || printOnly || !isInteractive()) return { anthropicKey, openaiKey }

  const p = await import('@clack/prompts')
  const pasted = await p.password({
    message: 'Paste an Anthropic (sk-ant-…) or OpenAI (sk-…) API key, or press Enter to skip',
  })
  if (p.isCancel(pasted)) process.exit(1)
  const key = (pasted ?? '').trim()
  if (!key) return {}
  return llmProviderOfKey(key) === 'anthropic' ? { anthropicKey: key } : { openaiKey: key }
}

function printNoLlmNote(): void {
  console.log('  No LLM key set. Reports are still ingested, stored and shown in the console,')
  console.log('  and get a rule-based category and severity. Without a key there is no')
  console.log('  plain-English diagnosis, no fix drafts and no duplicate detection.')
  console.log('  Add one later: supabase secrets set ANTHROPIC_API_KEY=… (or OPENAI_API_KEY=…),')
  console.log('  or per app in the console under Settings → AI keys.')
}

async function runSelfhostUp(opts: UpOptions): Promise<void> {
  const root = resolve(opts.cwd ?? '.')
  const serverDir = join(root, 'packages', 'server')
  const supabaseDir = join(serverDir, 'supabase')
  const cliVersion = supabaseCliVersion()
  const printOnly = !!(opts.printCommands || !cliVersion)
  const consoleUrl = opts.consoleUrl || opts.adminBaseUrl

  if (!printOnly && !existsSync(join(supabaseDir, 'config.toml'))) {
    process.stderr.write(
      `✗ ${supabaseDir} has no config.toml. Run this from a clone of the mushi-mushi repo, or pass --cwd <repo root>.\n`,
    )
    process.exit(1)
  }

  const linkedRef = readLinkedRef(supabaseDir)
  const ref = opts.projectRef || linkedRef
  if (!printOnly && ref === CLOUD_PROJECT_REF) {
    // db push / db query go to the LINKED project whatever --supabase-url says.
    process.stderr.write(
      '✗ This checkout is linked to the Mushi Mushi Cloud project. Pass --project-ref <your ref> to link your own.\n',
    )
    process.exit(1)
  }
  // Print mode starts from scratch: show the link step even without a ref.
  const projectRef = opts.projectRef ?? (printOnly && !linkedRef ? 'your-project-ref' : undefined)
  const supabaseUrl =
    opts.supabaseUrl?.replace(/\/+$/, '') || (ref ? `https://${ref}.supabase.co` : undefined)
  if (!supabaseUrl && !printOnly) {
    process.stderr.write(
      '✗ Unknown Supabase project. Pass --project-ref <ref> (or --supabase-url <url> for a custom domain).\n',
    )
    process.exit(1)
  }
  const resolvedUrl = supabaseUrl ?? 'https://<your-ref>.supabase.co'
  let endpoint = (opts.endpoint || `${resolvedUrl}/functions/v1/api`).replace(/\/+$/, '')
  if (!printOnly) {
    try {
      endpoint = assertEndpoint(endpoint)
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  }

  console.log('')
  if (printOnly) {
    console.log(cliVersion ? '--print-commands: nothing is run.' : 'supabase CLI not found.')
    console.log(`Run these from ${serverDir} (Supabase CLI 3.x; for 2.x use --linked instead of --remote):\n`)
  } else {
    console.log(`mushi selfhost up — deploying Mushi Mushi to ${resolvedUrl}\n`)
  }

  const llm = await resolveLlmKeys(opts, printOnly)
  const envToken = process.env['MUSHI_INTERNAL_CALLER_SECRET']?.trim()
  const internalToken = envToken || randomBytes(32).toString('hex')

  const tmpDir = printOnly ? '.' : mkdtempSync(join(tmpdir(), 'mushi-selfhost-'))
  try {
    const built = buildSelfhostSteps(
      {
        projectRef,
        supabaseUrl: resolvedUrl,
        ...llm,
        consoleUrl,
        skipDeploy: opts.skipDeploy,
        cliMajor: supabaseCliMajor(cliVersion),
      },
      printOnly,
      internalToken,
      printOnly ? '.' : tmpDir,
    )
    if (!built.ok) {
      process.stderr.write(`✗ ${built.error}\n`)
      process.exit(1)
    }

    if (printOnly) {
      console.log('# generate one secret and use it in BOTH files below')
      console.log('  $ openssl rand -hex 32')
      console.log('')
      for (const step of built.steps) {
        console.log(`# ${step.label}`)
        for (const f of step.files ?? []) {
          console.log(`  $ cat > ${f.path} <<'EOF'`)
          for (const line of f.content.trimEnd().split('\n')) console.log(`  ${line}`)
          console.log('  EOF')
        }
        const cleanup = (step.files ?? []).map((f) => f.path).join(' ')
        console.log(`  $ ${selfhostStepCommand(step)}${cleanup ? ` && rm ${cleanup}` : ''}`)
        console.log('')
      }
      if (!llm.anthropicKey && !llm.openaiKey) {
        console.log('# LLM key (optional): add ANTHROPIC_API_KEY=… or OPENAI_API_KEY=… to mushi-secrets.env')
        console.log('')
      }
      if (!opts.skipDeploy) {
        console.log('# A plain `supabase functions deploy` leaves _shared/deploy-info.ts unstamped, so')
        console.log('# /health reports version "dev". `mushi selfhost up` stamps the commit for you.')
        console.log('')
      }
      console.log('─────────────────────────────────────────────────')
      console.log('Then point the CLI at it and check it:')
      console.log(`  mushi config endpoint ${endpoint}`)
      if (consoleUrl) console.log(`  mushi config consoleUrl ${consoleUrl}`)
      console.log(`  curl ${endpoint}/health`)
      console.log(`  mushi login --endpoint ${endpoint}`)
      console.log('  mushi selfhost doctor')
      return
    }

    // Supabase CLI 3.x refuses hosted changes it cannot confirm; ask once here.
    if (!opts.yes) {
      if (!isInteractive()) {
        process.stderr.write(
          '✗ selfhost up changes your Supabase project (migrations, secrets, functions). Pass --yes to confirm in a non-interactive shell.\n',
        )
        process.exit(1)
      }
      const p = await import('@clack/prompts')
      const ok = await p.confirm({
        message: `Push migrations, set secrets${opts.skipDeploy ? '' : ' and deploy every edge function'} on ${resolvedUrl}?`,
      })
      if (p.isCancel(ok) || !ok) process.exit(1)
    }
    if (envToken) console.log('  Using MUSHI_INTERNAL_CALLER_SECRET from your shell.')
    if (!llm.anthropicKey && !llm.openaiKey) printNoLlmNote()
    console.log('')

    const secrets = [internalToken, llm.anthropicKey ?? '', llm.openaiKey ?? '']
    const stamper = built.steps.some((s) => s.stampDeployInfo) ? await loadDeployStamper(root) : null
    if (!stamper && !opts.skipDeploy) {
      console.log('  This clone cannot stamp the deploy (no scripts/deploy-edge-function.mjs helpers): /health will report "dev".')
    }
    let failed = false
    for (const step of built.steps) {
      const result = runStamped(step, root, stamper, () => runSupabase(step, { cwd: serverDir, secrets }))
      if (result.ok) continue
      process.stderr.write(`    ${result.stderr.split('\n').slice(0, 3).join('\n    ')}\n`)
      if (step.critical) {
        process.stderr.write('\n✗ Critical step failed: resolve the error above and re-run `mushi selfhost up`.\n')
        process.exit(1)
      }
      failed = true
    }

    // Point the CLI at this deployment so `mushi login` signs in here, not on Mushi Mushi Cloud.
    const config = loadConfig()
    const patch = selfhostConfigPatch(config, endpoint, consoleUrl)
    if (patch) {
      saveConfig({ ...config, ...patch })
      console.log(`  › saved endpoint${patch.consoleUrl ? ' + consoleUrl' : ''} to ${CONFIG_PATH} ✓`)
    } else {
      console.log(`  › ${CONFIG_PATH} holds a key for ${config.endpoint}; left unchanged. Switch with:`)
      console.log(`      mushi config endpoint ${endpoint}`)
      if (consoleUrl) console.log(`      mushi config consoleUrl ${consoleUrl}`)
    }

    console.log('')
    console.log('Proof step…')
    const probe = await probeEndpointHealth(endpoint).catch(() => null)
    if (!probe?.ok) {
      console.log(`  WARN  ${endpoint}/health did not return 200: check the function logs.`)
    } else {
      console.log(`  OK    /health ${probe.status} ${probe.latencyMs}ms`)
    }
    const health = await serverHealthCheck(endpoint, fetch)
    for (const line of formatSelfhostCheck(health)) console.log(`  ${line}`)

    console.log('')
    if (failed) {
      console.log('Some steps failed (see above). Fix them and re-run, or deploy the rest by hand.')
      process.exit(2)
    }
    console.log('✓  selfhost up complete.')
    console.log('')
    console.log('Next steps:')
    if (!consoleUrl) {
      console.log(`  0. Serve the admin console (${SELF_HOST_DOCS}/admin-spa), then:`)
      console.log('       mushi config consoleUrl <console url>')
      console.log('     Without it, `mushi login` opens the Mushi Mushi Cloud console.')
    }
    console.log('  1. Sign up in your console (the first account owns the instance).')
    console.log(`  2. mushi login --endpoint ${endpoint}`)
    console.log('  3. mushi selfhost doctor')
    console.log('  4. mushi init   (in your app repo)')
  } finally {
    if (!printOnly) rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ─── selfhost secrets ────────────────────────────────────────────────────────

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

/**
 * @internal Exported for tests only.
 * An HS256 Supabase API key (`anon` or `service_role`), the same shape as
 * Supabase's own self-host generate-keys script.
 */
export function mintSupabaseJwt(role: 'anon' | 'service_role', jwtSecret: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ role, iss: 'supabase', iat: nowSec, exp: nowSec + 5 * 365 * 24 * 3600 }),
  )
  const sig = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

/** @internal Exported for tests only. The .env body for deploy/docker-compose.yml. */
export function buildComposeEnv(
  rand: (bytes: number) => string,
  nowSec: number,
  publicUrl = 'http://localhost',
): string {
  const jwtSecret = rand(32)
  return [
    '# Generated by `mushi selfhost secrets`. Keep this file private; never commit it.',
    `# Public address of the stack (Caddy serves the console and the API here).`,
    `MUSHI_PUBLIC_URL=${publicUrl}`,
    `MUSHI_SITE_ADDRESS=${publicUrl}`,
    '',
    '# Required: generated, do not edit by hand (the JWTs below are signed with JWT_SECRET).',
    `POSTGRES_PASSWORD=${rand(24)}`,
    `JWT_SECRET=${jwtSecret}`,
    `SUPABASE_ANON_KEY=${mintSupabaseJwt('anon', jwtSecret, nowSec)}`,
    `SUPABASE_SERVICE_ROLE_KEY=${mintSupabaseJwt('service_role', jwtSecret, nowSec)}`,
    `MUSHI_INTERNAL_CALLER_SECRET=${rand(32)}`,
    '',
    '# Optional: one LLM key turns on the plain-English diagnosis and fix drafts.',
    '# Either provider works. Leave both empty for rule-based triage only.',
    'ANTHROPIC_API_KEY=',
    'OPENAI_API_KEY=',
    '',
  ].join('\n')
}

function runSelfhostSecrets(opts: { out: string; force?: boolean; publicUrl?: string }): void {
  const out = resolve(opts.out)
  if (opts.publicUrl && !isPlainHttpUrl(opts.publicUrl)) {
    process.stderr.write(`✗ --public-url must be a plain http(s) URL (got: ${opts.publicUrl}).\n`)
    process.exit(1)
  }
  if (!existsSync(dirname(out))) {
    process.stderr.write(`✗ ${dirname(out)} does not exist.\n`)
    process.exit(1)
  }
  const body = buildComposeEnv(
    (n) => randomBytes(n).toString('hex'),
    Math.floor(Date.now() / 1000),
    opts.publicUrl?.replace(/\/+$/, ''),
  )
  // Exclusive create unless --force: no window between a check and the write (CodeQL
  // js/file-system-race), and an existing file is never overwritten by accident.
  try {
    writeFileSync(out, body, { mode: 0o600, flag: opts.force ? 'w' : 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      process.stderr.write(`✗ ${out} already exists. Pass --force to replace it (this rotates every secret).\n`)
      process.exit(1)
    }
    throw err
  }
  console.log(`✓ Wrote ${out} (mode 600).`)
  console.log('  Generated: POSTGRES_PASSWORD, JWT_SECRET, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,')
  console.log('             MUSHI_INTERNAL_CALLER_SECRET')
  console.log('  Optional:  ANTHROPIC_API_KEY or OPENAI_API_KEY (edit the file)')
}

// ─── selfhost doctor ─────────────────────────────────────────────────────────


interface DoctorOptions {
  endpoint?: string
  consoleUrl?: string
  json?: boolean
}

/** @internal Exported for tests only. One line of `mushi selfhost doctor`. */
export interface SelfhostCheck {
  name: string
  status: 'pass' | 'info' | 'warn' | 'fail'
  label?: string
  summary: string
  hint?: string
  appName?: string | null
}

/** @internal Exported for tests only. 1 any failure, 2 warnings only, 0 otherwise (info never counts). */
export function selfhostDoctorExitCode(checks: ReadonlyArray<Pick<SelfhostCheck, 'status'>>): 0 | 1 | 2 {
  if (checks.some((c) => c.status === 'fail')) return 1
  if (checks.some((c) => c.status === 'warn')) return 2
  return 0
}

/** @internal Exported for tests only. True for Mushi Mushi Cloud's own API. */
export function isCloudEndpoint(endpoint: string): boolean {
  return endpoint.includes(CLOUD_PROJECT_REF) || /^https:\/\/kensaur\.us\//.test(endpoint)
}

const HOSTED_CONSOLE = 'https://kensaur.us/mushi-mushi/admin'

/**
 * @internal Exported for tests only.
 * Does the console answer where the CLI will send `mushi login`? No saved
 * address, or Mushi Mushi Cloud's console for a self-hosted API, means the
 * sign-in happens on the wrong instance.
 */
export async function consoleCheck(
  consoleUrl: string | undefined,
  endpoint: string,
  doFetch: typeof fetch,
): Promise<SelfhostCheck | null> {
  if (isCloudEndpoint(endpoint)) return null
  const base = { name: 'console_reachable', label: 'Console answers' }
  const url = consoleUrl?.trim().replace(/\/+$/, '')
  if (!url) {
    return {
      ...base,
      status: 'info',
      summary: 'No console address saved, so `mushi login` opens Mushi Mushi Cloud.',
      hint: 'mushi config consoleUrl <your console url>',
    }
  }
  if (url.startsWith(HOSTED_CONSOLE)) {
    return {
      ...base,
      status: 'warn',
      summary: 'The saved console is Mushi Mushi Cloud\u2019s, but the API is yours: `mushi login` would sign you in on Cloud.',
      hint: 'mushi config consoleUrl <your console url>',
    }
  }
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' })
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.includes('text/html')) return { ...base, status: 'pass', summary: `${url} answers (HTTP ${res.status}).` }
    return {
      ...base,
      status: 'warn',
      summary: `${url} returned HTTP ${res.status}${type ? ` (${type.split(';')[0]})` : ''}, not the console page.`,
      hint: `Serve apps/admin/dist there with an index.html fallback (${SELF_HOST_DOCS}/admin-spa).`,
    }
  } catch (err) {
    return {
      ...base,
      status: 'warn',
      summary: `${url} did not answer: ${err instanceof Error ? err.message : String(err)}.`,
      hint: `Check the console is served at that address (${SELF_HOST_DOCS}/admin-spa).`,
    }
  }
}

/**
 * @internal Exported for tests only.
 * GET /health: the deploy is stamped with a commit and says it is self-hosted.
 */
export async function serverHealthCheck(endpoint: string, doFetch: typeof fetch): Promise<SelfhostCheck> {
  const base = { name: 'server_deploy', label: 'Server deploy' }
  try {
    const res = await doFetch(`${endpoint.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) {
      return { ...base, status: 'fail', summary: `/health returned HTTP ${res.status}.`, hint: 'Check the `api` function deployed and its logs.' }
    }
    const body = (await res.json().catch(() => ({}))) as { version?: unknown; mode?: unknown }
    const version = typeof body.version === 'string' ? body.version : null
    if (body.mode === 'hosted' && !isCloudEndpoint(endpoint)) {
      return {
        ...base,
        status: 'warn',
        summary: 'The server says it is Mushi Mushi Cloud, so the console labels this instance wrongly.',
        hint: 'supabase secrets set MUSHI_INSTANCE_MODE=self-hosted (selfhost up sets it).',
      }
    }
    if (!version || version === 'dev' || version === 'unknown') {
      return {
        ...base,
        status: 'info',
        summary: 'The deploy is not stamped with a commit (/health says "dev"), so you cannot tell which code runs.',
        hint: 'Supabase: re-run `npx mushi-mushi selfhost up`; it stamps the commit. Compose builds are unstamped; compare the image with `git log -1`.',
      }
    }
    return { ...base, status: 'pass', summary: `Running commit ${version.slice(0, 7)}.` }
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      summary: `/health did not answer: ${err instanceof Error ? err.message : String(err)}.`,
      hint: `Check that ${endpoint} is deployed and reachable.`,
    }
  }
}

const TAG: Record<SelfhostCheck['status'], string> = { pass: 'OK  ', info: 'INFO', warn: 'WARN', fail: 'FAIL' }

/** @internal Exported for tests only. A check as printed lines: label first, the raw id never leads. */
export function formatSelfhostCheck(check: SelfhostCheck): string[] {
  const title = `${check.label ?? check.name}${check.appName ? ` (${check.appName})` : ''}`
  const lines = [`${TAG[check.status]}  ${title}: ${check.summary}`]
  if (check.hint && check.status !== 'pass') lines.push(`      \u2192 ${check.hint}`)
  return lines
}

async function runSelfhostDoctor(opts: DoctorOptions): Promise<void> {
  const config = loadConfig()
  const endpoint = (opts.endpoint || config.endpoint)?.replace(/\/+$/, '')
  if (!endpoint) {
    process.stderr.write('error: endpoint required — pass --endpoint or run `mushi login` first.\n')
    process.exit(1)
  }

  let serverChecks: SelfhostCheck[] = []
  try {
    const res = await fetch(`${endpoint}/v1/admin/doctor`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { data?: { checks?: SelfhostCheck[] } }
      serverChecks = body.data?.checks ?? []
    } else {
      serverChecks = [
        {
          name: 'server_doctor',
          label: 'Server doctor',
          status: 'fail',
          summary: `/v1/admin/doctor returned HTTP ${res.status}`,
          hint:
            res.status === 401 || res.status === 403
              ? `Sign the CLI in to this server: mushi login --endpoint ${endpoint} (the key needs mcp:read).`
              : 'Check the `api` function logs.',
        },
      ]
    }
  } catch (err) {
    serverChecks = [
      {
        name: 'server_doctor',
        label: 'Server doctor',
        status: 'fail',
        summary: `unreachable: ${err instanceof Error ? err.message : String(err)}`,
        hint: `Check that ${endpoint} is deployed and reachable.`,
      },
    ]
  }

  const [health, consoleLine] = await Promise.all([
    serverHealthCheck(endpoint, fetch),
    consoleCheck(opts.consoleUrl || config.consoleUrl, endpoint, fetch),
  ])
  const checks = [health, ...(consoleLine ? [consoleLine] : []), ...serverChecks]
  const code = selfhostDoctorExitCode(checks)

  if (opts.json) {
    console.log(JSON.stringify({ status: code === 1 ? 'fail' : code === 2 ? 'warn' : 'pass', checks }, null, 2))
  } else {
    // Problems first; OK lines last.
    const rank = { fail: 0, warn: 1, info: 2, pass: 3 } as const
    for (const check of [...checks].sort((a, b) => rank[a.status] - rank[b.status])) {
      for (const line of formatSelfhostCheck(check)) console.log(line)
    }
  }
  if (code !== 0) process.exit(code)
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerSelfhostCommands(program: Command): void {
  const selfhost = program.command('selfhost').description('Self-hosted deployment tools')

  // ── selfhost up ──────────────────────────────────────────────────────────
  selfhost
    .command('up')
    .description('Deploy Mushi Mushi to your own Supabase project (run from a clone of the repo)')
    .option('--project-ref <ref>', 'Supabase project ref (runs `supabase link` first)')
    .option('--supabase-url <url>', 'Project URL when it is not https://<ref>.supabase.co (custom domain)')
    .option('--anthropic-key <key>', 'Anthropic API key (default: $ANTHROPIC_API_KEY, else asked)')
    .option('--openai-key <key>', 'OpenAI API key (default: $OPENAI_API_KEY); either provider works')
    .option('--console-url <url>', 'Where your admin console is served (sets ADMIN_BASE_URL and the CLI consoleUrl)')
    .option('--admin-base-url <url>', 'Deprecated alias of --console-url')
    .option('--endpoint <url>', 'API endpoint (default: <supabase url>/functions/v1/api)')
    .option('--skip-deploy', 'Skip function deploys (migrations, secrets and runtime config only)')
    .option('--print-commands', 'Print the supabase CLI commands instead of running them')
    .option('--yes', 'Confirm the changes to the Supabase project without a prompt (CI)')
    .option('--cwd <path>', 'Root of the mushi-mushi repo checkout (default: current directory)')
    .addHelpText(
      'after',
      `
Examples:
  mushi selfhost up --project-ref abcdefghijklmnopqrst
  mushi selfhost up --project-ref abcdefghijklmnopqrst --console-url https://mushi.example.com
  mushi selfhost up --print-commands      # copy-paste mode
  mushi selfhost up --skip-deploy --yes   # re-run migrations, secrets and runtime config

Requires the Supabase CLI (https://supabase.com/docs/guides/cli), logged in
(\`supabase login\` or SUPABASE_ACCESS_TOKEN). Set SUPABASE_DB_PASSWORD if your
CLI asks for the database password. MUSHI_INTERNAL_CALLER_SECRET in the shell
is reused instead of generating a new one.`,
    )
    .action(async (opts: UpOptions) => {
      await runSelfhostUp(opts)
    })

  // ── selfhost secrets ─────────────────────────────────────────────────────
  selfhost
    .command('secrets')
    .description('Write a .env with fresh secrets for deploy/docker-compose.yml')
    .option('--out <path>', 'File to write', 'deploy/.env')
    .option('--public-url <url>', 'Public address of the stack (default: http://localhost)')
    .option('--force', 'Replace an existing file (rotates every secret)')
    .addHelpText(
      'after',
      `
Generates POSTGRES_PASSWORD, JWT_SECRET, MUSHI_INTERNAL_CALLER_SECRET, and the
anon / service_role JWTs signed with JWT_SECRET. Values are never printed.

Examples:
  npx mushi-mushi selfhost secrets
  npx mushi-mushi selfhost secrets --public-url https://mushi.example.com`,
    )
    .action((opts: { out: string; force?: boolean; publicUrl?: string }) => {
      runSelfhostSecrets(opts)
    })

  // ── selfhost doctor ──────────────────────────────────────────────────────
  selfhost
    .command('doctor')
    .description(
      'Check the health of a self-hosted deployment (calls GET /v1/admin/doctor)',
    )
    .option(
      '--endpoint <url>',
      `Mushi API endpoint (default: from ${CONFIG_PATH})`,
    )
    .option('--console-url <url>', 'Console address to check (default: consoleUrl from the CLI config)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText(
      'after',
      `
Exit codes: 0 healthy (INFO lines are optional extras) · 2 warnings only · 1 any hard failure

Examples:
  mushi selfhost doctor
  mushi selfhost doctor --endpoint https://<ref>.supabase.co/functions/v1/api
  mushi selfhost doctor --json | jq '.checks[] | select(.status != "pass")'`,
    )
    .action(async (opts: DoctorOptions) => {
      await runSelfhostDoctor(opts)
    })
}
