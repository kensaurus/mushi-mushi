/**
 * FILE: packages/server/supabase/functions/_shared/inventory-push-sync.ts
 * PURPOSE: Keep the stored inventory in step with the repo. A push to the
 *          default branch that changes the inventory file (`routes.inventory`
 *          in mushi.recipe.json, else inventory.yaml) re-ingests it.
 *
 * Before this, only a host CI step (the mcp-ci action) or a console upload
 * ingested inventory.yaml. A host without that step kept its first snapshot
 * forever: glot.it's stayed on a 2026-05-04 draft with five pages the app
 * never had, and every crawl, API-contract and status-claim check ran against
 * it (2026-10-08).
 *
 * Non-fatal by design: the caller logs a failure and keeps indexing.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ingestInventory, parseInventoryYaml } from './inventory.ts'
import { inventoryPathOf, parseRecipeManifest, RECIPE_MANIFEST_PATH } from './recipe-schema.ts'

export type InventoryPushSyncResult =
  | { status: 'unchanged-path' }
  | { status: 'no-path'; reason: string }
  | { status: 'missing' }
  | { status: 'invalid'; issues: number }
  | { status: 'same' }
  | { status: 'ingested'; inventoryId: string; path: string }

/**
 * Whether a push could have changed the inventory: it touched the recipe
 * manifest or a YAML file. Other pushes skip the sync without a fetch.
 *
 * @internal Exported for inventory-push-sync.test.ts.
 */
export function inventoryPathCandidate(changed: ReadonlySet<string>): boolean {
  for (const p of changed) {
    if (p === RECIPE_MANIFEST_PATH || /\.ya?ml$/i.test(p)) return true
  }
  return false
}

export async function syncInventoryFromPush(
  db: SupabaseClient,
  args: {
    projectId: string
    /** Paths added or modified by the push (removed paths excluded). */
    changed: ReadonlySet<string>
    commitSha: string
    /** The file's text at the pushed commit, or null when it does not exist. */
    readFile: (path: string) => Promise<string | null>
  },
): Promise<InventoryPushSyncResult> {
  if (!inventoryPathCandidate(args.changed)) return { status: 'unchanged-path' }

  const manifestText = await args.readFile(RECIPE_MANIFEST_PATH)
  const manifest = manifestText ? parseRecipeManifest(manifestText) : null
  const path = inventoryPathOf(manifest?.ok ? manifest.manifest : null)
  if (!path) return { status: 'no-path', reason: 'routes.inventory in mushi.recipe.json is not a safe repo path' }
  // A recipe edit can point at a different inventory file, so re-read it then too.
  if (!args.changed.has(path) && !args.changed.has(RECIPE_MANIFEST_PATH)) return { status: 'unchanged-path' }

  const raw = await args.readFile(path)
  if (!raw) return { status: 'missing' }
  const parsed = parseInventoryYaml(raw)
  if (!parsed.ok || !parsed.inventory) return { status: 'invalid', issues: parsed.issues.length }

  const { data: current, error: readErr } = await db
    .from('inventories')
    .select('raw_yaml')
    .eq('project_id', args.projectId)
    .eq('is_current', true)
    .maybeSingle()
  if (readErr) throw new Error(`current inventory read failed: ${readErr.message}`)
  if ((current as { raw_yaml?: string | null } | null)?.raw_yaml === raw) return { status: 'same' }

  const result = await ingestInventory(db, args.projectId, parsed.inventory, raw, {
    commitSha: args.commitSha || null,
    source: 'explicit',
    ingestedBy: null,
  })
  return { status: 'ingested', inventoryId: result.inventoryId, path }
}
