/**
 * FILE: packages/cli/src/radar/scan.ts
 * PURPOSE: The local half of the radar (Plan 020 Phases 1–2): walk the repo,
 *          find `storage_sql_delete`, gather the build-config files the
 *          store-policy rules read, and look through the BUILT app (dist,
 *          build, out, .next/static, native JS bundles) for secret keys
 *          (`key_in_client_bundle`), so the host's CI can push them with
 *          `mushi radar scan --push`. Mushi never clones a repo; this runs in
 *          the repo's own CI job, after the build step.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { isRepoScanPath, scanStorageSqlDelete, type StorageScanFinding } from './repo-scan-core.js'
import { findSecrets, type SecretLabel, type SecretMatch } from './secret-patterns.js'

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
  /** The built-bundle secret scan (`key_in_client_bundle`). */
  bundle: BundleScan
}

/** Where a secret key sits in the built app; the key itself never leaves the machine. */
export interface BundleSecretFinding {
  filePath: string
  line: number
  label: SecretLabel
}

export interface BundleScan {
  /** Build output folders found (repo-relative). Empty = nothing built yet: the check did not run. */
  roots: string[]
  scannedFiles: number
  truncated: boolean
  unreadable: number
  findings: BundleSecretFinding[]
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

// ── key_in_client_bundle ─────────────────────────────────────────────────────

/** Folder names that hold a built web app. `.next` counts only for `.next/static` (the rest is server code). */
const BUNDLE_DIR_NAMES = new Set(['dist', 'build', 'out', 'web-build', 'storybook-static'])
/** Inside a build folder: server output and native build intermediates are not shipped to the client. */
const BUNDLE_SKIP_DIRS = new Set(['server', 'node_modules', 'intermediates', 'tmp', 'kotlin', 'cache', '.cache'])
const BUNDLE_EXT = /\.(?:js|mjs|cjs|html|bundle|jsbundle)$/i
const MAX_BUNDLE_FILES = 5_000
const MAX_BUNDLE_FILE_BYTES = 5 * 1024 * 1024
/** How deep to look for build folders (apps/web/dist is depth 3). */
const MAX_BUNDLE_ROOT_DEPTH = 4

/** Build output folders, repo-relative, without walking into vendor folders. */
function findBundleRoots(root: string): string[] {
  const roots: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_BUNDLE_ROOT_DEPTH) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      const rel = relative(root, full).split(sep).join('/')
      if (BUNDLE_DIR_NAMES.has(e.name)) {
        roots.push(rel)
        continue
      }
      if (e.name === '.next') {
        try {
          if (statSync(join(full, 'static')).isDirectory()) roots.push(`${rel}/static`)
        } catch {
          // no client output in this .next
        }
        continue
      }
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      walk(full, depth + 1)
    }
  }
  walk(root, 1)
  return roots.sort()
}

/**
 * A match that is public by design is not a leak: the Supabase anon key (a
 * JWT with role `anon`) and the Mushi SDK key (`NEXT_PUBLIC_MUSHI_API_KEY`,
 * report-only). A JWT counts only when its role says it is privileged.
 */
export function isClientSafeMatch(m: Pick<SecretMatch, 'label' | 'value'>): boolean {
  if (m.label === 'Mushi API key') return true
  if (m.label !== 'JWT') return false
  const payload = m.value.split('.')[1] ?? ''
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const role = (JSON.parse(json) as { role?: unknown }).role
    return typeof role !== 'string' || role === 'anon' || role === 'authenticated'
  } catch {
    return true
  }
}

/** Secret keys in the built app. Reads only build output; the matched text never leaves this function. */
export function scanBuiltBundles(root: string, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): BundleScan {
  const roots = findBundleRoots(root)
  const out: BundleScan = { roots, scannedFiles: 0, truncated: false, unreadable: 0, findings: [] }
  const walk = (dir: string) => {
    if (out.truncated) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      out.unreadable++
      return
    }
    for (const e of entries) {
      if (out.scannedFiles >= MAX_BUNDLE_FILES) { out.truncated = true; return }
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!BUNDLE_SKIP_DIRS.has(e.name)) walk(full)
        continue
      }
      if (!e.isFile() || !BUNDLE_EXT.test(e.name)) continue
      let text: string
      try {
        if (statSync(full).size > MAX_BUNDLE_FILE_BYTES) { out.unreadable++; continue }
        text = readFile(full)
      } catch {
        out.unreadable++
        continue
      }
      out.scannedFiles++
      const rel = relative(root, full).split(sep).join('/')
      for (const m of findSecrets(text)) {
        if (!isClientSafeMatch(m)) out.findings.push({ filePath: rel, line: m.line, label: m.label })
      }
    }
  }
  for (const r of roots) walk(join(root, r))
  return out
}

export function scanLocalRepo(root: string, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): LocalRadarScan {
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
    const wantConfig = isRepoScanPath(rel) && size <= MAX_CONFIG_BYTES && Object.keys(configFiles).length < MAX_CONFIG_FILES
    const wantScan = size <= MAX_SCAN_BYTES && /\.(sql|ts|tsx|js|mjs|cjs|py)$/i.test(rel)
    if (!wantConfig && !wantScan) continue
    let text: string
    try {
      text = readFile(full)
    } catch {
      unreadable++
      continue
    }
    if (wantConfig) configFiles[rel] = text
    if (!wantScan) continue
    scannedFiles++
    findings.push(...scanStorageSqlDelete(rel, text))
  }
  return { scannedFiles, truncated, unreadable, findings, configFiles, bundle: scanBuiltBundles(root, readFile) }
}

/**
 * The body for POST /v1/ingest/radar: rule ids, paths, lines and the kind of
 * key only (never a key), plus the config files.
 */
export function toIngestBody(scan: LocalRadarScan, commitSha: string | null): Record<string, unknown> {
  const scanned = ['storage_sql_delete']
  const partial: string[] = []
  // Over the file limit, with unreadable folders, or with nothing scanned, the scan did not
  // cover the repo: Mushi must not record a pass.
  if (scan.truncated || scan.unreadable > 0 || scan.scannedFiles === 0) partial.push('storage_sql_delete')
  // No build output means the bundle check did not run at all; leave it out so it reads "not checked".
  if (scan.bundle.scannedFiles > 0) {
    scanned.push('key_in_client_bundle')
    if (scan.bundle.truncated || scan.bundle.unreadable > 0) partial.push('key_in_client_bundle')
  }
  const findings = [
    ...scan.bundle.findings.map((f) => ({ ruleId: 'key_in_client_bundle', filePath: f.filePath, line: f.line, kind: f.label })),
    ...scan.findings.map((f) => ({ ruleId: f.ruleId, filePath: f.filePath, line: f.line })),
  ].slice(0, 200)
  return {
    ...(commitSha && /^[0-9a-f]{7,64}$/i.test(commitSha) ? { commitSha } : {}),
    scanned,
    ...(partial.length ? { partial } : {}),
    findings,
    files: scan.configFiles,
  }
}
