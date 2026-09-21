/**
 * FILE: packages/cli/src/init.ts
 * PURPOSE: `mushi init` wizard — detects framework, asks for credentials,
 *          installs the right SDK, writes env vars, prints next-step snippet.
 *
 * Modeled on the Sentry / PostHog wizard pattern: one shell command, minimal
 * prompts, transparent about every file it touches.
 */

import * as p from '@clack/prompts';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
} from './detect.js';
import {
  ensureClientId,
  loadConfig,
  maybeShowTelemetryNotice,
  resolveProfileName,
  saveConfig,
  savedSdkKeyFor,
  type CliConfig,
} from './config.js';
import {
  CLI_KEY_LABEL,
  CLI_KEY_SCOPES,
  describeUnsafeSdkKey,
  probeKeyScope,
  SDK_KEY_LABEL,
  SDK_KEY_SCOPES,
  type ProbeKeyScope,
} from './key-scopes.js';
import { trySaveKeyToKeychain } from './keychain.js';
import { chooseProjectNonInteractive, defaultProjectName } from './login.js';
import {
  apiKeyHint,
  cliSetupDeepLink,
  consoleUrl,
  openInBrowser,
  projectIdHint,
  reportsUrl,
  resolveConsoleUrl,
  resolveConsoleUrlSync,
} from './console-url.js';
import { apiCall } from './cli-shared.js';
import {
  createProject,
  listProjects,
  mintProjectKey,
  startDeviceAuth,
  waitForCliToken,
  type DeviceProject,
} from './device-auth.js';
import {
  normalizeEndpoint,
  resolveCloudEndpoint,
  TEST_REPORT_FETCH_TIMEOUT_MS,
} from './endpoint.js';
import { checkFreshness } from './freshness.js';
import { detectWorkspaceHint, type WorkspaceHint } from './monorepo.js';
import { MUSHI_CLI_VERSION } from './version.js';
import { printAuthBanner } from './auth-ui.js';
import { formatDoctorResult, runDoctor } from './doctor.js';

export interface InitOptions {
  cwd?: string;
  projectId?: string;
  apiKey?: string;
  framework?: FrameworkId;
  skipInstall?: boolean;
  yes?: boolean;
  endpoint?: string;
  sendTestReport?: boolean;
  /** Audit an existing install (doctor checks) instead of running the wizard. */
  audit?: boolean;
}

/**
 * The keys the wizard ends up with, one per destination. `sdkKey` goes into
 * the app's env vars, which ship inside the bundle the end user downloads, so
 * it is report:write only. `cliKey` (report:write + mcp:read) goes to the
 * private CLI config for `mushi` commands and the MCP server; it is absent
 * when this run only learned an ingest key (a pasted key, for example).
 */
export interface WizardCredentials {
  projectId: string;
  sdkKey: string;
  cliKey?: string;
}

const ENV_FILES = ['.env.local', '.env'] as const;

/** Both stdin and stdout are terminals, so clack prompts can be answered. */
function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Accept both formats:
//   - UUID v4  (current backend default): xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//   - proj_xxx (future short-form): proj_ + 10+ alphanumeric chars
// The backend schema column is `uuid primary key default gen_random_uuid()`, so
// every project created so far is a UUID. The proj_ prefix may be adopted in a
// future API revision. Never break existing UUID users.
const PROJECT_ID_PATTERN =
  /^(?:proj_[A-Za-z0-9_-]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const API_KEY_PATTERN = /^(mushi_|mush_pk_)[A-Za-z0-9_-]{10,}$/;

export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (options.audit) {
    await runInitAudit(cwd);
    return;
  }

  ensureInteractiveOrBailOut(options);
  // Past the guard, a non-interactive run has either --yes or the full flag
  // set; both mean "take the defaults". Without this, the env-overwrite,
  // rewards and test-report confirms would each wait on a stdin that never
  // answers.
  if (!isInteractive()) options = { ...options, yes: true };

  p.intro('Mushi setup');

  await printFreshnessHint();
  warnIfWorkspaceRoot(cwd);

  const pkg = readPackageJson(cwd);
  maybeSuggestAudit(pkg);
  if (!pkg) {
    p.log.warn('No package.json found in this directory.');
    if (!isInteractive()) {
      // The prompt below defaults to "no"; without a terminal to ask, take
      // that default instead of hanging on it.
      p.cancel('Aborted. Run from your project root, or pass --cwd <path>.');
      process.exit(1);
    }
    const cont = await p.confirm({
      message: 'Continue anyway? (Mushi will install into the current folder)',
      initialValue: false,
    });
    if (p.isCancel(cont) || !cont) {
      p.cancel('Aborted. Run from your project root and try again.');
      process.exit(0);
    }
  }

  const detected = detectFramework(cwd, pkg);
  const framework = await chooseFramework(detected, options);

  const consoleBase = await resolveConsoleUrl({ cwd });
  // Honor a previously-saved self-hosted endpoint (`mushi config endpoint …`)
  // so existing users aren't silently redirected to Mushi Cloud. Precedence:
  // --endpoint flag → MUSHI_API_ENDPOINT env → saved config → cloud default.
  const endpoint = resolveCloudEndpoint(
    options.endpoint ?? process.env.MUSHI_API_ENDPOINT?.trim() ?? loadConfig().endpoint,
  );
  // Thread the resolved endpoint through so every downstream step (verify,
  // connect offer, test report) talks to the same backend.
  options = { ...options, endpoint };

  const credentials = await acquireCredentials(options, consoleBase, endpoint);
  await verifyCredentials(credentials, options, consoleBase);

  const pm = detectPackageManager(cwd);
  const packagesToInstall = framework.needsWebPackage
    ? [framework.packageName, '@mushi-mushi/web']
    : [framework.packageName];

  if (!options.skipInstall) {
    await installPackages(pm, packagesToInstall, cwd);
  } else {
    p.log.info(`Skipped install. Run \`${installCommand(pm, packagesToInstall)}\` yourself.`);
  }

  // Only the ingest key goes into app env; the CLI key stays in the private
  // CLI config (see planCliConfigUpdate).
  await writeEnvFile(
    cwd,
    credentials.sdkKey,
    credentials.projectId,
    framework,
    endpoint,
    Boolean(options.yes),
  );
  persistCliConfig(credentials, endpoint);
  emitWizardFunnelEvent(credentials, endpoint, 'wizard_env_written', { framework: framework.id });

  const enableRewards = await maybeEnableRewards(options);

  await maybeInjectSnippet(cwd, framework, options);

  printNextSteps(framework, consoleBase, enableRewards);

  await maybeSendTestReport(credentials, { ...options, endpoint, consoleBase });

  await maybeOfferConnect(credentials, options, consoleBase);

  p.outro('Setup complete.');
}

/**
 * `--audit` branch: the project already has Mushi (or the user wants a
 * health check, not a re-install). Delegate to the existing doctor checks —
 * SDK install + import, host-app wiring, MCP config, ingest readiness —
 * instead of re-running the wizard over a working setup. Mirrors the
 * PostHog wizard's audit-existing-install behavior.
 */
async function runInitAudit(cwd: string): Promise<void> {
  p.intro('Mushi setup audit');
  const config = loadConfig();
  const result = await runDoctor(config, { cwd, hostApp: true, mcp: true });
  p.log.message(formatDoctorResult(result));
  if (result.ready) {
    p.outro('Audit complete — setup looks healthy.');
  } else {
    p.outro('Audit found issues — each FAIL line above has a → Fix hint. `mushi doctor --fix` applies the safe ones.');
    process.exitCode = 1;
  }
}

/** Point users who re-run the wizard on an already-wired project at --audit. */
function maybeSuggestAudit(pkg: ReturnType<typeof readPackageJson>): void {
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
  };
  if (Object.keys(deps).some((d) => d.startsWith('@mushi-mushi/'))) {
    p.log.info(
      'A Mushi SDK is already installed here. To health-check the existing setup instead, run `npx mushi-mushi --audit`.',
    );
  }
}

/**
 * Non-interactive guard. When stdin is not a TTY (an AI agent's shell, CI,
 * Docker builds) `@clack/prompts` hangs forever on the first prompt. `--yes`
 * is enough to run unattended: it reuses the credentials a previous
 * `mushi login` saved, or runs browser sign-in, which needs no TTY (the
 * approval URL is printed and polled). Without `--yes` the only unattended
 * path is the full flag set.
 */
function ensureInteractiveOrBailOut(options: InitOptions): void {
  if (isInteractive()) return;
  if (options.yes) return;
  if (options.framework && options.projectId && options.apiKey) return;

  process.stderr.write(
    'mushi-mushi: non-interactive terminal detected.\n' +
      'Re-run with --yes to set up without prompts: it reuses the credentials saved by\n' +
      '`npx mushi-mushi login`, or prints a sign-in URL and waits while you approve it in a browser.\n' +
      'Example: npx mushi-mushi --yes\n' +
      'CI with no browser: npx mushi-mushi --yes --project-id <uuid> --api-key <ingest-only key>\n',
  );
  process.exit(1);
}

async function chooseFramework(detected: Framework, options: InitOptions): Promise<Framework> {
  if (options.framework) {
    const explicit = FRAMEWORKS[options.framework];
    if (!explicit) throw new Error(`Unknown framework: ${options.framework}`);
    p.log.step(`Using framework: ${explicit.label} (from --framework)`);
    return explicit;
  }

  if (options.yes) {
    p.log.step(`Detected ${detected.label} → installing ${detected.packageName}`);
    return detected;
  }

  const confirmed = await p.select({
    message: `Detected ${detected.label}. Use this?`,
    initialValue: detected.id,
    options: Object.values(FRAMEWORKS).map((fw) => ({
      value: fw.id,
      label: `${fw.id === detected.id ? '✓ ' : '  '}${fw.label}`,
      hint: fw.packageName,
    })),
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  return FRAMEWORKS[confirmed];
}

/**
 * Acquire SDK credentials with the least friction possible. Precedence:
 *   1. Explicit --project-id + --api-key flags (CI / scripted).
 *   2. Saved credentials from a previous `mushi login` (offer to reuse).
 *   3. Browser sign-in (RFC 8628 device-auth) — recommended, zero copy-paste.
 *   4. Manual Project ID + API key paste (fallback / self-hosted).
 *
 * Browser sign-in is the default because it removes the #1 setup pain point:
 * users no longer have to hunt for a UUID and a key in the console. This
 * mirrors `gh auth login`, `vercel login`, and `stripe login`.
 */
async function acquireCredentials(
  options: InitOptions,
  consoleBase: string,
  endpoint: string,
): Promise<WizardCredentials> {
  const probe: ProbeKeyScope = (e, k, pid) => probeKeyScope(e, k, pid);

  // 1. Explicit flags win (CI / non-interactive). The key is bound for the
  //    app's env, so it has to be ingest-only.
  if (options.projectId && options.apiKey) {
    const projectId = sanitizeSecret(options.projectId);
    const sdkKey = sanitizeSecret(options.apiKey);
    await assertUserKeyIsIngestOnly(sdkKey, projectId, endpoint, probe);
    return { projectId, sdkKey };
  }

  // 2. Reuse saved credentials from a prior login.
  const existing = loadConfig();
  // Show one-time telemetry notice before the wizard prompts begin.
  maybeShowTelemetryNotice(existing);
  let browserTried = false;
  if (!options.projectId && !options.apiKey && existing.projectId && existing.apiKey) {
    const reuse = options.yes
      ? true
      : await p.confirm({
          message: 'Use the Mushi credentials saved from your last sign-in?',
          initialValue: true,
        });
    if (p.isCancel(reuse)) {
      p.cancel('Aborted.');
      process.exit(0);
    }
    if (reuse) {
      const saved = await resolveSavedCredentials(
        { projectId: existing.projectId, apiKey: existing.apiKey, sdkKey: existing.sdkKey },
        endpoint,
        probe,
      );
      if (saved.kind === 'ready') return saved.credentials;
      if (saved.kind === 'needs-sdk-key') {
        p.log.info(
          'Your saved sign-in key can read bug reports, so it stays in the CLI config. ' +
            "Approve one browser sign-in to mint a separate ingest-only key for the app's env vars.",
        );
        browserTried = true;
        const creds = await runBrowserSignIn(options, endpoint, consoleBase, {
          projectId: saved.projectId,
          cliKey: saved.cliKey,
        });
        if (creds) return creds;
      } else {
        p.log.warn(`Saved credentials can't be reused (${saved.reason}) — signing in again.`);
      }
    }
  }

  // 3. Browser sign-in is the default credential path. Under `--yes` we skip
  //    the method chooser and go straight to it (it's lower-friction than
  //    pasting a UUID + key); otherwise we offer it as the recommended option.
  //    Any failure falls through to manual entry — the wizard never hard-fails.
  if (browserTried) {
    p.log.warn(
      "Browser sign-in didn't complete — switching to manual entry. " +
        'Run `npx mushi-mushi doctor --auth` to diagnose the sign-in path.',
    );
  } else if (options.yes) {
    const creds = await runBrowserSignIn(options, endpoint, consoleBase);
    if (creds) return creds;
    p.log.warn(
      "Browser sign-in didn't complete — switching to manual entry. " +
        'Run `npx mushi-mushi doctor --auth` to diagnose the sign-in path.',
    );
  } else {
    const method = await p.select({
      message: 'Connect this app to Mushi',
      initialValue: 'browser',
      options: [
        {
          value: 'browser',
          label: 'Sign in with your browser',
          hint: 'Recommended — no copy-paste, creates the project + key for you',
        },
        {
          value: 'manual',
          label: 'Paste a Project ID + API key',
          hint: 'Self-hosted or expert setup — run npx mushi-mushi (not mushi setup)',
        },
      ],
    });
    if (p.isCancel(method)) {
      p.cancel('Aborted.');
      process.exit(0);
    }
    if (method === 'browser') {
      const creds = await runBrowserSignIn(options, endpoint, consoleBase);
      if (creds) return creds;
      p.log.warn(
        "Browser sign-in didn't complete — switching to manual entry. " +
          'Run `npx mushi-mushi doctor --auth` to diagnose the sign-in path.',
      );
    }
  }

  // 4. Manual paste fallback.
  return collectCredentialsManually(options, consoleBase, endpoint, probe);
}

/**
 * Refuse a user-supplied key (flag or paste) for the app's env vars unless
 * the backend confirms it cannot read. `invalid` and `unreachable` pass: the
 * whoami check in verifyCredentials reports those with a precise message.
 */
async function assertUserKeyIsIngestOnly(
  key: string,
  projectId: string,
  endpoint: string,
  probe: ProbeKeyScope,
): Promise<void> {
  const result = await probe(endpoint, key, projectId);
  if (result.result === 'mcp' || result.result === 'unknown') {
    throw new Error(
      `Not writing this API key into your app's env vars: ${describeUnsafeSdkKey(result, endpoint)}. ` +
        'Use an ingest-only (report:write) key from the console, or leave out --api-key to sign in ' +
        'with the browser, which mints one.',
    );
  }
}

export type SavedCredentialsResolution =
  | { kind: 'ready'; credentials: WizardCredentials }
  /** The saved key is the private CLI key; an SDK key still has to be minted. */
  | { kind: 'needs-sdk-key'; projectId: string; cliKey: string }
  | { kind: 'unusable'; reason: string };

/**
 * Decide what the credentials saved by `mushi login` (or an earlier wizard
 * run) can be used for. The saved `apiKey` normally carries mcp:read, so it
 * is never written to app env; the ingest key saved for the same project is,
 * and so is an `apiKey` the backend confirms is ingest-only.
 */
export async function resolveSavedCredentials(
  saved: Pick<CliConfig, 'sdkKey'> & { projectId: string; apiKey: string },
  endpoint: string,
  probe: ProbeKeyScope,
): Promise<SavedCredentialsResolution> {
  const projectId = sanitizeSecret(saved.projectId);
  const apiKey = sanitizeSecret(saved.apiKey);

  const savedSdkKey = savedSdkKeyFor(saved, projectId);
  if (savedSdkKey) {
    const sdkProbe = await probe(endpoint, savedSdkKey, projectId);
    if (sdkProbe.result === 'ingest-only') {
      return { kind: 'ready', credentials: { projectId, sdkKey: savedSdkKey, cliKey: apiKey } };
    }
    // Revoked or otherwise unusable — fall back to what the CLI key allows.
  }

  const cliProbe = await probe(endpoint, apiKey, projectId);
  if (cliProbe.result === 'ingest-only') {
    return { kind: 'ready', credentials: { projectId, sdkKey: apiKey } };
  }
  if (cliProbe.result === 'mcp') {
    return { kind: 'needs-sdk-key', projectId, cliKey: apiKey };
  }
  return { kind: 'unusable', reason: describeUnsafeSdkKey(cliProbe, endpoint) };
}

export interface WizardMintDeps {
  createProject: typeof createProject;
  mintProjectKey: typeof mintProjectKey;
}

export type WizardMintTarget =
  | { kind: 'existing'; projectId: string }
  | { kind: 'new'; name: string };

export interface WizardMintResult {
  projectId: string;
  /** Name the server gave a project this call created. */
  createdName?: string;
  sdkKey: string;
  cliKey?: string;
  /** Why the CLI key could not be minted. The SDK key is still usable. */
  cliKeyError?: string;
}

/**
 * Mint one key per destination after browser approval: a report:write key
 * for the app's env vars and, unless the caller already holds one, a
 * report:write + mcp:read key for the private CLI config. Throws when the
 * project cannot be created or the SDK key cannot be minted; a failed CLI
 * key is reported in `cliKeyError` instead, because the SDK install can
 * still finish without it. Minting is not idempotent, so nothing retries.
 */
export async function mintWizardKeys(
  deps: WizardMintDeps,
  args: { endpoint: string; cliToken: string; target: WizardMintTarget; withCliKey: boolean },
): Promise<WizardMintResult> {
  let projectId: string;
  let createdName: string | undefined;
  let sdkKey: string | null = null;

  if (args.target.kind === 'new') {
    const created = await deps.createProject(args.endpoint, args.cliToken, args.target.name, {
      scopes: SDK_KEY_SCOPES,
    });
    projectId = created.id;
    createdName = created.name;
    sdkKey = created.apiKey;
  } else {
    projectId = args.target.projectId;
  }

  if (!sdkKey) {
    sdkKey = await deps.mintProjectKey(args.endpoint, args.cliToken, projectId, {
      scopes: SDK_KEY_SCOPES,
      label: SDK_KEY_LABEL,
    });
  }

  let cliKey: string | undefined;
  let cliKeyError: string | undefined;
  if (args.withCliKey) {
    try {
      cliKey = await deps.mintProjectKey(args.endpoint, args.cliToken, projectId, {
        scopes: CLI_KEY_SCOPES,
        label: CLI_KEY_LABEL,
      });
    } catch (err) {
      cliKeyError = err instanceof Error ? err.message : String(err);
    }
  }

  return { projectId, createdName, sdkKey, cliKey, cliKeyError };
}

/**
 * Zero-copy-paste browser sign-in: opens the console approval page, waits for
 * the user to click Approve, then picks or creates a project and mints the
 * keys automatically (see mintWizardKeys). Works without a TTY: the approval
 * URL is printed and polled, and the project is chosen from the app folder
 * (chooseProjectNonInteractive). Returns null on any failure so the caller can
 * fall back to manual entry (never hard-fails the wizard).
 *
 * `preset` is set when the user already has a saved CLI key for a project and
 * only the ingest key is missing: no project pick, no second CLI key.
 */
async function runBrowserSignIn(
  options: InitOptions,
  endpoint: string,
  consoleBase: string,
  preset?: { projectId: string; cliKey: string },
): Promise<WizardCredentials | null> {
  const startSpin = p.spinner();
  startSpin.start('Starting secure browser sign-in…');
  let session;
  try {
    session = await startDeviceAuth(endpoint, ensureClientId());
  } catch (err) {
    startSpin.stop('Could not start browser sign-in.');
    p.log.warn(err instanceof Error ? err.message : String(err));
    return null;
  }
  startSpin.stop('Browser sign-in ready.');

  try {
    await openInBrowser(session.verification_uri);
  } catch {
    /* best-effort — URL is shown in the banner below */
  }
  printAuthBanner(session.user_code, session.verification_uri);

  const waitSpin = p.spinner();
  waitSpin.start('Waiting for you to approve in the browser…');
  let cliToken: string;
  try {
    cliToken = await waitForCliToken(endpoint, session);
  } catch (err) {
    waitSpin.stop("Browser sign-in didn't complete.");
    p.log.warn(err instanceof Error ? err.message : String(err));
    return null;
  }
  waitSpin.stop('Approved.');

  // Pick or create a project.
  const presetProjectId =
    preset?.projectId ?? (options.projectId ? sanitizeSecret(options.projectId) : undefined);
  let target: WizardMintTarget;

  if (presetProjectId) {
    target = { kind: 'existing', projectId: presetProjectId };
  } else {
    let projects: DeviceProject[] = [];
    const fetchSpin = p.spinner();
    fetchSpin.start('Loading your projects…');
    try {
      projects = await listProjects(endpoint, cliToken);
      fetchSpin.stop(
        projects.length > 0 ? `Found ${projects.length} project(s).` : 'No projects yet.',
      );
    } catch (err) {
      if (!isInteractive()) {
        // Without the list we cannot tell whether this app already has a
        // project, and creating one blind could duplicate it.
        fetchSpin.stop('Could not load projects.');
        p.log.warn(err instanceof Error ? err.message : String(err));
        return null;
      }
      fetchSpin.stop('Could not load projects — you can still create a new one.');
      p.log.warn(err instanceof Error ? err.message : String(err));
    }

    if (!isInteractive()) {
      const cwd = options.cwd ?? process.cwd();
      const choice = chooseProjectNonInteractive(
        projects,
        defaultProjectName(readPackageJson(cwd)?.name, cwd),
      );
      if (choice.kind === 'existing') {
        p.log.info(`Using project "${choice.name}" (matches this app — pass --project-id to pick another).`);
        target = { kind: 'existing', projectId: choice.id };
      } else {
        p.log.info(`Creating project "${choice.name}" (no project matches this app — pass --project-id to use an existing one).`);
        target = { kind: 'new', name: choice.name };
      }
    } else {
      const NEW = '__new__';
      const choice = await p.select<string>({
        message: 'Choose a project',
        initialValue: projects[0]?.id ?? NEW,
        options: [
          ...projects.map((pr) => ({ value: pr.id, label: pr.name, hint: pr.id.slice(0, 8) })),
          { value: NEW, label: 'Create a new project', hint: 'mints an SDK key automatically' },
        ],
      });
      if (p.isCancel(choice)) {
        p.cancel('Aborted.');
        process.exit(0);
      }

      if (choice === NEW) {
        const name = await p.text({
          message: 'Project name',
          placeholder: 'My app',
          validate: (v) => (v && v.trim().length > 0 ? undefined : 'Required'),
        });
        if (p.isCancel(name)) {
          p.cancel('Aborted.');
          process.exit(0);
        }
        target = { kind: 'new', name: name.trim() };
      } else {
        target = { kind: 'existing', projectId: choice };
      }
    }
  }

  // Raw keys can never be recovered after creation, so every run mints fresh
  // ones: the ingest key for the app's env, plus the CLI key unless the user
  // already has one saved (preset).
  const keySpin = p.spinner();
  keySpin.start(target.kind === 'new' ? `Creating "${target.name}"…` : 'Minting keys…');
  let minted: WizardMintResult;
  try {
    minted = await mintWizardKeys(
      { createProject, mintProjectKey },
      { endpoint, cliToken, target, withCliKey: !preset },
    );
  } catch (err) {
    keySpin.stop(target.kind === 'new' ? 'Could not create the project.' : 'Could not mint an API key.');
    p.log.warn(err instanceof Error ? err.message : String(err));
    if (target.kind === 'existing') {
      p.log.warn(
        `You're signed in, but key minting failed. Generate one manually in the console Verify tab: ` +
          `${consoleUrl(consoleBase, '/onboarding?tab=verify')}`,
      );
    }
    return null;
  }
  keySpin.stop(
    minted.createdName
      ? `Created project "${minted.createdName}" with an ingest-only SDK key.`
      : 'SDK key ready (ingest-only).',
  );
  if (minted.cliKeyError) {
    p.log.warn(
      `The CLI/MCP key could not be minted (${minted.cliKeyError}). The SDK install continues; ` +
        'run `npx mushi-mushi login` later for MCP and admin commands.',
    );
  }

  return {
    projectId: minted.projectId,
    sdkKey: minted.sdkKey,
    cliKey: preset?.cliKey ?? minted.cliKey,
  };
}

async function collectCredentialsManually(
  options: InitOptions,
  consoleBase: string,
  endpoint: string,
  probe: ProbeKeyScope,
): Promise<WizardCredentials> {
  const existing = loadConfig();
  let savedProjectId = existing.projectId;
  let savedApiKey: string | undefined;

  if (!isInteractive() && !(options.projectId && options.apiKey)) {
    throw new Error(
      "Browser sign-in didn't complete and this terminal cannot prompt for a key. " +
        'Re-run `npx mushi-mushi --yes` and approve the sign-in in the browser, ' +
        'or pass --project-id and an ingest-only --api-key.',
    );
  }

  // Never silently adopt saved credentials. Announce the reuse, check they
  // still authenticate AND are ingest-only (they go into the app's env), and
  // fall back to prompting when they aren't. Before the auth half of this
  // guard, a stale CLI config meant no prompt was ever shown and the wizard
  // died later in verifyCredentials with a one-line error — the exact
  // "terminal just returns to the prompt" report.
  if (!options.projectId && !options.apiKey && savedProjectId && existing.apiKey) {
    const projectIdForCheck = sanitizeSecret(savedProjectId);
    const candidate = savedSdkKeyFor(existing, projectIdForCheck) ?? sanitizeSecret(existing.apiKey);
    p.log.info(
      `Found saved credentials from a previous sign-in (project ${projectIdForCheck.slice(0, 8)}…).`,
    );
    const checkSpin = p.spinner();
    checkSpin.start('Checking saved credentials…');
    const check = await probe(endpoint, candidate, projectIdForCheck);
    if (check.result === 'ingest-only') {
      checkSpin.stop('Saved ingest key still works.');
      savedApiKey = candidate;
    } else if (check.result === 'mcp') {
      checkSpin.stop("Saved key can read reports, so it can't go into your app's env — paste an ingest-only key below.");
    } else if (check.result === 'invalid') {
      checkSpin.stop('Saved credentials no longer authenticate — enter fresh ones below.');
      savedProjectId = undefined;
    } else {
      checkSpin.stop(`Could not check the saved key (${describeUnsafeSdkKey(check, endpoint)}) — enter one below.`);
    }
  }

  const rawProjectId =
    options.projectId ??
    savedProjectId ??
    (await promptText({
      message: 'Project ID',
      placeholder: 'e.g. bdafa28d-b153-482f-bd4f-42981f3fd3a4',
      hint: projectIdHint(consoleBase),
      validate: (v) =>
        PROJECT_ID_PATTERN.test(v.trim())
          ? undefined
          : 'Expected a UUID — copy it from the Projects page or the panel right after you create a project.',
    }));

  const rawApiKey =
    options.apiKey ??
    savedApiKey ??
    (await promptText({
      message: 'API key',
      placeholder: 'mushi_xxxxxxxxxxxx',
      hint: apiKeyHint(consoleBase),
      validate: (v) =>
        API_KEY_PATTERN.test(v)
          ? undefined
          : 'Expected format: mushi_ followed by 10+ alphanumeric characters',
    }));

  const projectId = sanitizeSecret(rawProjectId);
  const apiKey = sanitizeSecret(rawApiKey);

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `Invalid project ID. Expected a UUID (e.g. bdafa28d-b153-482f-bd4f-42981f3fd3a4) ` +
        `or the proj_* prefixed form. Got: ${redact(projectId)} — copy it from ` +
        `${projectIdHint(consoleBase)}`,
    );
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error(
      `Invalid API key. Expected format: mushi_[A-Za-z0-9_-]{10,}. Got: ${redact(apiKey)}`,
    );
  }
  // A pasted or flag key is headed for the app's env; the saved one was
  // already confirmed ingest-only above.
  if (apiKey !== savedApiKey) {
    await assertUserKeyIsIngestOnly(apiKey, projectId, endpoint, probe);
  }

  return { projectId, sdkKey: apiKey };
}

async function verifyCredentials(
  credentials: WizardCredentials,
  options: InitOptions,
  consoleBase: string,
): Promise<void> {
  const endpoint = resolveCloudEndpoint(options.endpoint);
  const spinner = p.spinner();
  spinner.start('Verifying credentials…');

  const result = await apiCall<{ project_name: string; project_id: string }>('/v1/sync/whoami', {
    apiKey: credentials.sdkKey,
    projectId: credentials.projectId,
    endpoint,
  });

  if (!result.ok && (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT')) {
    // A request that never got an answer says nothing about the key; the
    // old message sent people to re-copy a key that was fine.
    spinner.stop(`Could not reach ${endpoint}.`);
    p.log.error(result.error.message);
    p.log.warn('Setup did NOT complete: nothing was installed and no env vars were written.');
    p.log.info(
      'Check your network, proxy or VPN, or pass --endpoint <url> if you run a self-hosted backend, then re-run `npx mushi-mushi`.',
    );
    throw new Error(`Could not reach the Mushi API at ${endpoint} — nothing was changed.`);
  }

  if (!result.ok) {
    spinner.stop('Credentials could not be verified.');
    p.log.error(result.error?.message ?? 'Authentication failed.');
    // Be explicit about the wizard's state — a bare exit here used to look
    // like a silent success followed by a missing .env.local.
    p.log.warn('Setup did NOT complete: nothing was installed and no env vars were written.');
    p.log.info(
      [
        'To recover:',
        '  • Re-run `npx mushi-mushi` and choose "Sign in with your browser", or',
        `  • Double-check the Project ID / API key in the console: ${cliSetupDeepLink(consoleBase)}`,
      ].join('\n'),
    );
    throw new Error('Credential verification failed — fix Project ID / API key and re-run.');
  }

  // The API key is the source of truth for which project it belongs to —
  // `/v1/sync/whoami` resolves `project_id` from the key server-side and
  // ignores whatever `projectId` the client sent alongside it. A stale saved
  // config (e.g. the key was later rotated for a different project) would
  // otherwise pass verification here and then silently write the WRONG
  // `NEXT_PUBLIC_MUSHI_PROJECT_ID` — reports still land in the key's real
  // project, but every local env var/tool would point at a project that has
  // no data. Self-heal by adopting the authoritative id before it's written.
  if (result.data.project_id && result.data.project_id !== credentials.projectId) {
    p.log.warn(
      `Project ID ${redact(credentials.projectId)} doesn't match this API key's project — using the key's actual project (${result.data.project_name}) instead.`,
    );
    credentials.projectId = result.data.project_id;
  }

  spinner.stop(`Connected to ${result.data.project_name}`);
}

/**
 * Strip whitespace, quotes, and any control characters a user might paste by
 * accident. Prevents env-file injection via newlines in a pasted secret.
 * Exported for test coverage of the env-file-injection defense.
 */
export function sanitizeSecret(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n\0]/g, '');
}

function redact(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

async function promptText(opts: {
  message: string;
  placeholder?: string;
  /** Shown BEFORE the prompt so the user knows where to look. */
  hint?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  // Show the hint before the prompt — it tells users where to find the value.
  if (opts.hint) p.log.info(opts.hint);
  const value = await p.text({
    message: opts.message,
    placeholder: opts.placeholder,
    // @clack/prompts v1 widened the validate input to `string | undefined`
    // (the previous v0.x API guaranteed a string). Guard the empty case
    // explicitly so the rest of the pipeline keeps its `string` invariant.
    validate: (v) => {
      const clean = sanitizeSecret(v ?? '');
      if (clean.length === 0) return 'Required';
      return opts.validate ? opts.validate(clean) : undefined;
    },
  });
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(0);
  }
  return value;
}

async function installPackages(pm: PackageManager, packages: string[], cwd: string): Promise<void> {
  const command = installCommand(pm, packages);
  const spinner = p.spinner();
  spinner.start(`Installing ${packages.join(', ')} via ${pm}…`);

  try {
    await runCommand(pm, packages, cwd);
    spinner.stop(`Installed ${packages.join(', ')}`);
  } catch (err) {
    spinner.stop(`Install failed — run \`${command}\` manually.`);
    // Surface only the terse error shape — never leak the full command with
    // secrets that might have landed in argv via --api-key.
    p.log.error(err instanceof Error ? err.name + ': ' + err.message : String(err));
  }
}

/**
 * Spawn the package manager safely across platforms without relying on
 * `shell: true`. On Windows npm / pnpm / yarn / bun ship as `.cmd` shims, so
 * we resolve the platform-specific executable name up-front.
 */
function runCommand(pm: PackageManager, packages: string[], cwd: string): Promise<void> {
  const verb = pm === 'npm' ? 'install' : 'add';
  const command = process.platform === 'win32' ? `${pm}.cmd` : pm;

  return new Promise((resolve, reject) => {
    const child = spawn(command, [verb, ...packages], {
      stdio: 'inherit',
      shell: false,
      cwd,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${pm} exited with code ${code ?? 'null'}`));
    });
  });
}

async function writeEnvFile(
  cwd: string,
  apiKey: string,
  projectId: string,
  framework: Framework,
  endpoint: string,
  overwrite: boolean,
): Promise<void> {
  const target = ENV_FILES.find((f) => existsSync(join(cwd, f))) ?? ENV_FILES[0];
  const targetPath = join(cwd, target);
  const newVars = envVarsToWrite(apiKey, projectId, framework, endpoint);

  // Read-then-branch instead of existsSync()-then-readFileSync(): a missing
  // file just yields '' here, avoiding the check→use TOCTOU window CodeQL
  // flags as js/file-system-race (same pattern as connect.ts).
  let existing = '';
  try {
    existing = readFileSync(targetPath, 'utf-8');
  } catch {
    existing = '';
  }
  if (existing.includes('MUSHI_PROJECT_ID')) {
    let shouldOverwrite = overwrite;
    if (!shouldOverwrite) {
      const answer = await p.confirm({
        message: `Existing MUSHI_* vars found in ${target}. Update with new credentials?`,
        initialValue: true,
      });
      if (p.isCancel(answer)) {
        p.log.info(`Kept existing env vars in ${target}.`);
        return;
      }
      shouldOverwrite = Boolean(answer);
    }
    if (!shouldOverwrite) {
      p.log.info(`Kept existing env vars in ${target}. Re-run and confirm to overwrite.`);
      return;
    }
    // Replace existing MUSHI_* lines (framework-prefixed and bare).
    const MUSHI_LINE_RE = /^(NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_|EXPO_PUBLIC_)?MUSHI_[A-Z_]+=.*/gm;
    const stripped = existing
      .replace(MUSHI_LINE_RE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
    const prefix = stripped.length > 0 ? '\n' : '';
    writeFileSync(targetPath, `${stripped}${prefix}\n# Mushi Mushi\n${newVars}\n`);
    p.log.success(`Updated MUSHI_* env vars in ${target}`);
    warnIfMissingFromGitignore(cwd, target);
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(targetPath, `${prefix}\n# Mushi Mushi\n${newVars}\n`);

  p.log.success(`Wrote env vars to ${target}`);
  warnIfMissingFromGitignore(cwd, target);
}

/**
 * Return true when any line in the user's `.gitignore` actually matches the
 * env file we just wrote. Subtle point: `.env` in gitignore does NOT cover
 * `.env.local` — gitignore matches by filename, not prefix. We build a tiny
 * glob matcher (only `*` as wildcard, gitignore's common case) and test each
 * non-comment line. `!`-prefixed negations are treated as "not covered" to
 * stay on the safe side — better a false warning than a silent leak.
 */
export function isEnvFileCoveredByGitignore(gitignoreContent: string, envFile: string): boolean {
  const lines = gitignoreContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  let covered = false;
  for (const line of lines) {
    if (line.startsWith('!')) {
      if (matchesGitignorePattern(line.slice(1), envFile)) covered = false;
      continue;
    }
    if (matchesGitignorePattern(line, envFile)) covered = true;
  }
  return covered;
}

/**
 * Minimal gitignore-style matcher:
 *   - leading "/" anchors to the root (we always match against a single
 *     filename, so we just strip it)
 *   - trailing "/" means directory-only — does not match a file
 *   - "*" matches any run of characters except "/"
 *   - all other characters are literal
 * Good enough for the half-dozen env-file patterns users actually write.
 */
function matchesGitignorePattern(pattern: string, filename: string): boolean {
  if (pattern.endsWith('/')) return false;
  const normalized = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  const regexSource = normalized
    .split('')
    .map((ch) => (ch === '*' ? '[^/]*' : escapeRegexChar(ch)))
    .join('');
  return new RegExp(`^${regexSource}$`).test(filename);
}

function escapeRegexChar(ch: string): string {
  return /[-/\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}

function warnIfMissingFromGitignore(cwd: string, envFile: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    p.log.warn(`No .gitignore found — make sure ${envFile} is not committed.`);
    return;
  }
  const content = readFileSync(gitignorePath, 'utf-8');
  if (!isEnvFileCoveredByGitignore(content, envFile)) {
    p.log.warn(`${envFile} is not in .gitignore — add it before committing.`);
  }
}

/**
 * The CLI config after a wizard run. The private key slot gets the CLI key;
 * when this run only learned an ingest key, a key already saved for the same
 * project is kept (it may carry mcp:read the ingest key lacks). The ingest
 * key is saved too, bound to its project, so the next run can reuse it
 * without a browser sign-in.
 */
export function planCliConfigUpdate(
  existing: CliConfig,
  credentials: WizardCredentials,
  endpoint: string,
): CliConfig {
  const keepSavedKey = existing.projectId === credentials.projectId && Boolean(existing.apiKey);
  const apiKey = credentials.cliKey ?? (keepSavedKey ? existing.apiKey : credentials.sdkKey);
  return {
    ...existing,
    apiKey,
    projectId: credentials.projectId,
    endpoint,
    sdkKey: { projectId: credentials.projectId, key: credentials.sdkKey },
  };
}

function persistCliConfig(credentials: WizardCredentials, endpoint: string): void {
  const existing = loadConfig();
  const next = planCliConfigUpdate(existing, credentials, endpoint);
  saveConfig(next);
  // loadConfig() prefers the OS keychain over the file, so a key that changed
  // here has to land in the keychain too or the next command reads the old one.
  if (next.apiKey && next.apiKey !== existing.apiKey) {
    trySaveKeyToKeychain(next.apiKey, resolveProfileName());
  }
}

/**
 * Fire-and-forget setup-funnel signal. The server emits every earlier funnel
 * step itself (cli_auth_started → cli_key_minted), but only the CLI knows the
 * wizard actually finished writing env + config — without this, "approved in
 * browser but wizard never completed" failures are invisible in the funnel.
 * Opt out with MUSHI_NO_TELEMETRY=1. Never blocks or fails the wizard.
 */
function emitWizardFunnelEvent(
  credentials: WizardCredentials,
  endpoint: string,
  event: 'wizard_env_written',
  metadata: Record<string, unknown> = {},
): void {
  if (process.env.MUSHI_NO_TELEMETRY) return;
  void fetch(`${endpoint.replace(/\/$/, '')}/v1/cli/funnel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': credentials.sdkKey,
      'X-Mushi-Project': credentials.projectId,
    },
    body: JSON.stringify({ event, source: 'cli', metadata }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {
    /* best-effort */
  });
}

/**
 * Offer idempotent marker-block injection of the init snippet for
 * frameworks where it is a plain top-of-file import (see ENTRY_CANDIDATES).
 * JSX-provider frameworks are never auto-edited — the snippet must wrap the
 * user's render tree, and rewriting that is riskier than a copy-paste.
 * Declining (or non-interactive runs) falls through to the printed snippet;
 * `mushi doctor` verifies either way via its "SDK init snippet wired" check.
 */
async function maybeInjectSnippet(
  cwd: string,
  framework: Framework,
  options: InitOptions,
): Promise<void> {
  if (options.yes || !process.stdin.isTTY) return;
  const { ENTRY_CANDIDATES, injectSnippet, MUSHI_MARKER_START } = await import('./snippet-inject.js');
  const candidates = ENTRY_CANDIDATES[framework.id];
  if (!candidates) return;

  const { readFile, writeFile } = await import('node:fs/promises');
  const nodePath = await import('node:path');
  for (const rel of candidates) {
    const abs = nodePath.join(cwd, rel);
    let source: string;
    try {
      source = await readFile(abs, 'utf8');
    } catch {
      continue;
    }

    const alreadyInjected = source.includes(MUSHI_MARKER_START);
    const confirmed = await p.confirm({
      message: alreadyInjected
        ? `Refresh the Mushi init block in ${rel}?`
        : `Add the Mushi init snippet to ${rel}? (wrapped in markers; re-runs update in place)`,
    });
    if (p.isCancel(confirmed) || !confirmed) return;

    await writeFile(abs, injectSnippet(source, framework.snippet()), 'utf8');
    p.log.success(`${alreadyInjected ? 'Updated' : 'Added'} Mushi init block in ${rel}`);
    return;
  }
}

function printNextSteps(framework: Framework, consoleBase: string, enableRewards = false): void {
  p.note(framework.snippet(), 'Add this to your app:');

  if (enableRewards) {
    const badgeSnippet =
      framework.id === 'react'
        ? `// Add to your user menu or profile UI:\nimport { MushiRewardsBadge } from '@mushi-mushi/react';\n\n// Inside your component:\n<MushiRewardsBadge showPoints />`
        : `// Add to your user menu:\n// import { MushiRewardsBadge } from '@mushi-mushi/react';\n// <MushiRewardsBadge showPoints />`;
    p.note(badgeSnippet, 'Rewards badge snippet:');
    p.log.info(`Enable rewards in your project settings at ${consoleUrl(consoleBase, '/rewards')}`);
    p.log.info('Users will earn points for bug reports, screen navigation, and app activity.');
  }

  p.note(
    [
      '  [ ] 1. Paste the init snippet above into your app entry file',
      '  [ ] 2. Start your dev server',
      '  [ ] 3. Wire your editor: npx mushi-mushi setup --ide cursor   (or --ide claude)',
      `  [ ] 4. Open the Verify tab to send a test report: ${consoleUrl(consoleBase, '/onboarding?tab=verify')}`,
    ].join('\n'),
    'Next steps:',
  );
}

async function maybeOfferConnect(
  credentials: WizardCredentials,
  options: InitOptions,
  _consoleBase: string,
): Promise<void> {
  if (options.yes) return;

  const answer = await p.confirm({
    message:
      'Run `mushi connect --write-env --wire-ide --wait` now? (SDK env + Cursor MCP + heartbeat check)',
    initialValue: false,
  });
  if (p.isCancel(answer) || !answer) return;

  const endpoint = resolveCloudEndpoint(options.endpoint);
  try {
    const { runConnect } = await import('./connect.js');
    // persistCliConfig already chose the private key; hand connect the same
    // one so it does not overwrite it, and the ingest key for the env.
    const saved = loadConfig();
    const result = await runConnect(
      {
        apiKey: saved.apiKey ?? credentials.sdkKey,
        sdkKey: credentials.sdkKey,
        projectId: credentials.projectId,
        endpoint,
        cwd: options.cwd,
        writeEnv: true,
        wireIde: true,
        wait: true,
      },
      saved,
    );
    for (const line of result.messages) p.log.message(line);
  } catch (err) {
    p.log.warn(err instanceof Error ? err.message : String(err));
    p.log.info('You can run manually: mushi connect --write-env --wire-ide --wait');
  }
}

async function maybeEnableRewards(options: InitOptions): Promise<boolean> {
  if (options.yes) return false; // non-interactive: opt out by default

  const answer = await p.confirm({
    message: 'Enable Mushi Rewards? (users earn points for bug reports + app activity)',
    initialValue: false,
  });
  if (p.isCancel(answer)) return false;
  return Boolean(answer);
}

/**
 * Close the loop: send a real report through the public ingest endpoint so
 * the user immediately sees their first classified bug in the console.
 * Opt-in via prompt (or `--yes` auto-accepts it).
 */
async function maybeSendTestReport(
  credentials: WizardCredentials,
  options: InitOptions & { endpoint?: string; consoleBase?: string },
): Promise<void> {
  if (options.sendTestReport === false) return;

  let shouldSend: boolean;
  if (options.sendTestReport === true || options.yes) {
    shouldSend = true;
  } else {
    const answer = await p.confirm({
      message: 'Send a test report now to verify the pipeline?',
      initialValue: true,
    });
    if (p.isCancel(answer)) return;
    shouldSend = answer;
  }

  if (!shouldSend) return;

  const endpoint = normalizeEndpoint(resolveCloudEndpoint(options.endpoint));

  const spinner = p.spinner();
  spinner.start('Sending test report…');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_REPORT_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${endpoint}/v1/reports`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': credentials.sdkKey,
        'X-Mushi-Project': credentials.projectId,
      },
      body: JSON.stringify({
        projectId: credentials.projectId,
        description: 'Test report from the mushi-mushi setup wizard',
        category: 'other',
        reporterToken: `wizard-${randomUUID()}`,
        createdAt: new Date().toISOString(),
        environment: {
          url: 'cli://wizard',
          userAgent: `mushi-wizard/${process.platform}-${process.arch}`,
          platform: process.platform,
          language: 'en',
          viewport: { width: 0, height: 0 },
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    });

    if (!res.ok) {
      spinner.stop(`Test report rejected (HTTP ${res.status}).`);
      p.log.warn(
        res.status === 401 || res.status === 403
          ? 'Credentials did not authenticate — double-check the project ID and API key.'
          : 'Skipping test report. You can retry with `mushi test`.',
      );
      return;
    }

    spinner.stop('Test report sent.');
    let reportId: string | undefined;
    try {
      const body = (await res.json()) as { data?: { reportId?: string } };
      reportId = body.data?.reportId;
    } catch {
      // non-fatal — fall back to the reports list
    }
    const consoleBase = options.consoleBase ?? resolveConsoleUrlSync(options.cwd);
    p.log.success(`View it at ${reportsUrl(consoleBase, reportId)}`);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    spinner.stop(aborted ? 'Timed out reaching the Mushi API.' : 'Could not reach the Mushi API.');
    p.log.warn(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function printFreshnessHint(): Promise<void> {
  const result = await checkFreshness('mushi-mushi', MUSHI_CLI_VERSION);
  if (!result || !result.isOutdated) return;
  p.log.info(
    `A newer version of mushi-mushi is available: ${result.current} → ${result.latest}. ` +
      'Run `npx mushi-mushi@latest` to get the freshest wizard.',
  );
}

function warnIfWorkspaceRoot(cwd: string): void {
  let hint: WorkspaceHint | null;
  try {
    hint = detectWorkspaceHint(cwd);
  } catch {
    return;
  }
  if (!hint || hint.apps.length === 0) return;

  const hasFrameworkAtCwd = hint.apps.some((app) =>
    isSameDirectory(cwd, resolveWorkspaceAppPath(hint!.root, app.relativePath)),
  );
  if (hasFrameworkAtCwd) return;

  const apps = hint.apps
    .slice(0, 5)
    .map((app) => `  • ${app.relativePath} (${app.framework})`)
    .join('\n');
  p.log.warn(
    `You appear to be at a workspace root (source: ${hint.source}). Mushi will install into the current directory, ` +
      'which has no framework dep. You probably meant one of these sub-packages:\n' +
      `${apps}\n` +
      'Run `mushi init --cwd <path>` — or re-run the wizard from inside that package.',
  );
}

function resolveWorkspaceAppPath(root: string, relativePath: string): string {
  return `${root}/${relativePath}`.replace(/\\/g, '/');
}

function isSameDirectory(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').replace(/\/+$/, '') === b.replace(/\\/g, '/').replace(/\/+$/, '');
}
