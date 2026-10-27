/**
 * FILE: packages/server/supabase/functions/_shared/vuln-watch-deps.ts
 * PURPOSE: The real I/O behind runVulnWatch (GitHub reads at a pinned SHA,
 *          OSV and the feeds), kept apart so tests inject fakes.
 */

import { getDefaultHead, listTree, readBlobsGraphql, readBlobText, resolveRecipeRepo } from './recipe-github.ts'
import { defaultFetcher } from './osv.ts'
import { dbRunLease, type VulnWatchDeps } from './vuln-watch-db.ts'

export const defaultVulnWatchDeps: VulnWatchDeps = {
  resolveRepo: resolveRecipeRepo,
  getDefaultHead,
  listTree,
  readBlobs: readBlobsGraphql,
  readBlobText,
  fetcher: defaultFetcher,
  now: () => new Date(),
  lease: dbRunLease,
}
