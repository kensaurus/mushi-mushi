/**
 * spec-drift.ts — Gate 6 oasdiff-based OpenAPI spec drift detection.
 *
 * Downloads the oasdiff Go binary (static, no runtime deps) and runs
 * `oasdiff breaking <base> <head>` to find breaking API changes between
 * two OpenAPI spec versions.
 *
 * The binary is cached under ~/.mushi/oasdiff-<version> after first download.
 * Version can be pinned via the OASDIFF_VERSION env var; defaults to latest.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const OASDIFF_VERSION = process.env.OASDIFF_VERSION ?? '1.10.18'

const PLATFORM_MAP: Record<string, string> = {
  'linux-x64': 'linux-amd64',
  'linux-arm64': 'linux-arm64',
  'darwin-x64': 'darwin-amd64',
  'darwin-arm64': 'darwin-arm64',
  'win32-x64': 'windows-amd64',
}

function getOasdiffUrl(): string {
  const platformKey = `${process.platform}-${process.arch}`
  const platform = PLATFORM_MAP[platformKey]
  if (!platform) throw new Error(`Unsupported platform for oasdiff: ${platformKey}`)
  const ext = process.platform === 'win32' ? '.exe' : ''
  return (
    `https://github.com/Tufin/oasdiff/releases/download/v${OASDIFF_VERSION}/` +
    `oasdiff_${OASDIFF_VERSION}_${platform}${ext}.tar.gz`
  )
}

async function downloadOasdiff(): Promise<string> {
  const cacheDir = join(homedir(), '.mushi', 'tools')
  mkdirSync(cacheDir, { recursive: true })
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binPath = join(cacheDir, `oasdiff-${OASDIFF_VERSION}${ext}`)
  if (existsSync(binPath)) return binPath

  const url = getOasdiffUrl()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download oasdiff: HTTP ${res.status} from ${url}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const maxBytes = 64 * 1024 * 1024
  if (buf.length > maxBytes) {
    throw new Error(`oasdiff download too large (${buf.length} bytes) — aborting`)
  }

  // Store under ~/.mushi/tools (mode 0700 dir) instead of the world-readable
  // system temp dir — avoids CodeQL insecure-temp-file + keeps cache reusable.
  const tgzPath = join(cacheDir, `oasdiff-${createHash('md5').update(url).digest('hex')}.tar.gz`)
  writeFileSync(tgzPath, buf)

  const extractDir = mkdtempSync(join(cacheDir, 'oasdiff-extract-'))
  try {
    execFileSync('tar', ['-xzf', tgzPath, '-C', extractDir])

    const { readdirSync, copyFileSync } = await import('node:fs')
    const files = readdirSync(extractDir)
    const binName = process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff'
    const found = files.find((f) => f === binName || f.startsWith('oasdiff'))
    if (!found) throw new Error(`oasdiff binary not found in archive. Files: ${files.join(', ')}`)
    copyFileSync(join(extractDir, found), binPath)
    if (process.platform !== 'win32') chmodSync(binPath, 0o755)
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
    rmSync(tgzPath, { force: true })
  }
  return binPath
}

export interface SpecDriftFinding {
  severity: 'error' | 'warn' | 'info'
  rule_id: string
  message: string
  path?: string
  method?: string
}

export async function runSpecDrift(opts: {
  baseSpec: string
  headSpec: string
}): Promise<SpecDriftFinding[]> {
  let binPath: string
  try {
    binPath = await downloadOasdiff()
  } catch (err) {
    throw new Error(`oasdiff download failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  let output = ''
  try {
    output = execFileSync(binPath, ['breaking', opts.baseSpec, opts.headSpec, '--format', 'json'], {
      encoding: 'utf-8',
      timeout: 30_000,
      // oasdiff exits 1 when breaking changes are found — that's expected.
      // We catch the error and still parse stdout.
    })
  } catch (err) {
    // execFileSync throws on non-zero exit. Capture stdout from the error object.
    const execErr = err as { stdout?: string; stderr?: string; status?: number }
    output = execErr.stdout ?? ''
    // If no stdout and non-zero exit, it's a real failure (e.g. binary crash).
    if (!output && execErr.status !== 1) {
      throw new Error(
        `oasdiff failed: ${execErr.stderr ?? String(err)}`,
      )
    }
  }

  if (!output.trim()) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    // oasdiff may output plain text in some versions — wrap as a single warning.
    return [{ severity: 'warn', rule_id: 'spec-drift-parse-error', message: output.slice(0, 500) }]
  }

  // oasdiff JSON output: array of { id, text, level, operation, operationId, path, source }
  const items = Array.isArray(parsed) ? parsed : []
  return items.map((item: Record<string, unknown>) => {
    const level = String(item.level ?? 'error').toLowerCase()
    const severity: SpecDriftFinding['severity'] =
      level === 'error' || level === 'breaking' ? 'error'
        : level === 'warn' || level === 'warning' ? 'warn'
        : 'info'
    return {
      severity,
      rule_id: String(item.id ?? 'spec-drift'),
      message: String(item.text ?? item.message ?? JSON.stringify(item)),
      path: item.path ? String(item.path) : undefined,
      method: item.operation ? String(item.operation) : undefined,
    }
  })
}
