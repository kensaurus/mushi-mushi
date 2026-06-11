#!/usr/bin/env node
/**
 * scripts/docs-stats.mjs
 *
 * Usage:
 *   node scripts/docs-stats.mjs --print
 *   node scripts/docs-stats.mjs --print-markdown
 *   node scripts/docs-stats.mjs --check
 */

import process from "node:process"
import {
  deriveDocsStats,
  formatCompact,
  scanReadmeClaims,
} from "./lib/docs-stats.mjs"

function printMarkdown(stats) {
  console.log(`# Mushi docs stats (${stats.generatedAt})`)
  console.log("")
  console.log("## Monorepo")
  console.log(`| Metric | Value |`)
  console.log(`| --- | ---: |`)
  console.log(
    `| TypeScript lines | ${formatCompact(stats.monorepo.tsLines)} (${stats.monorepo.tsLines.toLocaleString()}) |`
  )
  console.log(`| TypeScript files | ${stats.monorepo.tsFiles.toLocaleString()} |`)
  console.log(`| Workspace packages | ${stats.monorepo.workspacePackages} |`)
  console.log(`| Publishable @mushi-mushi/* | ${stats.monorepo.publishableNpm} |`)
  console.log(`| Apps | ${stats.monorepo.apps} |`)
  console.log("")
  console.log("## Server")
  console.log(`| Metric | Value |`)
  console.log(`| --- | ---: |`)
  console.log(`| Edge functions | ${stats.server.edgeFunctions} |`)
  console.log(`| SQL migrations | ${stats.server.sqlMigrations} |`)
  console.log(`| Helm migration mirror | ${stats.server.helmMigrations} |`)
  console.log(`| Pipeline agents (AGENTS.md) | ${stats.server.pipelineAgents} |`)
  console.log("")
  console.log("## Integrations")
  console.log(`| Metric | Value |`)
  console.log(`| --- | ---: |`)
  console.log(`| Inbound adapters | ${stats.integrations.inboundAdapters} |`)
  console.log(`| Outbound plugins | ${stats.integrations.outboundPlugins} |`)
}

function main() {
  const stats = deriveDocsStats(process.cwd())

  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  if (process.argv.includes("--print-markdown")) {
    printMarkdown(stats)
    return
  }

  const findings = scanReadmeClaims(process.cwd(), stats)
  if (findings.length > 0) {
    console.error("Docs stats check failed:")
    for (const f of findings) console.error(`- ${f}`)
    console.error("")
    console.error("Run `pnpm docs-stats` for canonical values.")
    process.exit(1)
  }

  console.log(
    `Docs stats check passed. ${stats.server.edgeFunctions} edge functions, ` +
      `${stats.server.sqlMigrations} migrations, ` +
      `${stats.integrations.outboundPlugins} outbound plugins, ` +
      `${stats.integrations.inboundAdapters} inbound adapters.`
  )
}

main()
