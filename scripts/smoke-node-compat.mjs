#!/usr/bin/env node
/**
 * FILE: scripts/smoke-node-compat.mjs
 * PURPOSE: Prove the packed CLI and MCP server start on the oldest Node their
 *          `engines` promise, not just the Node 24 CI builds with.
 *
 * Every publishable package declares `engines.node: ">=20.19.0"` and the CLI
 * refuses to run below MIN_NODE_MAJOR (packages/cli/src/wizard-args.ts), but
 * CI only ever ran Node 24. A dependency that quietly needs a newer runtime
 * (commander 15 declares node >=22.12) would ship unnoticed.
 *
 * Installs the given tarballs into an empty temp project with the CURRENT
 * node/npm — the way `npx` would — then:
 *   - `mushi --version` prints the CLI's version, `mushi --help` exits 0
 *   - `mushi-mcp` answers an MCP `initialize` over stdio with its own
 *     version, and exits on its own when stdin closes
 *
 * Usage (CI switches Node with setup-node between runs):
 *   node scripts/smoke-node-compat.mjs <dir-with-.tgz-files>
 */

import { execSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/smoke-node-compat.mjs <dir-with-.tgz-files>')
  process.exit(2)
}
const tarballs = readdirSync(dir)
  .filter((f) => f.endsWith('.tgz'))
  .map((f) => resolve(dir, f).replace(/\\/g, '/'))
if (tarballs.length === 0) {
  console.error(`smoke-node-compat: no .tgz files in ${dir}`)
  process.exit(2)
}

let failures = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failures++
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

const project = mkdtempSync(join(tmpdir(), 'mushi-node-compat-'))
try {
  console.log(`Node ${process.version} · npm ${execSync('npm --version', { encoding: 'utf8' }).trim()}`)
  writeFileSync(join(project, 'package.json'), '{ "name": "node-compat-smoke", "private": true }\n')
  execSync(`npm install --no-audit --no-fund --ignore-scripts ${tarballs.map((t) => `"${t}"`).join(' ')}`, {
    cwd: project,
    stdio: 'inherit',
  })

  const installed = (name) => {
    const root = join(project, 'node_modules', ...name.split('/'))
    return { root, pkg: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) }
  }
  const binPath = ({ root, pkg }, bin) => join(root, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[bin])

  // ── CLI ────────────────────────────────────────────────────────────────
  const cli = installed('@mushi-mushi/cli')
  const mushi = binPath(cli, 'mushi')
  const version = spawnSync(process.execPath, [mushi, '--version'], { encoding: 'utf8', timeout: 30_000 })
  if (version.status === 0 && version.stdout.trim() === cli.pkg.version) ok(`mushi --version → ${cli.pkg.version}`)
  else fail(`mushi --version exited ${version.status}: ${(version.stdout + version.stderr).trim().slice(0, 500)}`)
  const help = spawnSync(process.execPath, [mushi, '--help'], { encoding: 'utf8', timeout: 30_000 })
  if (help.status === 0 && /Usage:/.test(help.stdout)) ok('mushi --help')
  else fail(`mushi --help exited ${help.status}: ${(help.stdout + help.stderr).trim().slice(0, 500)}`)

  // ── MCP server over stdio ──────────────────────────────────────────────
  const mcp = installed('@mushi-mushi/mcp')
  const served = await new Promise((done) => {
    const child = spawn(process.execPath, [binPath(mcp, 'mushi-mcp')], {
      env: {
        ...process.env,
        MUSHI_API_KEY: 'smoke-test-key',
        MUSHI_PROJECT_ID: 'smoke-test-project',
        MUSHI_API_ENDPOINT: 'http://127.0.0.1:1/offline',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    let serverInfo = null
    const timer = setTimeout(() => {
      child.kill()
      done({ serverInfo, exited: false, err })
    }, 20_000)
    child.stdout.on('data', (d) => {
      out += d
      for (const line of out.split('\n')) {
        try {
          const msg = JSON.parse(line)
          if (msg.id === 1 && !serverInfo) {
            serverInfo = msg.result?.serverInfo ?? { error: msg.error }
            child.stdin.end() // EOF: the server must now exit by itself
          }
        } catch {
          // partial line
        }
      }
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('exit', () => {
      clearTimeout(timer)
      done({ serverInfo, exited: true, err })
    })
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'node-compat-smoke', version: '0' } },
      })}\n`,
    )
  })
  if (served.serverInfo?.version === mcp.pkg.version) ok(`mushi-mcp initialize → ${served.serverInfo.name}@${served.serverInfo.version}`)
  else fail(`mushi-mcp did not answer initialize (got ${JSON.stringify(served.serverInfo)}); stderr:\n${served.err.slice(0, 1500)}`)
  if (served.exited) ok('mushi-mcp exits when stdin closes')
  else fail('mushi-mcp was still running 20s after stdin closed')
} finally {
  rmSync(project, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\nsmoke-node-compat: ${failures} failure(s) on Node ${process.version}`)
  process.exit(1)
}
console.log(`\nsmoke-node-compat: CLI and MCP server run on Node ${process.version} ✓`)
