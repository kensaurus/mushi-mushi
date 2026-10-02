import type { Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pullAppStore, pullPlay, writeListing } from '../store/pull.js'

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
          Object.assign(files, await pullAppStore(fetch, cfg.appleId, { keyId, issuerId, privateKey: readFileSync(keyPath, 'utf8') }, now))
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
}
