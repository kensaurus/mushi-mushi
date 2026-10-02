/**
 * FILE: packages/cli/src/radar/scan.ts
 * PURPOSE: The local half of the radar (Plan 020 Phase 1): walk the repo,
 *          find `storage_sql_delete`, and gather the build-config files the
 *          store-policy rules read, so the host's CI can push them with
 *          `mushi radar scan --push`. Mushi never clones a repo; this runs in
 *          the repo's own CI job.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { isRepoScanPath, scanStorageSqlDelete, type StorageScanFinding } from './repo-scan-core.js'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', '.expo', 'Pods', '.gradle', 'DerivedData', '.venv', 'venv', '__pycache__'])
const MAX_FILES = 20_000
const MAX_SCAN_BYTES = 1024 * 1024
const MAX_CONFIG_BYTES = 256 * 1024
const MAX_CONFIG_FILES = 40

export interface LocalRadarScan {
  scannedFiles: number
  truncated: boolean
  /** Folders or files that could not be read; any of these makes the scan partial. */
  unreadable: number
  findings: StorageScanFinding[]
  /** Build-config files for the server's store-policy rules (path → text). */
  configFiles: Record<string, string>
}

/** Repo-relative paths with forward slashes, depth-first, skipping vendor and build folders. */
function listRepoFiles(root: string, limit = MAX_FILES): { files: string[]; truncated: boolean; unreadable: number } {
  const out: string[] = []
  let truncated = false
  let unreadable = 0
  // The root itself must be readable: a typo in --dir is an error, never "found nothing".
  readdirSync(root)
  const walk = (dir: string) => {
    if (out.length >= limit) { truncated = true; return }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      unreadable++
      return
    }
    for (const e of entries) {
      if (out.length >= limit) { truncated = true; return }
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full)
      } else if (e.isFile()) {
        out.push(relative(root, full).split(sep).join('/'))
      }
    }
  }
  walk(root)
  return { files: out, truncated, unreadable }
}

export function scanLocalRepo(root: string): LocalRadarScan {
  const { files, truncated, unreadable: unreadableDirs } = listRepoFiles(root)
  let unreadable = unreadableDirs
  const findings: StorageScanFinding[] = []
  const configFiles: Record<string, string> = {}
  let scannedFiles = 0
  for (const rel of files) {
    const full = join(root, rel)
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      unreadable++
      continue
    }
    if (isRepoScanPath(rel) && size <= MAX_CONFIG_BYTES && Object.keys(configFiles).length < MAX_CONFIG_FILES) {
      configFiles[rel] = readFileSync(full, 'utf8')
    }
    if (size > MAX_SCAN_BYTES || !/\.(sql|ts|tsx|js|mjs|cjs|py)$/i.test(rel)) continue
    scannedFiles++
    findings.push(...scanStorageSqlDelete(rel, readFileSync(full, 'utf8')))
  }
  return { scannedFiles, truncated, unreadable, findings, configFiles }
}

/** The body for POST /v1/ingest/radar: rule ids, paths and lines only, plus the config files. */
export function toIngestBody(scan: LocalRadarScan, commitSha: string | null): Record<string, unknown> {
  return {
    ...(commitSha && /^[0-9a-f]{7,64}$/i.test(commitSha) ? { commitSha } : {}),
    scanned: ['storage_sql_delete'],
    // Over the file limit, with unreadable folders, or with nothing scanned, the scan did not
    // cover the repo: Mushi must not record a pass.
    ...(scan.truncated || scan.unreadable > 0 || scan.scannedFiles === 0 ? { partial: ['storage_sql_delete'] } : {}),
    findings: scan.findings.slice(0, 200).map((f) => ({ ruleId: f.ruleId, filePath: f.filePath, line: f.line })),
    files: scan.configFiles,
  }
}
