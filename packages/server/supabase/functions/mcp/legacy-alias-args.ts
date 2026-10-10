/**
 * FILE: packages/server/supabase/functions/mcp/legacy-alias-args.ts
 * PURPOSE: The arguments a deprecated tool alias implied. Three removed tools
 *          (setup_check, ingest_setup_check, diagnose_connection) now alias
 *          diagnose_setup, whose `mode` defaults to 'full'. Passing the
 *          caller's args through unchanged turned an ingest-only check into
 *          the full one, so an ingest caller could fail on dispatch
 *          preflight blockers it never asked about.
 *
 *          Pure (no Deno or network access) so the vitest suite can check it.
 */

/**
 * Defaults each alias restores. An explicit argument from the caller wins.
 * diagnose_connection is absent on purpose: it reported health, ingest and
 * dispatch together, which is what 'full' does.
 */
const LEGACY_ALIAS_DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  // Ran the dispatch-readiness checks (repo, index, BYOK key, autofix).
  setup_check: { mode: 'dispatch' },
  // Ran the required ingest checks (key, heartbeat, first report).
  ingest_setup_check: { mode: 'ingest' },
}

/** The args to hand the successor when `aliasName` is called with `args`. */
export function legacyAliasArgs(aliasName: string, args: Record<string, unknown>): Record<string, unknown> {
  const defaults = Object.prototype.hasOwnProperty.call(LEGACY_ALIAS_DEFAULT_ARGS, aliasName)
    ? LEGACY_ALIAS_DEFAULT_ARGS[aliasName]
    : undefined
  if (!defaults) return args
  const merged: Record<string, unknown> = { ...args }
  for (const [key, value] of Object.entries(defaults)) {
    if (merged[key] === undefined) merged[key] = value
  }
  return merged
}
