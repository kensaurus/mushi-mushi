/**
 * FILE: arg-aliases.ts
 * PURPOSE: One tool-argument spelling rule for both MCP transports. Parameter
 *          names are camelCase (projectId, reportId, includeRaw); the
 *          snake_case spelling of any declared camelCase parameter
 *          (project_id, report_id, include_raw) is accepted as an alias, so
 *          configs and prompts written against the old mixed-case schemas
 *          keep working.
 *
 *          The stdio server runs this before zod validates the arguments
 *          (packages/mcp/src/server.ts); the hosted server runs it before a
 *          handler reads them (functions/mcp/index.ts). The two files are
 *          byte-identical — check-catalog-sync.mjs fails if they drift.
 */

/** `projectId` → `project_id`; a name with no capitals maps to itself. */
export function snakeAliasOf(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/**
 * Rewrite snake_case aliases of the declared camelCase parameters to their
 * canonical names. When a caller sends both spellings the camelCase value
 * wins and the alias is dropped. Keys that are not an alias of a declared
 * parameter pass through untouched, so the schema still decides whether
 * they are allowed. Returns a new object; `args` is not modified.
 */
export function normalizeArgAliases(
  args: Readonly<Record<string, unknown>>,
  declared: Iterable<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  for (const name of declared) {
    const alias = snakeAliasOf(name)
    if (alias === name || !Object.prototype.hasOwnProperty.call(out, alias)) continue
    if (out[name] === undefined) out[name] = out[alias]
    delete out[alias]
  }
  return out
}
