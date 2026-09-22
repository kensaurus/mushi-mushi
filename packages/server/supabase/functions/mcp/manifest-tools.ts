/**
 * Loads hosted-tool-manifest.json and builds ToolDef entries for tools
 * not hand-authored in mcp/index.ts — keeps HTTP MCP at catalog parity.
 *
 * Templates use the catalog's camelCase parameter names (`{projectId}`);
 * handleToolsCall has already renamed snake_case aliases by the time a
 * handler runs (arg-aliases.ts). Wire field names the API expects stay in
 * the templates (`"tier_slug": "{tierSlug}"`).
 */

import manifest from '../_shared/mcp-hosted-tool-manifest.json' with { type: 'json' };
import { MCP_DISCOVERY } from '../_shared/mcp-server-card.ts';

export interface ManifestToolDef {
  scope: 'mcp:read' | 'mcp:write';
  description: string;
  method: string;
  /**
   * API path. `{token}` path segments are required values; `key={token}`
   * query pairs are dropped when the token resolves to nothing, and a boolean
   * renders as `1` (true) or is dropped (false).
   */
  path: string;
  required?: string[];
  body?: Record<string, unknown>;
  bodyPassthrough?: boolean;
  /** Return `{ [wrap]: data }` instead of the route's payload, to match the catalog's outputSchema. */
  wrap?: string;
  transform?:
    | 'fix_suggest'
    | 'diagnose_connection'
    | 'qa_run_pick'
    | 'backend_health'
    | 'account_overview'
    | 'submit_fix_result'
    | 'codebase_chat'
    | 'skills_list';
  /**
   * Optional MCP annotation overrides (production-readiness audit item #18).
   * Every manifest tool used to get a bare `{ readOnlyHint, openWorldHint }`
   * with no destructiveHint/idempotentHint at all — per the MCP spec, an
   * omitted destructiveHint defaults to `true` for non-read-only tools, which
   * happened to be safe-by-accident for tools like merge_fix, but gave no way
   * to express "not idempotent" (award_bonus_points: retrying after a timeout
   * double-awards) or to be explicit rather than relying on client-side
   * defaults. Set this for any tool where the default inference isn't
   * good enough — mirror the value used in packages/mcp/src/catalog.ts so the
   * stdio and hosted transports agree.
   */
  hints?: { destructive?: boolean; idempotent?: boolean };
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: { authHeaders: Record<string, string>; projectIdHint?: string },
) => Promise<unknown>;

export interface ToolDef {
  scope: 'mcp:read' | 'mcp:write';
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The catalog's outputSchema — the handler's result must match it (see `wrap` and the transforms). */
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  handler: ToolHandler;
}

function resolveToken(
  token: string,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string {
  if (token === 'projectIdHint') return ctx.projectIdHint ?? '';
  if (token.includes('|')) {
    const [key, fallback] = token.split('|');
    const v = args[key] ?? args[key.replace(/([A-Z])/g, '_$1').toLowerCase()];
    return String(v ?? fallback);
  }
  const camel = token;
  const snake = token.replace(/([A-Z])/g, '_$1').toLowerCase();
  const v =
    args[camel] ??
    args[snake] ??
    (token === 'projectId' || token === 'project_id' ? ctx.projectIdHint : undefined);
  return v != null ? String(v) : '';
}

function resolveBodyToken(
  token: string,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): unknown {
  if (token === 'projectIdHint') return ctx.projectIdHint;
  const [key, fallback] = token.split('|');
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  const value =
    args[key] ??
    args[snake] ??
    (key === 'projectId' || key === 'project_id' ? ctx.projectIdHint : undefined);
  if (value !== undefined && value !== null && value !== '') return value;
  if (fallback === undefined) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(fallback)) return Number(fallback);
  if (fallback === 'true') return true;
  if (fallback === 'false') return false;
  if (fallback === 'null') return null;
  return fallback;
}

/** A query-string value: booleans are flags (`1` or absent), arrays are comma-joined. */
function queryValue(token: string, args: Record<string, unknown>, ctx: { projectIdHint?: string }): string {
  const raw = args[token.split('|')[0]];
  if (raw === true) return '1';
  if (raw === false) return '';
  if (Array.isArray(raw)) return raw.map(String).join(',');
  return resolveToken(token, args, ctx);
}

function interpolatePath(
  template: string,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string {
  const q = template.indexOf('?');
  const pathTemplate = q === -1 ? template : template.slice(0, q);
  const path = pathTemplate.replace(/\{([^}]+)\}/g, (_, raw) =>
    encodeURIComponent(resolveToken(raw, args, ctx)),
  );
  if (q === -1) return path;
  // An unset optional parameter used to go out as `key=` — and routes that
  // read `c.req.query(key) ?? default` treat '' as a real (empty) value.
  const qs = new URLSearchParams();
  for (const pair of template.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const valueTemplate = eq === -1 ? '' : pair.slice(eq + 1);
    const token = valueTemplate.match(/^\{([^}]+)\}$/)?.[1];
    const value = token === undefined ? valueTemplate : queryValue(token, args, ctx);
    if (value !== '') qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

function buildBody(
  spec: ManifestToolDef,
  args: Record<string, unknown>,
  ctx: { projectIdHint?: string },
): string | undefined {
  if (spec.bodyPassthrough) {
    const body = { ...args };
    if (!body.project_id && ctx.projectIdHint) body.project_id = ctx.projectIdHint;
    if (!body.projectId && ctx.projectIdHint) body.projectId = ctx.projectIdHint;
    return JSON.stringify(body);
  }
  if (!spec.body) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.body)) {
    if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
      out[k] = resolveBodyToken(v.slice(1, -1), args, ctx);
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

/** Namespace for submit_fix_result's derived idempotency key — the stdio server uses the same one. */
const SUBMIT_FIX_IDEMPOTENCY_NAMESPACE = 'mushi.mcp.submit_fix_result.v1';

/**
 * Name-based UUID (v5 layout, SHA-256 digest) — the derivation
 * packages/mcp/src/server.ts uses, so a retried submit_fix_result sends the
 * same Idempotency-Key and the API replays the stored response.
 */
async function stableUuidFrom(...parts: readonly string[]): Promise<string> {
  const input = parts.join('\u001f');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const MULTI_PROJECT_HINT_ONE =
  'You are currently connected to one project. To connect additional Mushi projects, ' +
  'open the Mushi console → switch to each project → MCP → Setup → "⚡ Add to Cursor". ' +
  'Each click adds a uniquely-named entry (mushi-{name}-{id}) to your global ~/.cursor/mcp.json ' +
  'so you can triage reports across all your apps from a single Cursor session.';

function multiProjectHintFor(count: number): string {
  return count <= 1
    ? MULTI_PROJECT_HINT_ONE
    : `You have access to ${count} projects. To connect any unconnected project, ` +
        'open the Mushi console → switch to that project → MCP → Setup → "⚡ Add to Cursor".';
}

export function buildManifestTools(deps: {
  // Mirrors the real `apiCall` in mcp/index.ts: `init.headers` is required so a
  // manifest tool can never accidentally issue an unauthenticated upstream call.
  apiCall: (
    path: string,
    init: RequestInit & { headers: Record<string, string> },
  ) => Promise<unknown>;
  requireString: (v: unknown, name: string) => void;
  McpError: new (code: number, message: string) => Error;
  ERR_INVALID_PARAMS: number;
}): Record<string, ToolDef> {
  const { apiCall, requireString, McpError, ERR_INVALID_PARAMS } = deps;
  const out: Record<string, ToolDef> = {};

  for (const [name, spec] of Object.entries(manifest as Record<string, ManifestToolDef>)) {
    // Title, description, annotations and the input and output schemas come
    // from the canonical stdio catalog (mcp-discovery-tools.json). Every
    // manifest tool used to advertise `{ type: 'object', properties: {} }`
    // while the handler below enforces spec.required, so a model had to learn
    // the parameters by failing; and a write tool with no explicit
    // destructiveHint defaults to destructive in clients, so refresh_ci looked
    // as dangerous as merge_fix. Every manifest tool is a catalog tool
    // (check-catalog-sync.mjs); the manifest's own description and hints are
    // only a fallback.
    const canonical = MCP_DISCOVERY.tools[name];
    const annotations: Record<string, unknown> = canonical?.annotations
      ? { ...canonical.annotations }
      : { readOnlyHint: spec.scope === 'mcp:read', openWorldHint: true };
    if (!canonical?.annotations) {
      if (spec.hints?.destructive !== undefined) annotations.destructiveHint = spec.hints.destructive;
      if (spec.hints?.idempotent !== undefined) annotations.idempotentHint = spec.hints.idempotent;
    }
    const properties = ((canonical?.inputSchema.properties ?? {}) as Record<string, { type?: unknown }>);

    out[name] = {
      scope: spec.scope,
      ...(canonical ? { title: canonical.title } : {}),
      description: canonical?.description ?? spec.description,
      inputSchema: canonical?.inputSchema ?? { type: 'object', properties: {} },
      ...(canonical?.outputSchema ? { outputSchema: canonical.outputSchema } : {}),
      annotations,
      handler: async (args, ctx) => {
        for (const req of spec.required ?? []) {
          // Strings must be non-empty; numbers, booleans and arrays (points,
          // stepIndex, filesChanged) only have to be present.
          if (properties[req]?.type === 'string') requireString(args[req], req);
          else if (args[req] === undefined || args[req] === null) {
            throw new McpError(ERR_INVALID_PARAMS, `${req} is required`);
          }
        }
        const pid = (args.projectId ?? ctx.projectIdHint) as string | undefined;

        if (spec.transform === 'fix_suggest') {
          const report = (await apiCall(interpolatePath(spec.path, args, ctx), {
            headers: ctx.authHeaders,
          })) as Record<string, unknown>;
          const s2 = report.stage2_analysis as Record<string, unknown> | null | undefined;
          return {
            reportId: args.reportId,
            rootCause: s2?.rootCause ?? null,
            suggestedFix: s2?.suggestedFix ?? null,
            reproductionSteps: report.reproduction_steps ?? [],
            summary: report.summary ?? null,
            component: report.component ?? null,
          };
        }

        if (spec.transform === 'diagnose_connection') {
          const ingest = (await apiCall('/v1/sync/ingest-setup', { headers: ctx.authHeaders })) as {
            ready?: boolean;
            steps?: Array<{ label: string; complete: boolean; required: boolean; hint: string }>;
          };
          return {
            ready: Boolean(ingest.ready),
            ingest,
            projectIdHint: ctx.projectIdHint ?? null,
            summary: ingest.ready
              ? 'Ingest setup complete.'
              : 'Ingest setup incomplete — see steps.',
          };
        }

        if (spec.transform === 'qa_run_pick') {
          if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required');
          const data = (await apiCall(interpolatePath(spec.path, args, ctx), {
            headers: ctx.authHeaders,
          })) as {
            data?: { runs?: Array<{ id: string }> };
          };
          const run = data?.data?.runs?.find((r) => r.id === args.runId) ?? null;
          if (!run) throw new McpError(ERR_INVALID_PARAMS, 'Run not found in recent runs');
          return run;
        }

        if (spec.transform === 'backend_health') {
          if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required');
          const [schema, advisors, logs] = await Promise.allSettled([
            apiCall(`/v1/admin/projects/${pid}/backend/schema`, { headers: ctx.authHeaders }),
            apiCall(`/v1/admin/projects/${pid}/db-advisors`, { headers: ctx.authHeaders }),
            args.includeLogs !== false
              ? apiCall(`/v1/admin/projects/${pid}/backend/logs?service=api`, {
                  headers: ctx.authHeaders,
                })
              : Promise.resolve(null),
          ]);
          return {
            schema: schema.status === 'fulfilled' ? schema.value : { error: String(schema.reason) },
            advisors:
              advisors.status === 'fulfilled' ? advisors.value : { error: String(advisors.reason) },
            logs: logs.status === 'fulfilled' ? logs.value : null,
          };
        }

        if (spec.transform === 'account_overview') {
          // The shape stdio's get_account_overview returns (its outputSchema).
          const data = (await apiCall(spec.path, { headers: ctx.authHeaders })) as {
            projects?: unknown[];
            total?: number;
            toolCount?: number;
            resourceCount?: number;
            promptCount?: number;
          };
          const projects = Array.isArray(data?.projects) ? data.projects : [];
          return {
            projects,
            total: data?.total ?? projects.length,
            active_project_id: ctx.projectIdHint ?? null,
            ...(typeof data?.toolCount === 'number' ? { toolCount: data.toolCount } : {}),
            ...(typeof data?.resourceCount === 'number' ? { resourceCount: data.resourceCount } : {}),
            ...(typeof data?.promptCount === 'number' ? { promptCount: data.promptCount } : {}),
            multi_project_hint: multiProjectHintFor(projects.length),
          };
        }

        if (spec.transform === 'submit_fix_result') {
          // Create the fix_attempt, then complete it with the branch/PR/files —
          // what stdio's submit_fix_result does. The hosted tool used to POST
          // the arguments to the create route, which records only reportId, so
          // branch, PR URL and file stats were silently dropped.
          const reportId = args.reportId as string;
          const idempotencyKey =
            typeof args.idempotencyKey === 'string' && args.idempotencyKey
              ? args.idempotencyKey
              : await stableUuidFrom(
                  SUBMIT_FIX_IDEMPOTENCY_NAMESPACE,
                  reportId,
                  String(args.branch),
                  typeof args.prUrl === 'string' ? args.prUrl : '',
                );
          const created = (await apiCall(spec.path, {
            method: 'POST',
            headers: { ...ctx.authHeaders, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({ reportId, agent: 'mcp' }),
          })) as { fixId?: string };
          if (!created?.fixId) throw new Error('The fix route did not return a fixId');
          try {
            await apiCall(`${spec.path}/${encodeURIComponent(created.fixId)}`, {
              method: 'PATCH',
              headers: ctx.authHeaders,
              body: JSON.stringify({
                status: 'completed',
                branch: args.branch,
                pr_url: args.prUrl,
                files_changed: args.filesChanged,
                lines_changed: args.linesChanged,
                summary: args.summary,
                completed_at: new Date().toISOString(),
              }),
            });
          } catch (err) {
            throw new Error(
              `Fix row ${created.fixId} was created for report ${reportId}, but marking it completed failed: ` +
                `${err instanceof Error ? err.message : String(err)} — the row exists in its initial state. ` +
                'Retry with identical arguments: the same derived Idempotency-Key is sent.',
            );
          }
          return { ok: true, fixId: created.fixId };
        }

        if (spec.transform === 'codebase_chat') {
          if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required');
          // The chat route takes a message list and an optional file focus.
          const body: Record<string, unknown> = { messages: [{ role: 'user', content: args.question }] };
          if (typeof args.threadId === 'string' && args.threadId) body.threadId = args.threadId;
          if (typeof args.filePath === 'string' && args.filePath) {
            body.fileFocus = { file_path: args.filePath, symbol_name: args.symbolName ?? null };
          }
          return apiCall(interpolatePath(spec.path, args, ctx), {
            method: 'POST',
            headers: ctx.authHeaders,
            body: JSON.stringify(body),
          });
        }

        const path = interpolatePath(spec.path, args, ctx);
        const init: RequestInit & { headers: Record<string, string> } = {
          headers: ctx.authHeaders,
        };
        if (spec.method !== 'GET') init.method = spec.method;
        const body = buildBody(spec, args, ctx);
        if (body) init.body = body;
        const data = await apiCall(path, init);
        if (spec.transform === 'skills_list') {
          // apiCall unwraps the envelope to the skill array — same shape as stdio.
          const skills = Array.isArray(data) ? data : [];
          return { skills, count: skills.length };
        }
        return spec.wrap ? { [spec.wrap]: data } : data;
      },
    };
  }

  return out;
}
