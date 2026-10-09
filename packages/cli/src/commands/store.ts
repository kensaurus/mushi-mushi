/**
 * FILE: packages/cli/src/commands/store.ts
 * PURPOSE: `mushi store …` — store listings as code (`pull`, on your machine
 *          with your own keys), and console parity for store reviews as
 *          reports (GET …/store/reviews, POST …/store/reviews/pull,
 *          PUT …/store/reviews/settings). An API key can turn intake off or
 *          change the threshold; turning it on needs the console.
 */

import type { Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apiCall, die, fmtDate, outputIsJson, requireConfig } from '../cli-shared.js'
import { oneLine, resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'
import { pullAppStore, pullPlay, writeListing } from '../store/pull.js'

interface StoreReviewsData {
  settings: { enabled: boolean; maxRating: number; lastPulledAt: string | null; lastStatus: string | null; lastError: string | null }
  sources: Array<{ store: string; appId: string; connected: boolean }>
  recent: Array<{ store: string; reviewId: string; rating: number | null; reportId: string | null; seenAt: string }>
  canManage: boolean
  canPull: boolean
}

interface StoreIntakeResult {
  status: string
  filed: number
  stores: Array<{ store: string; appId: string; status: string; fetched: number; newReviews: number; filed: number; detail: string | null }>
}

/** Pulling reads both stores and files reports before it answers. */
const PULL_TIMEOUT_MS = 90_000

function renderStoreReviews(d: StoreReviewsData): string[] {
  const s = d.settings
  const lines = [`Store reviews as reports: ${s.enabled ? 'on' : 'off'} · files reviews of ${s.maxRating} star(s) or fewer`]
  lines.push(`  Last pull: ${s.lastPulledAt ? `${fmtDate(s.lastPulledAt)} (${s.lastStatus ?? '?'})` : 'never'}${s.lastError ? ` — ${oneLine(s.lastError, 100)}` : ''}`)
  if (d.sources.length === 0) lines.push('  No App Store or Google Play connector is bound to this app.')
  for (const src of d.sources) lines.push(`  ${src.store.padEnd(10)} ${oneLine(src.appId, 50)}  ${src.connected ? 'key stored' : 'key unreadable'}`)
  if (d.recent.length > 0) {
    lines.push('Recently seen:')
    for (const r of d.recent) lines.push(`  ${r.store.padEnd(10)} ${String(r.rating ?? '?')}★  ${r.reportId ? `report ${r.reportId}` : 'not filed'}  ${fmtDate(r.seenAt)}`)
  }
  if (!s.enabled && d.canManage) lines.push('Turn it on in the console (Recipe → Store reviews as reports).')
  return lines
}

function readManifestStore(root: string): { listingDir: string; appleId: string | null; androidPackage: string | null } | null {
  const path = join(root, 'mushi.recipe.json')
  if (!existsSync(path)) return null
  try {
    const m = JSON.parse(readFileSync(path, 'utf8')) as { store?: { listingDir?: string; ios?: { appleId?: string }; android?: { package?: string } } }
    return {
      listingDir: (m.store?.listingDir ?? 'fastlane/metadata').replace(/\/+$/, ''),
      appleId: m.store?.ios?.appleId ?? null,
      androidPackage: m.store?.android?.package ?? null,
    }
  } catch {
    return null
  }
}

export function registerStoreCommands(program: Command): void {
  const store = program.command('store').description('Store listings as code')

  store
    .command('pull')
    .description("Copy the live App Store and Google Play listings into the repo (fastlane metadata), using your own keys")
    .option('--dir <path>', 'Repo root', '.')
    .option('--asc-key-id <id>', 'App Store Connect key id (or MUSHI_ASC_KEY_ID)')
    .option('--asc-issuer-id <id>', 'App Store Connect issuer id (or MUSHI_ASC_ISSUER_ID)')
    .option('--asc-key-path <path>', 'Path to the .p8 key (or MUSHI_ASC_KEY_PATH)')
    .option('--play-key-path <path>', 'Path to the Google service account JSON (or GOOGLE_APPLICATION_CREDENTIALS)')
    .addHelpText('after', `
Runs on your machine with your own store keys. Nothing is sent to Mushi, and
Mushi never holds a key that can publish. After this, change the listing in
the repo; your own CI (fastlane deliver / supply, or EAS) publishes it.
Reads store.listingDir, store.ios.appleId and store.android.package from
mushi.recipe.json.`)
    .action(async (opts: { dir: string; ascKeyId?: string; ascIssuerId?: string; ascKeyPath?: string; playKeyPath?: string }) => {
      const root = resolve(opts.dir)
      const cfg = readManifestStore(root)
      if (!cfg) {
        process.stderr.write('error: no readable mushi.recipe.json. Run `mushi recipe init` first.\n')
        process.exitCode = 1
        return
      }
      const now = Math.floor(Date.now() / 1000)
      const files: Record<string, string> = {}
      const keyId = opts.ascKeyId ?? process.env.MUSHI_ASC_KEY_ID
      const issuerId = opts.ascIssuerId ?? process.env.MUSHI_ASC_ISSUER_ID
      const keyPath = opts.ascKeyPath ?? process.env.MUSHI_ASC_KEY_PATH
      if (cfg.appleId && keyId && issuerId && keyPath) {
        try {
          const ios = await pullAppStore(fetch, cfg.appleId, { keyId, issuerId, privateKey: readFileSync(keyPath, 'utf8') }, now)
          if (!Object.keys(ios).some((k) => k.endsWith('/description.txt'))) console.log('App Store: no version is live yet, so only the app name, subtitle and privacy link were pulled.')
          Object.assign(files, ios)
        } catch (err) {
          process.stderr.write(`App Store: ${(err as Error).message}\n`)
          process.exitCode = 1
        }
      } else if (cfg.appleId) {
        console.log('App Store skipped: set the key id, issuer id and .p8 path.')
      }
      const playPath = opts.playKeyPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
      if (cfg.androidPackage && playPath) {
        try {
          Object.assign(files, await pullPlay(fetch, cfg.androidPackage, JSON.parse(readFileSync(playPath, 'utf8')), now))
        } catch (err) {
          process.stderr.write(`Google Play: ${(err as Error).message}\n`)
          process.exitCode = 1
        }
      } else if (cfg.androidPackage) {
        console.log('Google Play skipped: set the service account path.')
      }
      const written = writeListing(root, cfg.listingDir, files)
      console.log(written.length ? `Wrote ${written.length} files under ${cfg.listingDir}/. Review and commit them.` : 'Nothing was pulled.')
    })

  store
    .command('reviews')
    .description('Store reviews as reports: whether it is on, the bound stores, and the reviews seen lately')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<StoreReviewsData>(`/v1/admin/projects/${pid}/store/reviews`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderStoreReviews(result.data)) console.log(line)
    })

  store
    .command('reviews-pull')
    .description('Pull the latest reviews now and file the low-star ones as reports (once per 10 minutes)')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<StoreIntakeResult>(`/v1/admin/projects/${pid}/store/reviews/pull`, config, { method: 'POST' }, { timeoutMs: PULL_TIMEOUT_MS })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Pull ${result.data.status}: filed ${result.data.filed} review(s) as reports.`)
      for (const line of result.data.stores) console.log(`  ${line.store.padEnd(10)} ${line.status.padEnd(13)} fetched ${line.fetched}, new ${line.newReviews}, filed ${line.filed}${line.detail ? ` — ${oneLine(line.detail, 100)}` : ''}`)
    })

  store
    .command('reviews-set')
    .description('Turn store review intake off, or change the star threshold while it is on (owners and admins)')
    .option('--off', 'Stop filing store reviews as reports')
    .option('--max-rating <n>', 'File reviews at or under this many stars (1-5)')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Turning intake on decides that public reviews become reports, so it needs a
signed-in owner or admin in the console (Recipe → Store reviews as reports).`)
    .action(async (opts: { off?: boolean; maxRating?: string; projectId?: string; json?: boolean }) => {
      let maxRating: number | undefined
      if (opts.maxRating !== undefined) {
        maxRating = Number(opts.maxRating)
        if (!Number.isInteger(maxRating) || maxRating < 1 || maxRating > 5) throw new MushiCliError('E_INVALID_INPUT', '--max-rating must be a whole number from 1 to 5')
      }
      if (!opts.off && maxRating === undefined) throw new MushiCliError('E_INVALID_INPUT', 'Nothing to change: pass --off or --max-rating.')
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      // The route needs `enabled`: keep it on when only the threshold changes (refused if it is off).
      const body = { enabled: !opts.off, ...(maxRating !== undefined ? { maxRating } : {}) }
      const result = await apiCall<StoreReviewsData['settings']>(`/v1/admin/projects/${pid}/store/reviews/settings`, config, { method: 'PUT', body: JSON.stringify(body) })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Store reviews as reports: ${result.data.enabled ? 'on' : 'off'} · files reviews of ${result.data.maxRating} star(s) or fewer.`)
    })
}
