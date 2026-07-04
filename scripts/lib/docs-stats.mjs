/**
 * scripts/lib/docs-stats.mjs — canonical documentation statistics for mushi-mushi.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const INBOUND_ADAPTERS = [
  "sentry",
  "datadog",
  "bugsnag",
  "rollbar",
  "crashlytics",
  "new-relic",
  "honeycomb",
  "grafana-loki",
  "cloudwatch",
  "opsgenie",
  "firebase-analytics",
]

const OUTBOUND_PLUGINS = [
  "plugin-sentry",
  "plugin-slack-app",
  "plugin-jira",
  "plugin-linear",
  "plugin-pagerduty",
  "plugin-discord",
  "plugin-msteams",
  "plugin-github-issues",
  "plugin-bugsnag",
  "plugin-rollbar",
  "plugin-crashlytics",
  "plugin-zapier",
  "plugin-cursor-cloud",
]

function walkFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full, { throwIfNoEntry: false })
    if (!st) continue // broken symlink / racing delete — skip, don't abort the scan
    if (st.isDirectory()) {
      if (["node_modules", "dist", ".turbo", "build"].includes(entry)) continue
      if (entry.startsWith(".")) continue
      walkFiles(full, predicate, acc)
    } else if (predicate(full, entry)) {
      acc.push(full)
    }
  }
  return acc
}

function countLines(files) {
  let total = 0
  for (const file of files) {
    total += readFileSync(file, "utf8").split(/\r?\n/).length
  }
  return total
}

function countTopLevelDirs(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((name) =>
    statSync(path.join(dir, name)).isDirectory()
  ).length
}

function countSqlMigrations(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).length
}

function countEdgeFunctions(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((name) => {
    if (name.startsWith("_")) return false
    return statSync(path.join(dir, name)).isDirectory()
  }).length
}

function countPublishableNpm(packagesDir) {
  if (!existsSync(packagesDir)) return 0
  let n = 0
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = path.join(packagesDir, name, "package.json")
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    if (String(pkg.name ?? "").startsWith("@mushi-mushi/")) n++
  }
  return n
}

function countAgentsInAgentsMd(agentsPath) {
  if (!existsSync(agentsPath)) return 0
  const source = readFileSync(agentsPath, "utf8")
  const table = source.match(/\| Agent \| Location[\s\S]*?(?:\n\n|\n---)/)?.[0] ?? ""
  return (table.match(/^\| `[^`]+`/gm) ?? []).length
}

function countOutboundPlugins(packagesDir) {
  if (!existsSync(packagesDir)) return 0
  return OUTBOUND_PLUGINS.filter((name) =>
    existsSync(path.join(packagesDir, name, "package.json"))
  ).length
}

function countInboundAdapters(adaptersDir) {
  if (!existsSync(adaptersDir)) return 0
  return readdirSync(adaptersDir).filter(
    (name) =>
      name.endsWith(".ts") &&
      name !== "index.ts" &&
      name !== "types.ts" &&
      !name.includes(".test.")
  ).length
}

export function deriveDocsStats(root = process.cwd()) {
  const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const packagesDir = path.join(root, "packages")
  const tsFiles = []
  for (const base of ["packages", "apps", "examples"]) {
    walkFiles(
      path.join(root, base),
      (_, name) =>
        (name.endsWith(".ts") || name.endsWith(".tsx")) &&
        !name.includes(".test.") &&
        !name.includes(".spec.")
    ).forEach((f) => tsFiles.push(f))
  }

  const migrationsDir = path.join(
    root,
    "packages/server/supabase/migrations"
  )
  const helmMigrationsDir = path.join(root, "deploy/helm/migrations")
  const edgeDir = path.join(root, "packages/server/supabase/functions")

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    versions: {
      monorepo: rootPkg.version ?? "private",
      packageManager: rootPkg.packageManager ?? "pnpm",
    },
    monorepo: {
      tsLines: countLines(tsFiles),
      tsFiles: tsFiles.length,
      workspacePackages: countTopLevelDirs(packagesDir),
      publishableNpm: countPublishableNpm(packagesDir),
      apps: countTopLevelDirs(path.join(root, "apps")),
    },
    server: {
      edgeFunctions: countEdgeFunctions(edgeDir),
      sqlMigrations: countSqlMigrations(migrationsDir),
      helmMigrations: countSqlMigrations(helmMigrationsDir),
      pipelineAgents: countAgentsInAgentsMd(path.join(root, "AGENTS.md")),
    },
    integrations: {
      inboundAdapters: countInboundAdapters(
        path.join(packagesDir, "adapters/src")
      ),
      outboundPlugins: countOutboundPlugins(packagesDir),
    },
  }
}

export function formatCompact(n) {
  if (n >= 1_000_000) return `~${Math.round(n / 100_000) / 10}M`
  if (n >= 10_000) return `~${Math.round(n / 1_000)}K`
  if (n >= 1_000) return n.toLocaleString("en-US")
  return String(n)
}

export function buildReadmeClaimChecks(stats) {
  const checks = []
  const add = (file, pattern, expected, label) =>
    checks.push({ file, pattern, expected, label })

  add(
    "README.md",
    /inbound adapters for \*\*(\d+) monitoring sources\*\*/g,
    stats.integrations.inboundAdapters,
    "README inbound adapters"
  )
  add(
    "README.md",
    /(\d+) outbound plugins\*\*/g,
    stats.integrations.outboundPlugins,
    "README outbound plugins (intro)"
  )
  add(
    "README.md",
    /(\d+) outbound plugins covering/g,
    stats.integrations.outboundPlugins,
    "README outbound plugins (integration section)"
  )
  add(
    "README.md",
    /`plugin-\*` \((\d+) plugins\)/g,
    stats.integrations.outboundPlugins,
    "README license table plugin count"
  )
  add(
    "README.md",
    /applies all (\d+) SQL migrations/g,
    stats.server.sqlMigrations,
    "README helm migration count"
  )
  add(
    "README.md",
    /\*\*(\d+)\*\*\s*<br\/>\s*<sub>SQL Migrations<\/sub>/g,
    stats.server.sqlMigrations,
    "README at-a-glance migrations"
  )
  add(
    "README.md",
    /\*\*(\d+)\*\*\s*<br\/>\s*<sub>Edge Functions<\/sub>/g,
    stats.server.edgeFunctions,
    "README at-a-glance edge functions"
  )
  add(
    "README.md",
    /\*\*(\d+)\*\*\s*<br\/>\s*<sub>Pipeline Agents<\/sub>/g,
    stats.server.pipelineAgents,
    "README at-a-glance agents"
  )
  add(
    "README.md",
    /\*\*(\d+)\*\*\s*<br\/>\s*<sub>NPM Packages<\/sub>/g,
    stats.monorepo.publishableNpm,
    "README at-a-glance npm packages"
  )
  add(
    "README.md",
    /\*\*(\d+)\*\*\s*<br\/>\s*<sub>Workspace Packages<\/sub>/g,
    stats.monorepo.workspacePackages,
    "README at-a-glance workspace packages"
  )
  add(
    "deploy/helm/README.md",
    /(\d+) files\b/g,
    stats.server.helmMigrations,
    "Helm README migration file count"
  )
  add(
    "packages/launcher/README.md",
    /\*\*(\d+) outbound plugins\*\*/g,
    stats.integrations.outboundPlugins,
    "Launcher README outbound plugins"
  )
  add(
    "packages/adapters/README.md",
    /## Supported sources[\s\S]*?\| Grafana/g,
    stats.integrations.inboundAdapters,
    "Adapters README source count"
  )

  return checks
}

function scanAgentsHardcodedCounts(root) {
  const filePath = path.join(root, "AGENTS.md")
  if (!existsSync(filePath)) return []
  const source = readFileSync(filePath, "utf8")
  const m = source.match(/(\d+) edge functions · (\d+) SQL migrations/)
  if (!m) return []
  return [
    `AGENTS.md: hardcoded scale counts (${m[1]} edge / ${m[2]} migrations) — defer to pnpm docs-stats`,
  ]
}

export function scanReadmeClaims(root, stats) {
  const checks = buildReadmeClaimChecks(stats)
  const findings = [...scanAgentsHardcodedCounts(root)]
  for (const check of checks) {
    const filePath = path.join(root, check.file)
    if (!existsSync(filePath)) continue
    const source = readFileSync(filePath, "utf8")
    if (check.file === "packages/adapters/README.md") {
      const section = source.match(
        /## Supported sources\r?\n\r?\n([\s\S]*?)\r?\n\r?\nEvery translator/
      )?.[1]
      // Count data rows only: all pipe-rows minus the header and `| ---` separator.
      const pipeRows = (section?.match(/^\|/gm) ?? []).length
      const rows = Math.max(0, pipeRows - 2)
      if (rows !== check.expected) {
        findings.push(
          `${check.file}: drift in ${check.label}: doc claims ${rows}, expected ${check.expected}`
        )
      }
      continue
    }
    check.pattern.lastIndex = 0
    let match
    while ((match = check.pattern.exec(source)) !== null) {
      const value = Number(match[1])
      if (!Number.isFinite(value)) continue
      if (value !== check.expected) {
        const lineIndex = source.slice(0, match.index).split(/\r?\n/).length
        findings.push(
          `${check.file}:${lineIndex} drift in ${check.label}: doc claims ${value}, expected ${check.expected}`
        )
      }
    }
  }
  return findings
}
