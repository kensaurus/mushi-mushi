/**
 * FILE: packages/cli/src/sourcemaps.ts
 * PURPOSE: mushi sourcemaps upload — uploads source map files to the Mushi
 *          platform. Idempotent: a sha256 check gate prevents re-uploading a
 *          file that is already stored for the given release.
 *
 * USAGE:
 *   mushi sourcemaps upload --release 1.0.0 --dir ./dist
 *   mushi sourcemaps upload --release 1.0.0 --dir ./dist --dry-run
 */

import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, basename } from 'node:path'
import * as p from '@clack/prompts'

export interface SourcemapsUploadOptions {
  release: string
  dir: string
  endpoint?: string
  apiKey?: string
  dryRun?: boolean
  silent?: boolean
}

/** Find all .js.map and .css.map files recursively in a directory. */
export async function findMapFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const e of entries) {
      const full = join(current, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (
        e.isFile() &&
        (e.name.endsWith('.js.map') || e.name.endsWith('.css.map'))
      ) {
        results.push(full)
      }
    }
  }
  await walk(dir)
  return results
}

/** Compute sha256 hex digest of a file for idempotency. */
function fileHash(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/** Upload a single source map; returns whether it was uploaded or skipped. */
async function uploadFile(
  filePath: string,
  release: string,
  endpoint: string,
  apiKey: string,
): Promise<{ ok: boolean; skipped: boolean; reason?: string }> {
  const sha256 = await fileHash(filePath)

  // Idempotency: check if this sha256 is already stored for this release.
  try {
    const checkRes = await fetch(
      `${endpoint}/v1/sourcemaps?sha256=${encodeURIComponent(sha256)}&release=${encodeURIComponent(release)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, 'X-Mushi-Api-Key': apiKey } },
    )
    if (checkRes.ok) {
      const json = (await checkRes.json()) as { exists?: boolean }
      if (json.exists) return { ok: true, skipped: true }
    }
  } catch {
    // Connectivity issue on existence check — proceed with upload anyway.
  }

  const contents = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([contents]), basename(filePath))
  form.append('filename', relative(process.cwd(), filePath).replaceAll('\\', '/'))
  form.append('release', release)
  form.append('sha256', sha256)

  const res = await fetch(`${endpoint}/v1/sourcemaps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'X-Mushi-Api-Key': apiKey },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      skipped: false,
      reason: `HTTP ${res.status}: ${text.slice(0, 120)}`,
    }
  }

  return { ok: true, skipped: false }
}

/** Main handler for `mushi sourcemaps upload`. */
export async function runSourcemapsUpload(
  opts: SourcemapsUploadOptions,
): Promise<void> {
  // Phase 2.1: no dead-host fallback. The previous default
  // ('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api') pointed at a host that does not exist —
  // uploads against it silently failed at the TCP level. Force the operator
  // to be explicit so misconfiguration surfaces immediately.
  const endpoint = opts.endpoint ?? process.env['MUSHI_API_ENDPOINT'] ?? ''
  const apiKey = opts.apiKey ?? process.env['MUSHI_API_KEY'] ?? ''

  if (!opts.dryRun && !endpoint) {
    p.log.error(
      'No API endpoint configured. Pass --endpoint <url>, set MUSHI_API_ENDPOINT,\n' +
        '  or run `mushi config endpoint <url>` to persist it. For Supabase self-hosting,\n' +
        '  this is your edge-functions URL, e.g. https://xyz.supabase.co/functions/v1/api',
    )
    process.exit(1)
  }

  if (!opts.dryRun && !apiKey) {
    p.log.error('No API key — set MUSHI_API_KEY or pass --api-key <key>')
    process.exit(1)
  }

  if (!opts.silent) p.intro(`sourcemaps upload · release ${opts.release}`)

  const spin = p.spinner()
  spin.start(`Scanning ${opts.dir} for .map files…`)

  let files: string[]
  try {
    files = await findMapFiles(opts.dir)
  } catch (err: unknown) {
    spin.stop('Scan failed')
    p.log.error(
      `Cannot read ${opts.dir}: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }

  spin.stop(
    `Found ${files.length} map file${files.length === 1 ? '' : 's'}`,
  )

  if (files.length === 0) {
    p.log.warn('No .js.map or .css.map files found — nothing to upload.')
    return
  }

  if (opts.dryRun) {
    p.log.info('Dry run — files that would be uploaded:')
    for (const f of files) {
      p.log.message(`  ${relative(process.cwd(), f).replaceAll('\\', '/')}`)
    }
    p.outro(`${files.length} file${files.length === 1 ? '' : 's'} would be uploaded`)
    return
  }

  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const filePath of files) {
    const rel = relative(process.cwd(), filePath).replaceAll('\\', '/')
    const fs = p.spinner()
    fs.start(rel)
    const result = await uploadFile(filePath, opts.release, endpoint, apiKey)
    if (result.skipped) {
      fs.stop(`↩  ${rel} (already uploaded)`)
      skipped++
    } else if (result.ok) {
      fs.stop(`✓  ${rel}`)
      uploaded++
    } else {
      fs.stop(`✗  ${rel} — ${result.reason ?? 'unknown error'}`)
      failed++
    }
  }

  const total = files.length
  const parts = [
    `Uploaded ${uploaded} / ${total} file${total === 1 ? '' : 's'}`,
    skipped > 0 ? `(${skipped} already existed)` : '',
    failed > 0 ? `— ${failed} failed` : '',
  ].filter(Boolean)
  const summary = parts.join(' ')

  if (!opts.silent) {
    if (failed > 0) {
      p.log.error(summary)
    } else {
      p.outro(summary)
    }
  }

  if (failed > 0) process.exit(1)
}
