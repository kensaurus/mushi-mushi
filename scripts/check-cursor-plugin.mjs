#!/usr/bin/env node
/**
 * scripts/check-cursor-plugin.mjs
 *
 * Validates the Mushi Cursor Plugin bundle under packages/cursor-plugin/.
 * Checks:
 *  1. plugin.json is valid JSON with required fields
 *  2. mcp.json exists and is valid JSON
 *  3. All skill files referenced in plugin.json exist
 *  4. All rule files referenced in plugin.json exist
 *  5. All command files referenced in plugin.json exist
 *  6. mcp.json references the stdio fallback config
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..', 'packages', 'cursor-plugin')

let failures = 0

function fail(msg) {
  console.error(`  ✗ FAIL: ${msg}`)
  failures++
}

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function readJson(relPath) {
  const abs = resolve(pluginRoot, relPath)
  if (!existsSync(abs)) {
    fail(`${relPath} does not exist`)
    return null
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    fail(`${relPath} is not valid JSON: ${e.message}`)
    return null
  }
}

console.log('\n── Cursor plugin manifest validation ───────────────────────────────────────')

// 1. plugin.json
const manifest = readJson('.cursor-plugin/plugin.json')
if (manifest) {
  ok('.cursor-plugin/plugin.json — valid JSON')
  const required = ['name', 'displayName', 'version', 'description', 'author', 'mcp']
  for (const field of required) {
    if (!manifest[field]) {
      fail(`plugin.json missing required field: ${field}`)
    }
  }
  if (manifest.name && manifest.version && manifest.description) {
    ok(`plugin.json fields: name="${manifest.name}", version="${manifest.version}"`)
  }
}

// 2. mcp.json
const mcpConfig = readJson('mcp.json') ?? readJson('.mcp.json')
if (mcpConfig) {
  ok('mcp.json — valid JSON')
  if (!mcpConfig.mcpServers) {
    fail('mcp.json missing mcpServers key')
  } else {
    const servers = Object.keys(mcpConfig.mcpServers)
    ok(`mcp.json servers: ${servers.join(', ')}`)

    // Must have a hosted HTTP and/or stdio entry
    const hasHttp = servers.some(s => mcpConfig.mcpServers[s].type === 'http')
    const hasStdio = servers.some(s => mcpConfig.mcpServers[s].type === 'stdio')
    if (!hasHttp && !hasStdio) {
      fail('mcp.json must define at least one http or stdio server')
    }
    if (hasHttp) ok('mcp.json has hosted HTTP server entry')
    if (hasStdio) ok('mcp.json has stdio fallback server entry')
  }
}

// 3. Skills
if (manifest?.skills) {
  for (const skill of manifest.skills) {
    const abs = resolve(pluginRoot, skill)
    if (!existsSync(abs)) {
      fail(`Skill file not found: ${skill}`)
    } else {
      ok(`Skill exists: ${skill}`)
    }
  }
}

// 4. Rules
if (manifest?.rules) {
  for (const rule of manifest.rules) {
    const abs = resolve(pluginRoot, rule)
    if (!existsSync(abs)) {
      fail(`Rule file not found: ${rule}`)
    } else {
      ok(`Rule exists: ${rule}`)
    }
  }
}

// 5. Commands
if (manifest?.commands) {
  for (const cmd of manifest.commands) {
    const abs = resolve(pluginRoot, cmd)
    if (!existsSync(abs)) {
      fail(`Command file not found: ${cmd}`)
    } else {
      ok(`Command exists: ${cmd}`)
    }
  }
}

// 6. README
const readmePath = resolve(pluginRoot, 'README.md')
if (!existsSync(readmePath)) {
  fail('README.md does not exist in packages/cursor-plugin/')
} else {
  ok('README.md exists')
}

// 7. Logo
const logoPath = resolve(pluginRoot, 'logo.svg')
const logoPngPath = resolve(pluginRoot, 'logo.png')
if (!existsSync(logoPath) && !existsSync(logoPngPath)) {
  warn('No logo.svg or logo.png found — recommended for Cursor Marketplace listing')
} else {
  ok(`Logo exists: ${existsSync(logoPath) ? 'logo.svg' : 'logo.png'}`)
}

console.log('\n── Summary ─────────────────────────────────────────────────────────────────')
if (failures === 0) {
  console.log('   Cursor plugin bundle is valid.\n')
  process.exit(0)
} else {
  console.log(`   ${failures} failure(s) — fix them before publishing the plugin.\n`)
  process.exit(1)
}
