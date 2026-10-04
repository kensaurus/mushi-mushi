/**
 * FILE: packages/server/supabase/functions/_shared/sentry-dsn.ts
 * PURPOSE: One parser for a user-supplied Sentry DSN. A DSN names the host
 *          Mushi later POSTs events to (tester-marketplace forward), so an
 *          unchecked value is a server-side request to a host the user picks.
 *
 *          Accepted: https only, a public key, a numeric project id, and a
 *          host that is sentry.io or one of its subdomains
 *          (`o123.ingest.us.sentry.io`), or a host the operator lists in
 *          MUSHI_SENTRY_SELF_HOSTED_HOSTS (comma separated). IP literals,
 *          localhost and internal names are refused even when listed.
 *
 *          No imports and no module-level env reads, so vitest and Deno
 *          (without --allow-env) can both load it.
 */

export interface SentryDsn {
  publicKey: string;
  /** Lowercase host, with `:port` when the DSN carries a non-default one. */
  host: string;
  projectId: string;
  /** Path prefix before the project id ('' for SaaS). */
  pathPrefix: string;
}

const SHAPE = 'https://<key>@o<org>.ingest.sentry.io/<project id>';

function fail(reason: string): { ok: false; message: string } {
  return { ok: false, message: `${reason} A Sentry DSN looks like ${SHAPE}.` };
}

function isSentryHost(host: string): boolean {
  return host === 'sentry.io' || host.endsWith('.sentry.io');
}

/** IPv4 / IPv6 literals and names that only resolve inside a network. */
function isInternalOrLiteralHost(host: string): boolean {
  if (host.startsWith('[') || host.includes(':')) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 literal (URL normalizes 0x7f.1 etc.)
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!host.includes('.')) return true; // single-label intranet name
  return /\.(local|internal|lan|home|corp|intranet)$/.test(host);
}

/**
 * Parse and validate a DSN. `selfHostedHosts` are exact hostnames the
 * operator trusts in addition to sentry.io.
 */
export function parseSentryDsn(
  raw: string,
  selfHostedHosts: readonly string[] = [],
): { ok: true; value: SentryDsn } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail('That is not a valid URL.');
  }
  if (url.protocol !== 'https:') return fail('The DSN must start with https://.');
  if (!url.username) return fail('The DSN is missing its key (the part before "@").');
  if (url.search || url.hash) return fail('The DSN must not contain "?" or "#".');

  const hostname = url.hostname.toLowerCase();
  if (isInternalOrLiteralHost(hostname)) {
    return fail('The DSN host must be a public Sentry host, not an IP address or internal name.');
  }
  const trusted = selfHostedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const selfHosted = trusted.includes(hostname);
  if (!isSentryHost(hostname) && !selfHosted) {
    return fail(
      'The DSN host must be sentry.io (self-hosted Sentry needs the operator to allow its host).',
    );
  }
  if (url.port && url.port !== '443' && !selfHosted) {
    return fail('The DSN must use the default HTTPS port.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop() ?? '';
  if (!/^\d+$/.test(projectId)) return fail('The DSN must end with a numeric project id.');

  return {
    ok: true,
    value: {
      publicKey: decodeURIComponent(url.username),
      host: url.port && url.port !== '443' ? `${hostname}:${url.port}` : hostname,
      projectId,
      pathPrefix: segments.length ? `/${segments.join('/')}` : '',
    },
  };
}

declare const Deno: { env: { get(name: string): string | undefined } };

/** Operator allowlist for self-hosted Sentry, read at call time. */
export function sentrySelfHostedHosts(): string[] {
  if (typeof Deno === 'undefined') return [];
  return (Deno.env.get('MUSHI_SENTRY_SELF_HOSTED_HOSTS') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Validate a stored `sentry_dsn` setting. `null`, `''` and whitespace clear
 * it; anything else must parse. The trimmed original is stored.
 */
export function parseSentryDsnSetting(
  value: unknown,
  selfHostedHosts: readonly string[] = [],
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: 'sentry_dsn must be a string or null.' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = parseSentryDsn(trimmed, selfHostedHosts);
  return parsed.ok ? { ok: true, value: trimmed } : parsed;
}
