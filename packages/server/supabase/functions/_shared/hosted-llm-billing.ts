/**
 * FILE: packages/server/supabase/functions/_shared/hosted-llm-billing.ts
 * PURPOSE: Meter the HOSTED LLM tier against the central KENSAURUS wallet.
 *
 * WHAT GETS CHARGED
 *   Only calls that ran on a platform-owned provider key — `ResolvedKey.source
 *   === 'env'` (see _shared/byok.ts step 3). A project with its own key in the
 *   BYOK pool pays its provider directly and is NEVER billed here.
 *
 * WHERE IT IS WIRED
 *   - Debit:     _shared/telemetry.ts → logLlmInvocation() (has projectId,
 *                usedModel, keySource, token counts, langfuse trace id).
 *   - Preflight: _shared/llm-failover.ts → withLlmFailover() (runs before any
 *                provider money is spent, and knows the key source).
 *
 * FLAG (env `MUSHI_HOSTED_LLM_BILLING`)
 *   off    — default. Zero bridge calls; behaviour identical to before.
 *   shadow — price + record $0 ledger rows, never blocks.
 *   on     — preflight fails closed on an insufficient balance.
 *   Any value is forced to `off` when the wallet bridge env is absent, which
 *   is what keeps self-hosted installs unbilled.
 *
 * IDENTITY
 *   The wallet federates by verified email. mushi resolves
 *   projects.owner_id → auth.users.email and passes
 *   (external_project='mushi', external_user_id=<owner_id>, email). An owner
 *   with no email cannot be billed: the call proceeds unmetered and is logged.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getServiceClient } from './db.ts';
import { log as rootLog } from './logger.ts';
import {
  computeProviderCostMicro,
  getModelPrice,
  makeRemoteBackend,
  WalletDeniedError,
  type Usage,
  type WalletBackend,
} from './kensaurus-wallet.ts';

const log = rootLog.child('hosted-llm-billing');

/** Namespace kenji keys the identity link on. Must not change once live. */
const EXTERNAL_PROJECT = 'mushi';
const APP = 'mushi';

export { WalletDeniedError };

export type HostedLlmBillingMode = 'off' | 'shadow' | 'on';

function walletUrl(): string {
  return Deno.env.get('KENSAURUS_WALLET_URL') ?? '';
}

function walletToken(): string {
  return Deno.env.get('KENSAURUS_WALLET_INTERNAL_TOKEN') ?? '';
}

let misconfigWarned = false;

/**
 * Effective billing mode. Falls back to `off` — not just when the flag is
 * unset, but whenever the bridge credentials are missing, so a self-hosted
 * deployment that copies a production env file still cannot be charged.
 */
export function hostedLlmBillingMode(): HostedLlmBillingMode {
  const raw = (Deno.env.get('MUSHI_HOSTED_LLM_BILLING') ?? 'off').trim().toLowerCase();
  if (raw !== 'shadow' && raw !== 'on') return 'off';

  if (!walletUrl() || !walletToken()) {
    if (!misconfigWarned) {
      misconfigWarned = true;
      log.warn('MUSHI_HOSTED_LLM_BILLING is set but the wallet bridge is not configured', {
        mode: raw,
        hint: 'Set KENSAURUS_WALLET_URL and KENSAURUS_WALLET_INTERNAL_TOKEN, or unset the flag.',
      });
    }
    return 'off';
  }
  return raw;
}

/** Cheap guard for call sites that want to skip work entirely when disabled. */
export function hostedLlmBillingEnabled(): boolean {
  return hostedLlmBillingMode() !== 'off';
}

// ---- identity ---------------------------------------------------------------

export interface OwnerIdentity {
  userId: string;
  email: string;
}

/** `null` = resolved but unbillable (no owner, or owner without an email). */
const identityCache = new Map<string, { identity: OwnerIdentity | null; at: number }>();
const IDENTITY_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the wallet identity for a project: `projects.owner_id` and that
 * user's verified email from mushi's own `auth.users`.
 *
 * Reads through the service client regardless of the caller's `db`, because
 * `auth.admin.getUserById` needs the service role and API routes hand us a
 * user-scoped client. A transient failure is not cached.
 */
export async function resolveOwnerIdentity(
  db: SupabaseClient,
  projectId: string,
): Promise<OwnerIdentity | null> {
  const hit = identityCache.get(projectId);
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.identity;

  let identity: OwnerIdentity | null = null;
  try {
    const admin = getServiceClient();
    const { data: row, error } = await admin
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const ownerId = (row as { owner_id?: string | null } | null)?.owner_id ?? null;
    if (ownerId) {
      const { data } = await admin.auth.admin.getUserById(ownerId);
      const email = data?.user?.email ?? '';
      if (email) {
        identity = { userId: ownerId, email };
      } else {
        log.warn('Project owner has no email — hosted LLM call cannot be billed', {
          projectId,
          ownerId,
        });
      }
    } else {
      log.warn('Project has no owner_id — hosted LLM call cannot be billed', { projectId });
    }
  } catch (err) {
    log.warn('Owner identity lookup failed; skipping metering for this call', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  identityCache.set(projectId, { identity, at: Date.now() });
  return identity;
}

/** Test hook — drops the memoized identities and plan ids. */
export function resetHostedLlmBillingCaches(): void {
  identityCache.clear();
  planCache.clear();
  misconfigWarned = false;
}

// ---- plan attribution -------------------------------------------------------

const planCache = new Map<string, { planId: string | null; at: number }>();
const PLAN_TTL_MS = 60_000;

/**
 * Which pricing plan the project is on, for revenue attribution in the ledger
 * metadata. Mirrors quota.ts's resolution order (subscription first, then the
 * owning organization) without importing the quota gate — this is metadata,
 * never a decision, so a miss is recorded as `null` rather than retried.
 */
async function resolvePlanId(projectId: string): Promise<string | null> {
  const hit = planCache.get(projectId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.planId;

  let planId: string | null = null;
  try {
    const admin = getServiceClient();
    const { data: sub } = await admin
      .from('billing_subscriptions')
      .select('status, plan_id')
      .eq('project_id', projectId)
      .maybeSingle();
    const subRow = sub as { status?: string | null; plan_id?: string | null } | null;
    if (subRow?.plan_id && (subRow.status === 'active' || subRow.status === 'trialing')) {
      planId = subRow.plan_id;
    } else {
      const { data: project } = await admin
        .from('projects')
        .select('organization_id, organizations(plan_id)')
        .eq('id', projectId)
        .maybeSingle();
      planId =
        (project as { organizations?: { plan_id?: string | null } | null } | null)?.organizations
          ?.plan_id ?? null;
    }
  } catch (err) {
    log.warn('Plan attribution lookup failed (non-fatal)', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  planCache.set(projectId, { planId, at: Date.now() });
  return planId;
}

// ---- backend ----------------------------------------------------------------

/**
 * Remote wallet backend for one project owner. mushi lives on a different
 * Supabase project than the wallet, so every call goes over the
 * `kensaurus-wallet-api` bridge with the shared internal token.
 */
export function makeMushiWalletBackend(identity: OwnerIdentity): WalletBackend {
  return makeRemoteBackend({
    url: walletUrl(),
    internalToken: walletToken(),
    externalProject: EXTERNAL_PROJECT,
    externalUserId: identity.userId,
    email: identity.email,
  });
}

// ---- preflight --------------------------------------------------------------

export interface HostedLlmPreflightResult {
  allowed: boolean;
  reason?: string;
  balanceMicro: number | null;
}

/**
 * Total wall-clock budget for the preflight. Stage 1 / Stage 2 classification
 * runs per event on the hot path and the wallet is a cross-project HTTPS call,
 * so a slow or dead bridge must not add latency to customers' triage.
 */
const PREFLIGHT_BUDGET_MS = (() => {
  const raw = Deno.env.get('MUSHI_HOSTED_LLM_PREFLIGHT_TIMEOUT_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 800;
})();

function allowPreflight(reason?: string): HostedLlmPreflightResult {
  return { allowed: true, reason, balanceMicro: null };
}

/**
 * Balance check before a hosted-key provider call. **Fails OPEN.**
 *
 * Only an explicit, successful `allowed: false` from the wallet refuses the
 * call. A bridge error, a non-200, a timeout, or an unbillable project all let
 * the call proceed unbilled, and log. A wallet outage must never stop error
 * triage — deliberately the opposite of the canonical `meteredCall`, which
 * fails closed for interactive consumer features.
 *
 * Bounded twice: `AbortSignal.timeout` genuinely cancels the request, and an
 * outer race caps the whole operation — including identity resolution — at
 * PREFLIGHT_BUDGET_MS.
 */
export async function hostedLlmPreflight(args: {
  db: SupabaseClient;
  projectId: string;
  estimateMicro?: number;
}): Promise<HostedLlmPreflightResult> {
  if (hostedLlmBillingMode() !== 'on') return allowPreflight();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<HostedLlmPreflightResult>((resolve) => {
    timer = setTimeout(() => {
      log.warn('Hosted LLM preflight exceeded its budget — proceeding unbilled (fail-open)', {
        projectId: args.projectId,
        budgetMs: PREFLIGHT_BUDGET_MS,
      });
      resolve(allowPreflight('preflight-timeout'));
    }, PREFLIGHT_BUDGET_MS);
  });

  try {
    return await Promise.race([runPreflight(args), budget]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runPreflight(args: {
  db: SupabaseClient;
  projectId: string;
  estimateMicro?: number;
}): Promise<HostedLlmPreflightResult> {
  const startedAt = Date.now();

  const identity = await resolveOwnerIdentity(args.db, args.projectId);
  if (!identity) return allowPreflight('unbillable-project');

  const remainingMs = PREFLIGHT_BUDGET_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) return allowPreflight('preflight-timeout');

  // Deliberately not `makeMushiWalletBackend(...).check()`: the canonical
  // helper is a verbatim SYNC copy with no timeout hook, and the hot path
  // needs a hard latency bound. Same wire contract, still one round trip.
  try {
    const resp = await fetch(walletUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kensaurus-internal-token': walletToken(),
      },
      body: JSON.stringify({
        external_project: EXTERNAL_PROJECT,
        external_user_id: identity.userId,
        email: identity.email,
        action: 'check',
        estimated_micro: args.estimateMicro ?? 10_000,
      }),
      signal: AbortSignal.timeout(remainingMs),
    });

    if (!resp.ok) {
      log.warn('Hosted LLM preflight got a non-200 from the wallet — proceeding unbilled', {
        projectId: args.projectId,
        status: resp.status,
      });
      return allowPreflight('bridge-error');
    }

    const body = (await resp.json()) as {
      allowed?: boolean;
      reason?: string;
      balance_micro?: number;
    };

    // Only an explicit refusal blocks. A malformed body is a bridge problem,
    // not a customer problem.
    if (body.allowed === false) {
      return {
        allowed: false,
        reason: body.reason ?? 'insufficient',
        balanceMicro: body.balance_micro ?? null,
      };
    }
    return { allowed: true, balanceMicro: body.balance_micro ?? null };
  } catch (err) {
    log.warn('Hosted LLM preflight failed — proceeding unbilled (fail-open)', {
      projectId: args.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return allowPreflight('bridge-error');
  }
}

// ---- debit ------------------------------------------------------------------

export interface ChargeHostedLlmArgs {
  db: SupabaseClient;
  projectId: string;
  /** Ledger feature slug — the function/stage that spent the money. */
  feature: string;
  provider: string;
  model: string;
  usage: Usage;
  /** Langfuse trace id, so a ledger row joins back to its generation. */
  traceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Debit the owner's wallet for one hosted-key provider call.
 *
 * NEVER throws into the caller. The provider call already succeeded and the
 * user already has their answer; a lost debit is a revenue problem, not a
 * triage outage. One retry on the same `request_id` (the debit RPC dedupes on
 * it, so a retry cannot double-charge), then a loud console.error.
 *
 * Deliberately does not use `meteredCall`: that refuses unpriced models by
 * throwing, which would take triage dark the moment mushi ships a model kenji
 * has no `kensaurus_model_prices` row for. Here an unpriced model logs loudly
 * and skips the debit.
 */
export async function chargeHostedLlm(args: ChargeHostedLlmArgs): Promise<void> {
  const mode = hostedLlmBillingMode();
  if (mode === 'off') return;

  const shadow = mode === 'shadow';

  try {
    const identity = await resolveOwnerIdentity(args.db, args.projectId);
    if (!identity) return;

    const backend = makeMushiWalletBackend(identity);
    const price = await getModelPrice(backend, args.provider, args.model);
    if (!price) {
      // Named loudly: an unpriced model is hosted spend nobody is paying for.
      log.error('No wallet price for hosted model — call not charged', {
        projectId: args.projectId,
        provider: args.provider,
        model: args.model,
        feature: args.feature,
      });
      return;
    }

    const providerCostMicro = computeProviderCostMicro(price, args.usage);
    const requestId = crypto.randomUUID();
    const planId = await resolvePlanId(args.projectId);

    const debitArgs = {
      app: APP,
      feature: args.feature,
      model: args.model,
      providerCostMicro: shadow ? 0 : providerCostMicro,
      markupBps: shadow ? 0 : undefined,
      requestId,
      traceId: args.traceId ?? undefined,
      metadata: {
        ...(args.metadata ?? {}),
        usage: args.usage,
        provider: args.provider,
        mushi_project_id: args.projectId,
        mushi_owner_id: identity.userId,
        // Revenue attribution per tier. Plan rows are untouched by this
        // feature — hosted LLM is billed from the wallet, not the plan.
        mushi_plan_id: planId,
        ...(shadow ? { shadow: true, shadow_provider_cost_micro: providerCostMicro } : {}),
      },
    };

    try {
      await backend.debit(debitArgs);
    } catch (err) {
      try {
        await backend.debit({
          ...debitArgs,
          metadata: { ...debitArgs.metadata, retry: true },
        });
      } catch {
        console.error('[hosted-llm-billing] debit lost after retry:', (err as Error).message, {
          projectId: args.projectId,
          feature: args.feature,
          model: args.model,
          requestId,
          providerCostMicro,
        });
      }
    }
  } catch (err) {
    console.error('[hosted-llm-billing] metering failed:', (err as Error).message, {
      projectId: args.projectId,
      feature: args.feature,
    });
  }
}

/**
 * Fire-and-forget wrapper. Most LLM call sites invoke telemetry as
 * `void logLlmInvocation(...)`, so the debit has to be pinned to the isolate's
 * `waitUntil` or it dies at teardown with the request.
 */
export function scheduleHostedLlmCharge(args: ChargeHostedLlmArgs): void {
  if (hostedLlmBillingMode() === 'off') return;
  const work = chargeHostedLlm(args).catch((err: unknown) => {
    console.error(
      '[hosted-llm-billing] scheduled charge threw:',
      err instanceof Error ? err.message : String(err),
    );
  });
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else void work;
}

/** Map a model id to the provider slug kenji prices it under. */
export function providerFromModel(model: string | null | undefined): string {
  const id = (model ?? '').toLowerCase();
  const bare = id.includes('/') ? id.split('/').slice(-1)[0] : id;
  if (bare.startsWith('claude-')) return 'anthropic';
  if (bare.startsWith('gpt-') || bare.startsWith('o1') || bare.startsWith('text-embedding-')) {
    return 'openai';
  }
  return 'unknown';
}
