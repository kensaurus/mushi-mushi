/**
 * FILE: packages/server/supabase/functions/_shared/radar/default-deps.ts
 * PURPOSE: The live I/O behind runRadar — public fetches through
 *          publicFetch (SSRF-safe) and read-only GitHub reads at a pinned
 *          SHA. Shared by the api route and the radar-scan function.
 */

import { getDefaultHead, listTree, readBlobsGraphql, resolveRecipeRepo } from '../recipe-github.ts'
import { publicFetch } from '../safe-fetch.ts'
import type { RadarRunDeps } from './run.ts'

export const defaultRadarRunDeps: RadarRunDeps = {
  fetcher: (url) => publicFetch(url),
  resolveRepo: resolveRecipeRepo,
  getDefaultHead,
  listTree,
  readBlobs: readBlobsGraphql,
  now: () => new Date(),
}
