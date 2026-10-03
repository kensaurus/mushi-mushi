import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { dbError, callerProjectIds, resolveOwnedProject, callerCanAccessProject } from '../shared.ts';
import { buildImportEdges, detectExploreLayer, getProjectCodebaseScope } from '../../_shared/codebase-understand.ts';
import { pathMatchesScope } from '../../_shared/codebase-scope.ts';
import { unverifiedGithubInstallsAllowed } from '../../_shared/github-install-trust.ts';
import { resolveProjectGithubToken } from '../../_shared/github.ts';
import { resolveBranchForConnect } from '../../_shared/github-branch.ts';
import { dereferenceMaybeVault, storeSettingsSecret } from '../../_shared/settings-secrets.ts';
import { isVaultRef } from '../../_shared/vault-ref.ts';
import type { KnowledgeGraph } from '../../_shared/codebase-graph-build.ts';
import {
  DEFAULT_INDEX_FILE_CAP,
  INDEX_FILE_CAP_ENV,
  describeIndexCoverage,
  indexFileCapForPlan,
  latestIso,
  isIndexCoverageState,
  type IndexCoverageState,
} from '../../_shared/index-coverage.ts';
import { resolveProjectPlan } from '../../_shared/quota.ts';

/** The project_repos columns the codebase stats read. */
interface CodebaseRepoRow {
  repo_url: string | null
  default_branch: string | null
  path_globs: string[] | null
  last_indexed_at: string | null
  last_index_error: string | null
  last_index_attempt_at: string | null
  github_app_installation_id: number | null
  indexing_enabled: boolean | null
  index_swept_at: string | null
  index_files_indexed: number | null
  index_files_eligible: number | null
  index_file_cap: number | null
  index_tree_truncated: boolean | null
  index_coverage_state: string | null
}

/** Coverage as the console shows it; null until a sweep has measured it. */
export function codebaseCoverageView(repo: Pick<
  CodebaseRepoRow,
  'index_files_indexed' | 'index_files_eligible' | 'index_file_cap' | 'index_tree_truncated' | 'index_coverage_state' | 'index_swept_at' | 'last_indexed_at'
> | null): {
  indexed_files: number
  eligible_files: number
  file_cap: number | null
  truncated: boolean
  state: IndexCoverageState
  summary: string | null
  measured_at: string | null
} | null {
  const state = repo?.index_coverage_state
  if (!repo || repo.index_files_indexed == null || repo.index_files_eligible == null) return null
  if (!isIndexCoverageState(state)) return null
  const truncated = repo.index_tree_truncated === true
  return {
    indexed_files: repo.index_files_indexed,
    eligible_files: repo.index_files_eligible,
    file_cap: repo.index_file_cap,
    truncated,
    state,
    summary: describeIndexCoverage({
      indexed: repo.index_files_indexed,
      eligible: repo.index_files_eligible,
      cap: repo.index_file_cap,
      truncated,
      state,
    }),
    measured_at: latestIso(repo.index_swept_at, repo.last_indexed_at),
  }
}

export function registerProjectCodebaseRoutes(app: Hono<{ Variables: Variables }>): void {
  // ---------------------------------------------------------------------------
  // Codebase indexing (Phase 3 of the PDCA unblock).
  //
  // POST /v1/admin/projects/:id/codebase/enable
  //   - Upserts a `project_repos` row for the primary repo.
  //   - Flips `project_settings.codebase_index_enabled = true`, seeds
  //     `codebase_repo_url` + (if missing) a GitHub webhook secret.
  //   - Kicks an immediate `mode=sweep` invocation on webhooks-github-indexer
  //     so the user doesn't have to wait for the hourly `mushi-repo-indexer-hourly`
  //     cron to see indexed files show up.
  //
  // GET /v1/admin/projects/:id/codebase/stats
  //   - Returns `indexed_files`, `last_indexed_at`, `last_index_error`,
  //     `codebase_index_enabled`, `repo_url`, and `has_webhook_secret` so the
  //     IntegrationsPage card can render live state. Cheap — one count +
  //     two single-row reads.
  // ---------------------------------------------------------------------------

  const GITHUB_URL_RE =
    /^https?:\/\/(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s#?]+?)(?:\.git)?\/?$/i;

  function parseGithubRepoUrl(
    url: string | null | undefined,
  ): { owner: string; repo: string } | null {
    if (!url) return null;
    const match = GITHUB_URL_RE.exec(url.trim());
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  async function generateWebhookSecret(): Promise<string> {
    // GitHub recommends at least 32 bytes of entropy for webhook secrets; we
    // emit 48 random bytes base64url-encoded → 64 chars of URL-safe ASCII,
    // well over the floor and friendly to copy-paste into the GitHub UI.
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function kickCodebaseSweep(projectId: string): Promise<void> {
    // The sweep writes to project_codebase_files and updates
    // project_repos.last_indexed_at / last_index_error. It used to run with
    // a 2s AbortSignal — any real first sweep takes longer, so the kick was
    // aborted and users saw "enabled" with zero indexed files and no error.
    // Now: record the attempt first (so the console shows "indexing" instead
    // of nothing), then keep the invocation alive via EdgeRuntime.waitUntil.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const internalSecret =
      Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !internalSecret) return;

    const db = getServiceClient();
    await db
      .from('project_repos')
      .update({ last_index_attempt_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('is_primary', true);

    const sweep = fetch(`${supabaseUrl}/functions/v1/webhooks-github-indexer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'sweep', project_id: projectId }),
      // Generous ceiling — protects against a hung upstream without
      // guillotining a legitimately slow first sweep.
      signal: AbortSignal.timeout(150_000),
    }).then(async (res) => {
      if (!res.ok) {
        const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
        await db
          .from('project_repos')
          .update({ last_index_error: `initial sweep kick failed: HTTP ${res.status} ${detail}`.slice(0, 500) })
          .eq('project_id', projectId)
          .eq('is_primary', true);
      }
    }).catch(async (err) => {
      await db
        .from('project_repos')
        .update({ last_index_error: `initial sweep kick failed: ${String(err).slice(0, 400)}` })
        .eq('project_id', projectId)
        .eq('is_primary', true);
    });

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(sweep);
    else await sweep;
  }

  app.post('/v1/admin/projects/:id/codebase/enable', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Enabling codebase indexing wires GitHub webhooks + secrets — restrict
    // to owner/admin (Teams v1 includes org owner/admin).
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

    let body: {
      repo_url?: string;
      default_branch?: string;
      installation_id?: string | number | null;
      path_globs?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } },
        400,
      );
    }

    const parsed = parseGithubRepoUrl(body.repo_url);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_REPO_URL',
            message: 'repo_url must look like https://github.com/<owner>/<repo>',
          },
        },
        400,
      );
    }
    const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    let installationId =
      body.installation_id != null && String(body.installation_id).trim() !== ''
        ? Number(body.installation_id)
        : null;
    if (installationId !== null && (!Number.isFinite(installationId) || installationId <= 0)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INSTALLATION_ID',
            message: 'installation_id must be a positive integer from the GitHub App install URL',
          },
        },
        400,
      );
    }
    // A client-supplied installation id is not proof the caller owns that
    // installation (see _shared/github-install-trust.ts).
    if (installationId !== null && !unverifiedGithubInstallsAllowed()) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INSTALLATION_UNVERIFIED',
            message:
              'GitHub App installation ids cannot be bound from a request yet. Use a Personal Access Token ' +
              '(Integrations → GitHub) for codebase indexing.',
          },
        },
        400,
      );
    }
    const pathGlobs = Array.isArray(body.path_globs)
      ? body.path_globs.filter((g) => typeof g === 'string')
      : [];

    // Promote a pending GitHub App installation (user installed the App before
    // registering a repo — the install callback parked the id on project_settings).
    let promotedPendingInstallation = false;
    if (installationId === null && unverifiedGithubInstallsAllowed()) {
      const { data: pendingRow, error: pendingReadError } = await db
        .from('project_settings')
        .select('github_app_installation_id_pending')
        .eq('project_id', projectId)
        .maybeSingle();
      if (pendingReadError) {
        // Best-effort promotion: on a read failure the credential pre-flight
        // below still decides (and reports) whether we can proceed.
        console.warn('[project-codebase] pending GitHub App installation lookup failed', {
          projectId,
          error: pendingReadError.message,
        });
      }
      const pending = (pendingRow as { github_app_installation_id_pending?: number | null } | null)
        ?.github_app_installation_id_pending ?? null;
      if (pending != null && Number.isFinite(Number(pending)) && Number(pending) > 0) {
        installationId = Number(pending);
        promotedPendingInstallation = true;
      }
    }

    // Credential pre-flight: fail fast rather than enabling with 0 indexed files.
    // Check the same resolution chain the indexer sweep uses:
    //   1. installation_id in this request → GitHub App will mint a token at sweep time
    //   2. project-level PAT ref in project_settings
    //   3. GITHUB_TOKEN env fallback (self-hosted operator credential)
    // The org-level PAT and the GitHub App env (GITHUB_APP_ID+GITHUB_APP_PRIVATE_KEY)
    // also cover it when installation_id is present, so 1 or 3 is sufficient.
    if (installationId === null && !Deno.env.get('GITHUB_TOKEN')) {
      // Check project-level PAT.
      const { data: settingsCheck } = await db
        .from('project_settings')
        .select('github_installation_token_ref')
        .eq('project_id', projectId)
        .maybeSingle();

      const hasProjectPat =
        settingsCheck?.github_installation_token_ref != null &&
        String(settingsCheck.github_installation_token_ref).trim().length > 0;

      if (!hasProjectPat) {
        // Check org-level PAT.
        const { data: projectForOrg } = await db
          .from('projects')
          .select('organization_id')
          .eq('id', projectId)
          .maybeSingle();
        const orgId = (projectForOrg as { organization_id: string | null } | null)?.organization_id ?? null;
        let hasOrgPat = false;
        if (orgId) {
          const { data: orgSettings } = await db
            .from('organization_integration_settings')
            .select('github_installation_token_ref')
            .eq('organization_id', orgId)
            .maybeSingle();
          hasOrgPat =
            orgSettings?.github_installation_token_ref != null &&
            String(orgSettings.github_installation_token_ref).trim().length > 0;
        }

        if (!hasOrgPat) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'NO_GITHUB_CREDENTIAL',
                message:
                  'Cannot enable codebase indexing: no GitHub credential found. ' +
                  'Provide installation_id (GitHub App), or save a Personal Access Token first — ' +
                  'console: Integrations → GitHub, or API: PUT /v1/admin/integrations/platform/github ' +
                  'with { github_installation_token_ref: "<PAT>" } (auto-encrypted into Supabase Vault).',
              },
            },
            400,
          );
        }
      }
    }

    // The console pre-fills "main"; ask GitHub which branch really exists
    // (kensaurus/mushi-mushi is 'master' and indexed nothing for 3 months).
    const { branch: defaultBranch } = await resolveBranchForConnect({
      token: await resolveProjectGithubToken(db, projectId, installationId),
      owner: parsed.owner,
      repo: parsed.repo,
      requested: body.default_branch,
    });

    const { data: existingRepo } = await db
      .from('project_repos')
      .select('id')
      .eq('project_id', projectId)
      .eq('repo_url', repoUrl)
      .maybeSingle();

    const repoRow = {
      project_id: projectId,
      repo_url: repoUrl,
      role: 'monorepo',
      default_branch: defaultBranch,
      path_globs: pathGlobs,
      github_app_installation_id: installationId,
      is_primary: true,
      indexing_enabled: true,
      updated_at: new Date().toISOString(),
    };
    const { error: repoErr } = existingRepo
      ? await db.from('project_repos').update(repoRow).eq('id', existingRepo.id)
      : await db.from('project_repos').insert(repoRow);
    if (repoErr) return dbError(c, repoErr);

    const { data: currentSettings } = await db
      .from('project_settings')
      .select('github_webhook_secret')
      .eq('project_id', projectId)
      .maybeSingle();

    // Keep a readable existing secret (the GitHub side already has it). A
    // missing or unreadable one is replaced, and `webhook_secret_issued` makes
    // the card reveal the new value. The column only ever stores a Vault ref.
    const storedSecret = (currentSettings?.github_webhook_secret as string | null | undefined) ?? null;
    const existingSecret = await dereferenceMaybeVault(db, storedSecret);
    const webhookSecretIssued = !existingSecret;
    const webhookSecret = existingSecret ?? (await generateWebhookSecret());
    let webhookSecretRef: string | null = null;
    if (webhookSecretIssued || !isVaultRef(storedSecret)) {
      try {
        webhookSecretRef = await storeSettingsSecret(db, projectId, 'github', 'github_webhook_secret', webhookSecret);
      } catch (err) {
        console.error('[project-codebase] could not store webhook secret in Vault', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json(
          { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: 'Could not store the webhook secret securely. Retry in a moment.' } },
          500,
        );
      }
    }
    const { error: settingsErr } = await db
      .from('project_settings')
      .update({
        codebase_index_enabled: true,
        codebase_repo_url: repoUrl,
        ...(webhookSecretRef ? { github_webhook_secret: webhookSecretRef } : {}),
        ...(promotedPendingInstallation ? { github_app_installation_id_pending: null } : {}),
      })
      .eq('project_id', projectId);
    if (settingsErr) return dbError(c, settingsErr);

    void kickCodebaseSweep(projectId);

    await logAudit(db, projectId, userId, 'settings.updated', 'codebase_index', projectId, {
      repo_url: repoUrl,
      default_branch: defaultBranch,
      installation_id: installationId,
      issued_webhook_secret: webhookSecretIssued,
    }).catch(() => {});

    return c.json({
      ok: true,
      data: {
        repo_url: repoUrl,
        default_branch: defaultBranch,
        webhook_secret: webhookSecret,
        webhook_secret_issued: webhookSecretIssued,
        indexed_files_eta_seconds: 90,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/projects/:id/codebase/rotate-secret
  //
  // Regenerates the GitHub webhook secret without re-enabling indexing.
  // CodebaseIndexCard's "Rotate secret" button has POSTed here since the card
  // shipped, but the route never existed: a leaked-secret rotation got a
  // plain-text 404 and a "Rotate failed" toast. Same owner/admin gate as
  // `enable` (rotating a webhook credential must not be looser than issuing
  // one) and the same `{ ok, data: { webhook_secret } }` envelope the card's
  // one-time reveal reads.
  // ---------------------------------------------------------------------------
  app.post('/v1/admin/projects/:id/codebase/rotate-secret', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

    const { data: settings, error: readErr } = await db
      .from('project_settings')
      .select('codebase_index_enabled, github_webhook_secret')
      .eq('project_id', projectId)
      .maybeSingle();
    if (readErr) return dbError(c, readErr);

    // A secret nothing consumes would only mislead: the webhook handler skips
    // repos whose indexing is off, and the card hides the button in that
    // state. 409 so a direct API caller learns why instead of getting a
    // secret that never takes effect.
    if (!settings?.codebase_index_enabled) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'CODEBASE_NOT_ENABLED',
            message: 'Enable codebase indexing before rotating its webhook secret.',
          },
        },
        409,
      );
    }

    const webhookSecret = await generateWebhookSecret();
    let webhookSecretRef: string;
    try {
      webhookSecretRef = await storeSettingsSecret(db, projectId, 'github', 'github_webhook_secret', webhookSecret);
    } catch (err) {
      console.error('[project-codebase] could not store rotated webhook secret in Vault', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: 'Could not store the webhook secret securely. Retry in a moment.' } },
        500,
      );
    }
    const { error: writeErr } = await db
      .from('project_settings')
      .update({ github_webhook_secret: webhookSecretRef })
      .eq('project_id', projectId);
    if (writeErr) return dbError(c, writeErr);

    await logAudit(db, projectId, userId, 'settings.updated', 'codebase_index', projectId, {
      action: 'rotate_webhook_secret',
      had_previous_secret: Boolean(settings.github_webhook_secret),
    }).catch(() => {});

    return c.json({ ok: true, data: { webhook_secret: webhookSecret } });
  });

  app.get('/v1/admin/projects/:id/codebase/stats', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Read-only stats — any role on the project (Teams v1 includes
    // org-members) can view.
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );
    }

    const [{ data: settings }, { data: primaryRepo }, { count: indexedChunks }, fileCap, { data: languageRows }] = await Promise.all([
      db
        .from('project_settings')
        .select('codebase_index_enabled, codebase_repo_url, github_webhook_secret')
        .eq('project_id', projectId)
        .maybeSingle(),
      db
        .from('project_repos')
        .select(
          'repo_url, default_branch, path_globs, last_indexed_at, last_index_error, last_index_attempt_at, github_app_installation_id, indexing_enabled, index_swept_at, index_files_indexed, index_files_eligible, index_file_cap, index_tree_truncated, index_coverage_state',
        )
        .eq('project_id', projectId)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('project_codebase_files')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('tombstoned_at', null),
      // The plan's coverage ceiling, live, so an upgrade shows at once (the
      // next sweep uses it). A plan read error says so instead of guessing.
      resolveProjectPlan(db, projectId)
        .then((plan) => indexFileCapForPlan(plan, Deno.env.get(INDEX_FILE_CAP_ENV)))
        .catch(() => null),
      // One whole-file row per indexed file (same sample the Explore stats use).
      db
        .from('project_codebase_files')
        .select('language')
        .eq('project_id', projectId)
        .is('tombstoned_at', null)
        .is('symbol_name', null)
        .limit(5000),
    ]);

    const repo = primaryRepo as CodebaseRepoRow | null;
    const coverage = codebaseCoverageView(repo);
    const languageDistribution: Record<string, number> = {};
    for (const row of (languageRows ?? []) as Array<{ language: string | null }>) {
      if (row.language) languageDistribution[row.language] = (languageDistribution[row.language] ?? 0) + 1;
    }
    return c.json({
      ok: true,
      data: {
        codebase_index_enabled: !!settings?.codebase_index_enabled,
        repo_url: repo?.repo_url ?? settings?.codebase_repo_url ?? null,
        default_branch: repo?.default_branch ?? null,
        installation_id: repo?.github_app_installation_id ?? null,
        indexing_enabled: repo?.indexing_enabled ?? null,
        path_globs: repo?.path_globs && repo.path_globs.length > 0 ? repo.path_globs : null,
        // Chunk rows (a file is split into several); coverage below is in files.
        indexed_files: indexedChunks ?? 0,
        indexed_chunks: indexedChunks ?? 0,
        file_cap: fileCap?.cap ?? repo?.index_file_cap ?? DEFAULT_INDEX_FILE_CAP,
        file_cap_source: fileCap?.source ?? 'unavailable',
        plan_id: fileCap?.planId ?? null,
        at_file_cap: coverage?.state === 'capped',
        coverage,
        language_distribution: languageDistribution,
        // Last sweep that covered every eligible file; a partial one sets index_swept_at only.
        last_indexed_at: repo?.last_indexed_at ?? null,
        index_swept_at: repo?.index_swept_at ?? null,
        last_index_attempt_at: repo?.last_index_attempt_at ?? null,
        last_index_error: repo?.last_index_error ?? null,
        has_webhook_secret: !!settings?.github_webhook_secret,
        // PAT-connected repos get push indexing through the api's repo webhook.
        push_webhook_path: repo && !repo.github_app_installation_id ? '/v1/webhooks/github' : null,
      },
    });
  });

  // ── Codebase Explorer ────────────────────────────────────────────────────
  //
  // GET  /v1/admin/projects/:id/codebase/explore
  //   Returns { nodes, edges, layers, total_files } — the full graph payload
  //   the ExplorePage visualises. Nodes are project_codebase_files rows
  //   (files or symbols); edges are derived by regex-scanning content_preview
  //   for relative import paths.
  //
  // POST /v1/admin/projects/:id/codebase/search
  //   Accepts { query, k?, scope_prefix?, mode?: 'semantic' | 'name' } and returns
  //   top-k semantically similar files via match_codebase_files, or name/fuzzy
  //   matches over file_path and symbol_name when mode=name.

  app.get('/v1/admin/explore/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const emptyLayers = { ui: 0, lib: 0, backend: 0, test: 0, config: 0, other: 0 }
    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      codebaseIndexEnabled: false,
      indexingEnabled: null as boolean | null,
      repoUrl: null as string | null,
      hasWebhookSecret: false,
      indexedFiles: 0,
      symbolCount: 0,
      withEmbeddings: 0,
      layers: emptyLayers,
      topLanguages: [] as string[],
      lastIndexedAt: null as string | null,
      indexCoverage: null as ReturnType<typeof codebaseCoverageView>,
      lastIndexAttemptAt: null as string | null,
      lastIndexError: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'not_enabled'
        | 'indexing'
        | 'error'
        | 'empty'
        | 'ready'
        | 'stale',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty })
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    const [
      settingsRes,
      primaryRepoRes,
      filesCountRes,
      symbolsCountRes,
      embeddingsCountRes,
      fileSampleRes,
    ] = await Promise.all([
      db
        .from('project_settings')
        .select('codebase_index_enabled, codebase_repo_url, github_webhook_secret')
        .eq('project_id', pid)
        .maybeSingle(),
      db
        .from('project_repos')
        .select(
          'repo_url, default_branch, last_indexed_at, last_index_error, last_index_attempt_at, indexing_enabled, index_swept_at, index_files_indexed, index_files_eligible, index_file_cap, index_tree_truncated, index_coverage_state',
        )
        .eq('project_id', pid)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .is('symbol_name', null),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .not('symbol_name', 'is', null),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .not('embedding', 'is', null),
      db
        .from('project_codebase_files')
        .select('file_path, language')
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .is('symbol_name', null)
        .limit(5000),
    ])

    const settings = settingsRes.data
    const primaryRepo = primaryRepoRes.data
    const indexedFiles = filesCountRes.count ?? 0
    const symbolCount = symbolsCountRes.count ?? 0
    const withEmbeddings = embeddingsCountRes.count ?? 0
    const codebaseIndexEnabled = !!settings?.codebase_index_enabled
    const indexingEnabled = primaryRepo?.indexing_enabled ?? null
    const repoUrl = primaryRepo?.repo_url ?? settings?.codebase_repo_url ?? null
    // The last successful sweep, complete or partial (coverage says which).
    const lastIndexedAt = latestIso(primaryRepo?.last_indexed_at ?? null, primaryRepo?.index_swept_at ?? null)
    const indexCoverage = codebaseCoverageView(primaryRepo as CodebaseRepoRow | null)
    const lastIndexAttemptAt = primaryRepo?.last_index_attempt_at ?? null
    const lastIndexError = primaryRepo?.last_index_error ?? null

    const layers = { ...emptyLayers }
    const langCounts = new Map<string, number>()
    for (const row of fileSampleRes.data ?? []) {
      const layer = detectExploreLayer(String(row.file_path ?? ''))
      layers[layer] = (layers[layer] ?? 0) + 1
      const lang = row.language ? String(row.language) : null
      if (lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
    }
    const topLanguages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang]) => lang)

    let topPriority: typeof empty.topPriority = 'ready'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`

    if (!codebaseIndexEnabled && indexedFiles === 0) {
      topPriority = 'not_enabled'
      topPriorityLabel =
        'Code search is off — turn on codebase indexing in Settings or Connect your GitHub repo.'
      topPriorityTo = scoped('/explore?tab=index')
    } else if (lastIndexError) {
      topPriority = 'error'
      topPriorityLabel = `Indexer failed — ${lastIndexError.slice(0, 120)}${lastIndexError.length > 120 ? '…' : ''}`
      topPriorityTo = scoped('/explore?tab=index')
    } else if (indexedFiles === 0 && lastIndexAttemptAt && !lastIndexedAt) {
      topPriority = 'indexing'
      topPriorityLabel = 'Indexer is running — Ask and Search unlock when files appear (~90s).'
      topPriorityTo = scoped('/explore?tab=index')
    } else if (indexedFiles === 0) {
      topPriority = 'empty'
      topPriorityLabel = 'No source files indexed yet — connect GitHub on Connect or run mushi index.'
      topPriorityTo = scoped('/connect')
    } else if (
      lastIndexedAt &&
      Date.now() - new Date(lastIndexedAt).getTime() > 7 * 24 * 60 * 60 * 1000
    ) {
      topPriority = 'stale'
      topPriorityLabel = `${indexedFiles.toLocaleString()} files indexed but last sync was over 7 days ago — re-index before trusting answers.`
      topPriorityTo = scoped('/explore?tab=index')
    } else {
      topPriority = 'ready'
      topPriorityLabel = indexCoverage && indexCoverage.state !== 'complete' && indexCoverage.summary
        ? `Partly indexed: ${indexCoverage.summary}. Answers only see those files.`
        : `${indexedFiles.toLocaleString()} files ready · ${withEmbeddings.toLocaleString()} embedded for semantic search.`
      topPriorityTo = scoped('/explore?tab=ask')
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        codebaseIndexEnabled,
        indexingEnabled,
        repoUrl,
        hasWebhookSecret: !!settings?.github_webhook_secret,
        indexedFiles,
        symbolCount,
        withEmbeddings,
        layers,
        topLanguages,
        lastIndexedAt,
        lastIndexAttemptAt,
        lastIndexError,
        indexCoverage,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/projects/:id/codebase/explore', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    const includeSymbols = c.req.query('symbols') === '1'
    const scope = await getProjectCodebaseScope(db, projectId)
    const scopePrefix = c.req.query('scope_prefix')?.trim() || null

    // Prefer symbol-level graph from analyze worker when available.
    if (includeSymbols) {
      const { data: graphRow } = await db
        .from('project_codebase_graph')
        .select('graph')
        .eq('project_id', projectId)
        .maybeSingle()
      const uaGraph = graphRow?.graph as KnowledgeGraph | null
      if (uaGraph?.nodes?.length) {
        const scopedNodes = uaGraph.nodes.filter((n) => {
          const fp = n.filePath ?? ''
          if (!fp) return true
          if (scopePrefix && !fp.startsWith(scopePrefix) && fp !== scopePrefix) return false
          return pathMatchesScope(fp, scope)
        })
        const nodeIds = new Set(scopedNodes.map((n) => n.id))
        const nodes = scopedNodes.map((n) => {
          const layer = String(n.metadata?.layer ?? detectExploreLayer(n.filePath ?? ''))
          return {
            id: n.id,
            node_type: (n.type === 'file' ? 'code_file' : 'code_symbol') as 'code_file' | 'code_symbol',
            label: n.name,
            metadata: {
              file_path: n.filePath ?? '',
              symbol_name: n.type === 'file' ? null : n.name,
              signature: n.summary ?? null,
              line_start: n.lineRange?.[0] ?? null,
              line_end: n.lineRange?.[1] ?? null,
              language: null,
              layer,
              content_preview: n.summary ?? null,
              last_modified: null,
              language_notes: n.languageNotes ?? null,
              tags: n.tags ?? null,
            },
          }
        })
        const edges = uaGraph.edges
          .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
          .slice(0, 2000)
          .map((e) => ({
            id: `${e.source}→${e.target}`,
            source_node_id: e.source,
            target_node_id: e.target,
            edge_type: e.type,
            weight: 1,
          }))
        const layerCounts: Record<string, number> = {}
        for (const n of nodes) {
          const l = n.metadata.layer
          layerCounts[l] = (layerCounts[l] ?? 0) + 1
        }
        const { count: totalFiles } = await db
          .from('project_codebase_files')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .is('tombstoned_at', null)
          .is('symbol_name', null)
        return c.json({
          ok: true,
          data: {
            nodes,
            edges,
            layers: layerCounts,
            total_files: totalFiles ?? 0,
            graph_source: 'ua',
          },
        })
      }
    }

    let query = db
      .from('project_codebase_files')
      // Include last_modified so the frontend can show file freshness.
      .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, last_modified')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .order('file_path')
      .limit(5000)

    if (!includeSymbols) {
      query = query.is('symbol_name', null)
    }

    const { data: rows, error: dbErr } = await query
    if (dbErr) return dbError(c, dbErr)

    let fileRows = (rows ?? []).filter((r) => pathMatchesScope(String(r.file_path), scope))
    if (scopePrefix) {
      fileRows = fileRows.filter(
        (r) => String(r.file_path).startsWith(scopePrefix) || String(r.file_path) === scopePrefix,
      )
    }

    const nodes = fileRows.map((r) => {
      const layer = detectExploreLayer(r.file_path)
      const label = r.symbol_name
        ? `${r.file_path.split('/').pop()} · ${r.symbol_name}`
        : (r.file_path.split('/').pop() ?? r.file_path)
      return {
        id: r.id,
        node_type: (r.symbol_name ? 'code_symbol' : 'code_file') as 'code_symbol' | 'code_file',
        label,
        metadata: {
          file_path: r.file_path,
          symbol_name: r.symbol_name ?? null,
          signature: r.signature ?? null,
          line_start: r.line_start ?? null,
          line_end: r.line_end ?? null,
          language: r.language ?? null,
          layer,
          content_preview: r.content_preview ?? null,
          last_modified: r.last_modified ?? null,
        },
      }
    })

    const builtEdges = buildImportEdges(
      fileRows.map((r) => ({
        id: r.id,
        file_path: r.file_path,
        symbol_name: r.symbol_name,
        content_preview: r.content_preview,
      })),
    )
    const edges = builtEdges.map((e) => ({
      id: e.id,
      source_node_id: e.source_node_id,
      target_node_id: e.target_node_id,
      edge_type: e.edge_type,
      weight: 1,
    }))

    // Layer summary counts
    const layerCounts: Record<string, number> = {}
    for (const n of nodes) {
      const l = n.metadata.layer
      layerCounts[l] = (layerCounts[l] ?? 0) + 1
    }

    // Total distinct files (not symbols)
    const { count: totalFiles } = await db
      .from('project_codebase_files')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .is('symbol_name', null)

    return c.json({
      ok: true,
      data: {
        nodes,
        edges,
        layers: layerCounts,
        total_files: totalFiles ?? fileRows.filter((r) => !r.symbol_name).length,
      },
    })
  })

  app.post('/v1/admin/projects/:id/codebase/search', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const authMethod = c.get('authMethod')
    const keyProjectId = c.get('projectId')
    const isOrgScopedKey = c.get('isOrgScopedKey') ?? false
    const db = getServiceClient()

    if (authMethod === 'apiKey' && !isOrgScopedKey && keyProjectId !== projectId) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PROJECT_SCOPE_MISMATCH',
            message: 'This project-scoped MCP key cannot search another project. Set MUSHI_PROJECT_ID to the key project or mint an org-scoped key.',
          },
        },
        403,
      )
    }

    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    let body: { query?: string; k?: number; scope_prefix?: string; mode?: 'semantic' | 'name' }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } }, 400)
    }
    if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
      return c.json({ ok: false, error: { code: 'MISSING_QUERY', message: 'query is required' } }, 400)
    }

    const k = Math.min(20, Math.max(1, Number(body.k ?? 8)))
    const scope = await getProjectCodebaseScope(db, projectId)
    const pathPrefix =
      body.scope_prefix?.trim() ||
      (scope.scope_paths?.length === 1 ? scope.scope_paths[0] : null) ||
      null

    if (body.mode === 'name') {
      const needle = body.query.trim().toLowerCase()
      let nameQuery = db
        .from('project_codebase_files')
        .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview')
        .eq('project_id', projectId)
        .is('tombstoned_at', null)
        .or(`file_path.ilike.%${needle}%,symbol_name.ilike.%${needle}%`)
        .limit(k * 3)
      if (pathPrefix) {
        nameQuery = nameQuery.or(`file_path.eq.${pathPrefix},file_path.like.${pathPrefix}/%`)
      }
      const { data: nameHits, error: nameErr } = await nameQuery
      if (nameErr) return dbError(c, nameErr)
      const results = (nameHits ?? [])
        .filter((h) => pathMatchesScope(String(h.file_path), scope))
        .slice(0, k)
        .map((h) => ({
          id: String(h.id ?? ''),
          file_path: String(h.file_path ?? ''),
          symbol_name: h.symbol_name ? String(h.symbol_name) : null,
          signature: h.signature ? String(h.signature) : null,
          line_start: h.line_start != null ? Number(h.line_start) : null,
          line_end: h.line_end != null ? Number(h.line_end) : null,
          language: h.language ? String(h.language) : null,
          similarity: 1,
          content_preview: h.content_preview != null ? String(h.content_preview) : null,
          layer: detectExploreLayer(String(h.file_path ?? '')),
        }))
      return c.json({ ok: true, data: { results, query: body.query.trim(), mode: 'name' } })
    }

    const { createEmbedding } = await import('../../_shared/embeddings.ts')
    const embedding = await createEmbedding(body.query.trim(), { projectId })

    const { data: hits, error: rpcErr } = await db.rpc('match_codebase_files', {
      query_embedding: embedding,
      match_project: projectId,
      match_count: k,
      path_prefix: pathPrefix,
    })
    if (rpcErr) return dbError(c, rpcErr)

    // Return all fields the frontend ExploreSearchHit type expects:
    // id, file_path, symbol_name, signature, line_start, line_end, language,
    // content_preview, similarity, layer.
    const results = (hits ?? [])
      .filter((h: Record<string, unknown>) => pathMatchesScope(String(h.file_path ?? ''), scope))
      .map((h: Record<string, unknown>) => ({
      id: String(h.id ?? ''),
      file_path: String(h.file_path ?? ''),
      symbol_name: h.symbol_name ? String(h.symbol_name) : null,
      signature: h.signature ? String(h.signature) : null,
      line_start: h.line_start != null ? Number(h.line_start) : null,
      line_end: h.line_end != null ? Number(h.line_end) : null,
      language: h.language ? String(h.language) : null,
      similarity: Number(h.similarity ?? 0),
      content_preview: h.content_preview != null ? String(h.content_preview) : null,
      layer: detectExploreLayer(String(h.file_path ?? '')),
    }))

    return c.json({ ok: true, data: { results, query: body.query.trim(), mode: 'semantic' } })
  })

}
