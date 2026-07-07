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
import { ensureClientId, loadConfig, saveConfig } from './config.js';
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

export interface InitOptions {
  cwd?: string;
  projectId?: string;
  apiKey?: string;
  framework?: FrameworkId;
  skipInstall?: boolean;
  yes?: boolean;
  endpoint?: string;
  sendTestReport?: boolean;
}

const ENV_FILES = ['.env.local', '.env'] as const;

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

  ensureInteractiveOrBailOut(options);

  p.intro('Mushi setup');

  await printFreshnessHint();
  warnIfWorkspaceRoot(cwd);

  const pkg = readPackageJson(cwd);
  if (!pkg) {
    p.log.warn('No package.json found in this directory.');
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

  await writeEnvFile(
    cwd,
    credentials.apiKey,
    credentials.projectId,
    framework,
    endpoint,
    Boolean(options.yes),
  );
  persistCliConfig(credentials.apiKey, credentials.projectId, endpoint);
  emitWizardFunnelEvent(credentials, endpoint, 'wizard_env_written', { framework: framework.id });

  const enableRewards = await maybeEnableRewards(options);

  await maybeInjectSnippet(cwd, framework, options);

  printNextSteps(framework, consoleBase, enableRewards);

  await maybeSendTestReport(credentials, { ...options, endpoint, consoleBase });

  await maybeOfferConnect(credentials, options, consoleBase);

  p.outro('Setup complete.');
}

/**
 * Non-interactive guard. When stdin is not a TTY (CI, shell pipelines,
 * Docker builds) `@clack/prompts` hangs forever on the first prompt. Bail
 * out with a clear error unless the user supplied enough flags to skip
 * every prompt.
 */
function ensureInteractiveOrBailOut(options: InitOptions): void {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (isTTY) return;

  const hasAllFlags = Boolean(
    (options.framework || options.yes) && options.projectId && options.apiKey,
  );
  if (hasAllFlags) return;

  process.stderr.write(
    'mushi-mushi: non-interactive terminal detected.\n' +
      'Pass all of --yes (or --framework), --project-id, and --api-key to run unattended.\n' +
      'Example: npx mushi-mushi --yes --project-id <uuid-from-console> --api-key mushi_xxx\n' +
      'Your project ID is the UUID shown in the Projects page of the Mushi admin console.\n',
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
): Promise<{ apiKey: string; projectId: string }> {
  // 1. Explicit flags win (CI / non-interactive).
  if (options.projectId && options.apiKey) {
    return {
      projectId: sanitizeSecret(options.projectId),
      apiKey: sanitizeSecret(options.apiKey),
    };
  }

  // 2. Reuse saved credentials from a prior login.
  const existing = loadConfig();
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
      return {
        projectId: sanitizeSecret(existing.projectId),
        apiKey: sanitizeSecret(existing.apiKey),
      };
    }
  }

  // 3. Browser sign-in is the default credential path. Under `--yes` we skip
  //    the method chooser and go straight to it (it's lower-friction than
  //    pasting a UUID + key); otherwise we offer it as the recommended option.
  //    Any failure falls through to manual entry — the wizard never hard-fails.
  if (options.yes) {
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
  return collectCredentialsManually(options, consoleBase, endpoint);
}

/**
 * Zero-copy-paste browser sign-in: opens the console approval page, waits for
 * the user to click Approve, then lets them pick or create a project and mints
 * the SDK key automatically. Returns null on any failure so the caller can
 * fall back to manual entry (never hard-fails the wizard).
 */
async function runBrowserSignIn(
  options: InitOptions,
  endpoint: string,
  consoleBase: string,
): Promise<{ apiKey: string; projectId: string } | null> {
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
  let projectId = options.projectId ? sanitizeSecret(options.projectId) : undefined;
  let apiKey: string | undefined;

  if (!projectId) {
    let projects: DeviceProject[] = [];
    const fetchSpin = p.spinner();
    fetchSpin.start('Loading your projects…');
    try {
      projects = await listProjects(endpoint, cliToken);
      fetchSpin.stop(
        projects.length > 0 ? `Found ${projects.length} project(s).` : 'No projects yet.',
      );
    } catch (err) {
      fetchSpin.stop('Could not load projects — you can still create a new one.');
      p.log.warn(err instanceof Error ? err.message : String(err));
    }

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
      const createSpin = p.spinner();
      createSpin.start(`Creating "${name.trim()}"…`);
      try {
        const created = await createProject(endpoint, cliToken, name.trim());
        projectId = created.id;
        apiKey = created.apiKey ?? undefined;
        createSpin.stop(`Created project "${created.name}".`);
      } catch (err) {
        createSpin.stop('Could not create the project.');
        p.log.warn(err instanceof Error ? err.message : String(err));
        return null;
      }
    } else {
      projectId = choice;
    }
  }

  // Selecting an existing project (or a create that didn't return a key) mints
  // a fresh report:write key — raw keys can never be recovered after creation.
  if (projectId && !apiKey) {
    const keySpin = p.spinner();
    keySpin.start('Minting SDK key…');
    try {
      apiKey = await mintProjectKey(endpoint, cliToken, projectId);
      keySpin.stop('SDK key ready.');
    } catch (err) {
      keySpin.stop('Could not mint an API key.');
      p.log.warn(err instanceof Error ? err.message : String(err));
      p.log.warn(
        `You're signed in, but key minting failed. Generate one manually in the console Verify tab: ` +
          `${consoleUrl(consoleBase, '/onboarding?tab=verify')}`,
      );
      return null;
    }
  }

  if (!projectId || !apiKey) return null;
  return { apiKey, projectId };
}

async function collectCredentialsManually(
  options: InitOptions,
  consoleBase: string,
  endpoint: string,
): Promise<{ apiKey: string; projectId: string }> {
  const existing = loadConfig();
  let savedProjectId = existing.projectId;
  let savedApiKey = existing.apiKey;

  // Never silently adopt saved credentials. Announce the reuse, check they
  // still authenticate, and fall back to prompting when they don't. Before
  // this guard, a stale ~/.config/mushi/config.json meant no prompt was ever
  // shown and the wizard died later in verifyCredentials with a one-line
  // error — the exact "terminal just returns to the prompt" report.
  if (!options.projectId && !options.apiKey && savedProjectId && savedApiKey) {
    p.log.info(
      `Found saved credentials from a previous sign-in (project ${sanitizeSecret(savedProjectId).slice(0, 8)}…).`,
    );
    const checkSpin = p.spinner();
    checkSpin.start('Checking saved credentials…');
    const check = await apiCall<{ project_name: string }>('/v1/sync/whoami', {
      apiKey: sanitizeSecret(savedApiKey),
      projectId: sanitizeSecret(savedProjectId),
      endpoint,
    });
    if (check.ok) {
      checkSpin.stop(`Saved credentials still work (${check.data.project_name}).`);
    } else {
      checkSpin.stop('Saved credentials no longer authenticate — enter fresh ones below.');
      savedProjectId = undefined;
      savedApiKey = undefined;
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

  return { projectId, apiKey };
}

async function verifyCredentials(
  credentials: { apiKey: string; projectId: string },
  options: InitOptions,
  consoleBase: string,
): Promise<void> {
  const endpoint = resolveCloudEndpoint(options.endpoint);
  const spinner = p.spinner();
  spinner.start('Verifying credentials…');

  const result = await apiCall<{ project_name: string; project_id: string }>('/v1/sync/whoami', {
    apiKey: credentials.apiKey,
    projectId: credentials.projectId,
    endpoint,
  });

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

function persistCliConfig(apiKey: string, projectId: string, endpoint: string): void {
  const existing = loadConfig();
  saveConfig({ ...existing, apiKey, projectId, endpoint });
}

/**
 * Fire-and-forget setup-funnel signal. The server emits every earlier funnel
 * step itself (cli_auth_started → cli_key_minted), but only the CLI knows the
 * wizard actually finished writing env + config — without this, "approved in
 * browser but wizard never completed" failures are invisible in the funnel.
 * Opt out with MUSHI_NO_TELEMETRY=1. Never blocks or fails the wizard.
 */
function emitWizardFunnelEvent(
  credentials: { apiKey: string; projectId: string },
  endpoint: string,
  event: 'wizard_env_written',
  metadata: Record<string, unknown> = {},
): void {
  if (process.env.MUSHI_NO_TELEMETRY) return;
  void fetch(`${endpoint.replace(/\/$/, '')}/v1/cli/funnel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': credentials.apiKey,
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
      '  [ ] 3. Run: mushi connect --write-env --wire-ide --wait',
      `  [ ] 4. Open the Verify tab to send a test report: ${consoleUrl(consoleBase, '/onboarding?tab=verify')}`,
    ].join('\n'),
    'Next steps:',
  );
}

async function maybeOfferConnect(
  credentials: { apiKey: string; projectId: string },
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
    await runConnect({
      apiKey: credentials.apiKey,
      projectId: credentials.projectId,
      endpoint,
      cwd: options.cwd,
      writeEnv: true,
      wireIde: true,
      wait: true,
    });
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
  credentials: { apiKey: string; projectId: string },
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
        'X-Mushi-Api-Key': credentials.apiKey,
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
