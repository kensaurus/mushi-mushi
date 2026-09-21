/**
 * FILE: scripts/lib/mcp-configs.mjs
 * PURPOSE: Lint the MCP client configs and plugin manifests this repo ships,
 *          shared by scripts/check-cursor-plugin.mjs (runs in CI) and
 *          scripts/check-mcp-publish-readiness.mjs. Pure except for
 *          `listTrackedJsonFiles` / `isTrackedFile`, which ask git.
 *
 * Why this exists: plugins/mushi-debugger/.mcp.json shipped an entry with a
 * `url` and no `type`. Claude Code reads an entry with no `type` as stdio, so
 * it skipped the server: the plugin installed "successfully" and then showed
 * no MCP server at all. `claude plugin validate` passes that file, so nothing
 * caught it. The same audit found the Cursor bundle pointing at a
 * `your-project` host that does not resolve, and the MCP registry icon
 * returning 404 because `*.png` is git-ignored. Each check below is one of
 * those failures turned into a rule.
 */

import { execFileSync } from 'node:child_process'

/**
 * Transports a remote entry may declare. Claude Code accepts `http`, `sse`,
 * `ws` and `streamable-http` (an alias for `http`); Cursor and VS Code accept
 * the same names for remote servers.
 */
export const REMOTE_TRANSPORT_TYPES = new Set(['http', 'streamable-http', 'sse', 'ws'])

/**
 * Top-level fields documented for `.cursor-plugin/plugin.json`
 * (https://cursor.com/docs/reference/plugins). `displayName` is not in that
 * table but is used by Cursor's own plugin template (cursor/plugin-template),
 * so it is accepted. Anything else — `icon`, `categories`, `minCursorVersion`,
 * `mcp` — is silently ignored by Cursor and fails review.
 */
export const CURSOR_PLUGIN_MANIFEST_FIELDS = new Set([
  'name',
  'displayName',
  'description',
  'version',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'logo',
  'rules',
  'agents',
  'skills',
  'commands',
  'hooks',
  'mcpServers',
  'variables',
])

/**
 * `${…}` names Cursor expands itself. Every other `${NAME}` in a plugin's
 * mcp.json must be declared under the manifest's `variables` schema, or the
 * user has no way to set it (Cursor's submission checklist rule).
 */
const CURSOR_BUILTIN_VARIABLES = new Set([
  'CURSOR_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_ROOT',
  'userHome',
  'workspaceFolder',
  'workspaceFolderBasename',
  'pathSeparator',
])

/** Host labels that only ever appear in copy-paste templates. */
const PLACEHOLDER_HOST_RE = /(^|[.-])(your|example|placeholder|changeme)([.-]|$)|<|>/i

/**
 * Every `mcpServers` object in a parsed JSON document, at any depth. A string
 * value (a path, as in a plugin.json `"mcpServers": "./.mcp.json"`) is not an
 * entry list and is skipped; the file it names is linted on its own.
 *
 * @param {unknown} doc
 * @returns {Array<{ name: string, entry: unknown }>}
 */
export function collectMcpServerEntries(doc) {
  const out = []
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const servers = node.mcpServers
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
      for (const [name, entry] of Object.entries(servers)) out.push({ name, entry })
    }
    for (const value of Object.values(node)) {
      if (value !== servers) visit(value)
    }
  }
  visit(doc)
  return out
}

/**
 * Returns the reason `url` is a template placeholder rather than a real
 * endpoint, or null. URLs built from `${VAR}` are left alone — they are
 * resolved at install time, not committed values.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function placeholderUrlReason(url) {
  if (url.includes('${')) return null
  let host
  try {
    host = new URL(url).hostname
  } catch {
    return `"${url}" is not a valid absolute URL`
  }
  if (PLACEHOLDER_HOST_RE.test(host)) return `"${url}" uses the placeholder host "${host}"`
  return null
}

/**
 * Problems with the MCP server entries in one committed config file.
 *
 * @param {unknown} doc parsed JSON
 * @param {{ allowPlaceholderHosts?: boolean }} [options] `.example` files are
 *   templates and may carry placeholder hosts; shipped configs may not.
 * @returns {string[]}
 */
export function lintMcpConfig(doc, { allowPlaceholderHosts = false } = {}) {
  const problems = []
  for (const { name, entry } of collectMcpServerEntries(doc)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`server "${name}" is not an object`)
      continue
    }
    if (!('url' in entry)) continue
    const { url, type } = entry
    if (typeof url !== 'string' || url.length === 0) {
      problems.push(`server "${name}" has an empty or non-string "url"`)
      continue
    }
    if (type === undefined) {
      problems.push(
        `server "${name}" has a "url" but no "type" — Claude Code reads it as stdio and skips it; add "type": "http"`,
      )
    } else if (!REMOTE_TRANSPORT_TYPES.has(type)) {
      problems.push(
        `server "${name}" has "type": ${JSON.stringify(type)}; a url entry needs one of ${[...REMOTE_TRANSPORT_TYPES].join(', ')}`,
      )
    }
    if (!allowPlaceholderHosts) {
      const reason = placeholderUrlReason(url)
      if (reason) problems.push(`server "${name}": ${reason}`)
    }
  }
  return problems
}

/**
 * Names referenced as `${NAME}` or `${NAME:-default}` anywhere in the string
 * values of a parsed JSON document, minus the ones Cursor expands itself and
 * `${env:NAME}` lookups (those read the user's environment directly).
 *
 * @param {unknown} doc
 * @returns {Set<string>}
 */
export function collectVariableReferences(doc) {
  const names = new Set()
  const visit = (node) => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/\$\{([^}]+)\}/g)) {
        const raw = match[1]
        if (raw.startsWith('env:')) continue
        const name = raw.split(':-')[0].trim()
        if (name && !CURSOR_BUILTIN_VARIABLES.has(name)) names.add(name)
      }
    } else if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node)) visit(value)
    }
  }
  visit(doc)
  return names
}

/**
 * Problems with a `.cursor-plugin/plugin.json` manifest's own fields, and with
 * the `${VAR}` placeholders its mcp.json uses.
 *
 * @param {Record<string, unknown>} manifest
 * @param {unknown} mcpConfig parsed mcp.json, or null when it could not be read
 * @returns {string[]}
 */
export function lintCursorManifest(manifest, mcpConfig) {
  const problems = []
  for (const field of Object.keys(manifest)) {
    if (!CURSOR_PLUGIN_MANIFEST_FIELDS.has(field)) {
      problems.push(`plugin.json field "${field}" is not in Cursor's manifest reference`)
    }
  }
  if (typeof manifest.name !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.name)) {
    problems.push(`plugin.json "name" must be lowercase kebab-case, got ${JSON.stringify(manifest.name)}`)
  }
  if (mcpConfig) {
    const declared = new Set(Object.keys(manifest.variables?.properties ?? {}))
    for (const name of collectVariableReferences(mcpConfig)) {
      if (!declared.has(name)) {
        problems.push(`mcp.json uses \${${name}} but plugin.json "variables" does not declare it`)
      }
    }
  }
  return problems
}

/**
 * Maps a raw.githubusercontent.com URL for this repo to the repo-relative path
 * it serves, or null for any other URL.
 *
 * @param {string} url
 * @param {string} [repo] owner/name
 * @returns {{ ref: string, path: string } | null}
 */
export function repoPathFromRawUrl(url, repo = 'kensaurus/mushi-mushi') {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname !== 'raw.githubusercontent.com') return null
  const prefix = `/${repo}/`
  if (!parsed.pathname.startsWith(prefix)) return null
  const [ref, ...rest] = parsed.pathname.slice(prefix.length).split('/')
  if (!ref || rest.length === 0) return null
  return { ref, path: decodeURIComponent(rest.join('/')) }
}

/**
 * Tracked `*.json` / `*.json.example` files that mention `mcpServers`. Asking
 * git (not walking the disk) means a new committed config is linted without
 * anyone adding it to a list, and ignored local configs never are.
 *
 * @param {string} root repo root
 * @returns {string[]} repo-relative POSIX paths
 */
export function listTrackedJsonFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.json', '*.json.example'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

/**
 * @param {string} root repo root
 * @param {string} relPath repo-relative path
 * @returns {boolean} true when git tracks the file (so a raw URL can serve it)
 */
export function isTrackedFile(root, relPath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
