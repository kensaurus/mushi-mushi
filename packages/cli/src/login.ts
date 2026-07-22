/**
 * Shared browser / API-key login flow for `mushi login` and first-run `mushi setup`.
 */
import { ensureClientId, loadConfig, saveConfig, resolveProfileName } from './config.js'
import { trySaveKeyToKeychain } from './keychain.js'
import {
  apiKeyHint,
  cliSetupDeepLink,
  openInBrowser,
  resolveConsoleUrl,
} from './console-url.js'
import { apiCall } from './cli-shared.js'
import {
  createProject,
  listProjects,
  mintProjectKey,
  pollDeviceToken,
  startDeviceAuth,
} from './device-auth.js'
import { printAuthApproved, printAuthBanner, printAuthFailed } from './auth-ui.js'

export type RunLoginOptions = {
  apiKey?: string
  endpoint?: string
  projectId?: string
  browser?: boolean
  upgradeScope?: boolean
  /** Skip default next-step hints — use when login is a step inside another command (e.g. setup). */
  suppressPostLoginBanner?: boolean
}

export function getPostLoginBannerMessage(opts: RunLoginOptions): string | null {
  if (opts.suppressPostLoginBanner) return null
  if (opts.upgradeScope) {
    return "  Key upgraded! Re-run 'mushi setup' to update your .cursor/mcp.json, then restart Cursor."
  }
  return "  Run 'mushi init' to set up the SDK in this project."
}

function printPostLoginBanner(opts: RunLoginOptions): void {
  const message = getPostLoginBannerMessage(opts)
  if (message) console.log(message)
}

export type PollUntilApprovedResult =
  | { status: 'approved'; cliToken: string }
  | { status: 'denied' }
  | { status: 'timeout' }
  | { status: 'error'; message?: string }

export interface PollUntilApprovedDeps {
  poll: typeof pollDeviceToken
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Give up after this many back-to-back retryable poll errors. */
const MAX_CONSECUTIVE_ERRORS = 5

/**
 * RFC 8628 device-token poll loop, extracted from runLogin so it can be
 * tested without a TTY or process.exit. Honors the server's `slow_down`
 * back-off (previously ignored) and treats up to MAX_CONSECUTIVE_ERRORS
 * transient failures as retryable.
 */
export async function pollUntilApproved(
  endpoint: string,
  deviceData: { device_code: string; interval?: number; expires_in?: number },
  deps: PollUntilApprovedDeps,
): Promise<PollUntilApprovedResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  let pollIntervalMs = (deviceData.interval ?? 5) * 1000
  const deadline = now() + (deviceData.expires_in ?? 600) * 1000
  let consecutiveErrors = 0
  let firstPoll = true

  while (now() < deadline) {
    if (!firstPoll) {
      await sleep(pollIntervalMs)
    }
    firstPoll = false
    const outcome = await deps.poll(endpoint, deviceData.device_code)
    switch (outcome.status) {
      case 'approved':
        return { status: 'approved', cliToken: outcome.cliToken }
      case 'pending':
        consecutiveErrors = 0
        continue
      case 'slow_down':
        consecutiveErrors = 0
        pollIntervalMs = Math.max(pollIntervalMs, outcome.retryAfterMs)
        continue
      case 'error':
        if (outcome.retryable) {
          consecutiveErrors += 1
          if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) continue
        }
        return { status: 'error', message: outcome.message }
      case 'denied':
        return { status: 'denied' }
      case 'expired':
        return { status: 'timeout' }
    }
  }

  return { status: 'timeout' }
}

export type ProjectChoice =
  | { kind: 'picked'; id: string; name: string }
  | { kind: 'create'; name: string }
  | { kind: 'empty_name' }

/**
 * Project-picker prompt flow, extracted from runLogin so choice handling
 * (numeric pick, out-of-range → create-new, empty name) is unit-testable.
 * Out-of-range or non-numeric input intentionally falls through to the
 * create-a-new-project prompt, matching the original inline behavior.
 */
export async function resolveProjectChoice(
  projectsList: Array<{ id: string; name: string }>,
  ask: (q: string) => Promise<string>,
): Promise<ProjectChoice> {
  if (projectsList.length > 0) {
    console.log('')
    console.log('  Your projects:')
    projectsList.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.name} (${p.id})`)
    })
    console.log(`    ${projectsList.length + 1}. Create a new project`)
    console.log('')

    const choice = await ask(`  Pick a project [1-${projectsList.length + 1}]: `)
    const num = parseInt(choice, 10)

    if (num >= 1 && num <= projectsList.length) {
      const picked = projectsList[num - 1]
      return { kind: 'picked', id: picked.id, name: picked.name }
    }
  }

  console.log('')
  const newName = (await ask('  Project name: ')).trim()
  if (!newName) return { kind: 'empty_name' }
  return { kind: 'create', name: newName }
}

export async function runLogin(opts: RunLoginOptions = {}): Promise<void> {
  const { CLOUD_API_ENDPOINT, resolveCloudEndpoint } = await import('./endpoint.js')
  const endpoint = opts.endpoint ? resolveCloudEndpoint(opts.endpoint) : CLOUD_API_ENDPOINT
  const consoleBase = await resolveConsoleUrl()

  let apiKey = opts.apiKey
  let projectId = opts.projectId

  // ── Non-interactive / CI path ──────────────────────────────────────────
  if (apiKey) {
    const config = loadConfig()
    config.apiKey = apiKey
    config.endpoint = endpoint
    if (projectId) config.projectId = projectId
    config.consoleUrl = consoleBase
    saveConfig(config)

    console.log('')
    console.log('  ✓ Credentials saved.')

    const verifyResult = await apiCall<{
      project_name: string
      project_id: string
      stats: Record<string, unknown>
    }>('/v1/sync/whoami', { apiKey, endpoint, projectId })

    if (!verifyResult.ok) {
      console.warn(`  ⚠  Key saved, but verification failed: ${verifyResult.error?.message ?? 'unknown error'}`)
      console.warn(`     Check your key at: ${cliSetupDeepLink(consoleBase)}`)
      return
    }
    const d = verifyResult.data
    if (d.project_name) {
      if (!projectId && d.project_id) {
        config.projectId = d.project_id
        saveConfig(config)
      }
      console.log(`  ✓ Project: ${d.project_name} (${d.project_id})`)
    }
    console.log(`  ✓ Endpoint: ${endpoint}`)
    console.log('')
    if (!opts.suppressPostLoginBanner) {
      console.log("  Run 'mushi whoami' to verify · 'mushi init' to set up the SDK")
    }
    return
  }

  // ── Browser device-auth path (RFC 8628) ────────────────────────────────
  if (!opts.suppressPostLoginBanner) {
    console.log('')
  }
  if (opts.upgradeScope) {
    console.log('  Mushi login — scope upgrade')
    console.log('  ───────────────────────────')
    console.log('  Re-authenticating to mint a new key with report:write + mcp:read + mcp:write scopes.')
    console.log('  This lets the CLI admin commands (including writes) and MCP server both work with a single key.')
    console.log('')
  } else if (!opts.suppressPostLoginBanner) {
    console.log('  Mushi login')
    console.log('  ───────────')
  }

  let deviceData: Awaited<ReturnType<typeof startDeviceAuth>>
  try {
    deviceData = await startDeviceAuth(endpoint, ensureClientId())
  } catch (err) {
    process.stderr.write(`\nerror: Could not start login session: ${err instanceof Error ? err.message : String(err)}\n`)
    process.stderr.write(`  Fallback: mushi login --api-key <key> --project-id <uuid>\n`)
    process.exit(1)
  }

  const verifyUrl = deviceData.verification_uri
  if (opts.browser !== false) {
    try {
      await openInBrowser(verifyUrl)
    } catch {
      /* best-effort — URL is shown in banner */
    }
  }
  printAuthBanner(deviceData.user_code, verifyUrl)

  const pollResult = await pollUntilApproved(endpoint, deviceData, {
    poll: pollDeviceToken,
  })

  if (pollResult.status !== 'approved') {
    if (pollResult.status === 'denied') printAuthFailed('denied')
    else if (pollResult.status === 'error') printAuthFailed('error', pollResult.message)
    else printAuthFailed('timeout')
    process.exit(1)
  }
  const cliToken = pollResult.cliToken

  printAuthApproved()

  const projectsList = await listProjects(endpoint, cliToken)

  let chosenProjectId = projectId
  let chosenProjectName: string | undefined

  // Least-privilege default: the everyday key covers SDK ingest + MCP read
  // tools. mcp:write (billing cap, pipeline start, fix merge — the
  // money-moving admin surface) is an explicit opt-in via --upgrade-scope,
  // so a leaked mcp.json or .env can't merge fixes or change billing.
  // Applies to BOTH the create-project auto-mint and the select-project
  // mint below, so the post-login scope output is always accurate.
  const mintScopes: readonly string[] = opts.upgradeScope
    ? ['report:write', 'mcp:read', 'mcp:write']
    : ['report:write', 'mcp:read']

  if (!chosenProjectId) {
    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))

    const choice = await resolveProjectChoice(projectsList, ask)
    rl.close()

    if (choice.kind === 'empty_name') {
      process.stderr.write('\nerror: Project name is required.\n')
      process.exit(2)
    }

    if (choice.kind === 'picked') {
      chosenProjectId = choice.id
      chosenProjectName = choice.name
    } else {
      try {
        const created = await createProject(endpoint, cliToken, choice.name, { scopes: mintScopes })
        chosenProjectId = created.id
        chosenProjectName = created.name
        apiKey = created.apiKey ?? undefined
        console.log(`  ✓ Created project "${chosenProjectName}"`)
      } catch (err) {
        process.stderr.write(`\nerror: Could not create project: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }
    }
  }

  if (!apiKey && chosenProjectId) {
    try {
      apiKey = (await mintProjectKey(endpoint, cliToken, chosenProjectId, { scopes: mintScopes })) ?? undefined
    } catch {
      /* non-fatal — user can copy from console */
    }
  }

  const config = loadConfig()
  config.endpoint = endpoint
  config.consoleUrl = consoleBase
  if (chosenProjectId) config.projectId = chosenProjectId
  if (apiKey) config.apiKey = apiKey
  saveConfig(config)

  // Write the key to the OS keychain (belt-and-suspenders: file stays as backup).
  // Only at login time — saveConfig() itself does NOT write to the keychain
  // so generic config writes (endpoint, projectId, etc.) don't pollute the store.
  if (apiKey) {
    const profile = resolveProfileName(undefined, (config as Record<string, unknown>).activeProfile as string | undefined)
    trySaveKeyToKeychain(apiKey, profile)
  }

  console.log('')
  if (chosenProjectName) console.log(`  ✓ Project: ${chosenProjectName}`)
  if (apiKey) {
    if (opts.upgradeScope) {
      console.log(`  ✓ Full-scope CLI key saved (${apiKey.slice(0, 12)}…)`)
      console.log(`    Scopes: report:write · mcp:read · mcp:write — SDK + MCP + admin CLI (incl. writes) all work with this key`)
    } else {
      console.log(`  ✓ CLI key saved (${apiKey.slice(0, 12)}…)`)
      console.log(`    Scopes: report:write · mcp:read — SDK ingest + MCP read tools.`)
      console.log(`    Admin writes (billing cap, fix merge, pipeline start) need: mushi login --upgrade-scope`)
    }
  } else {
    console.log(`  ℹ  Get an SDK key at: ${apiKeyHint(consoleBase)}`)
  }
  console.log('')
  printPostLoginBanner(opts)
}
