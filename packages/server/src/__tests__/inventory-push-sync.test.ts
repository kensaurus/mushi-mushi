/**
 * inventory-push-sync: a default-branch push that changes the inventory file
 * re-ingests it; other pushes, unchanged text and invalid YAML do not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ingestInventory = vi.fn(async () => ({ inventoryId: 'inv-2', appNodeId: 'n', nodeCount: 1, edgeCount: 0 }))
const parseInventoryYaml = vi.fn((raw: string) =>
  raw.includes('BROKEN')
    ? { ok: false, issues: [{ path: '$', code: 'YAML_PARSE', message: 'bad' }] }
    : { ok: true, inventory: { schema_version: '2.0', pages: [] }, issues: [] },
)
vi.mock('../../supabase/functions/_shared/inventory.ts', () => ({ ingestInventory, parseInventoryYaml }))

const { inventoryPathCandidate, syncInventoryFromPush } = await import(
  '../../supabase/functions/_shared/inventory-push-sync.ts'
)

function fakeDb(currentRaw: string | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: currentRaw === null ? null : { raw_yaml: currentRaw }, error: null }),
  }
  return { from: () => chain } as never
}

const files = (map: Record<string, string>) => async (path: string) => map[path] ?? null

beforeEach(() => {
  ingestInventory.mockClear()
})

describe('inventoryPathCandidate', () => {
  it('skips pushes with no YAML or recipe change', () => {
    expect(inventoryPathCandidate(new Set(['app/page.tsx', 'README.md']))).toBe(false)
    expect(inventoryPathCandidate(new Set(['inventory.yaml']))).toBe(true)
    expect(inventoryPathCandidate(new Set(['mushi.recipe.json']))).toBe(true)
  })
})

describe('syncInventoryFromPush', () => {
  it('ingests a changed inventory.yaml', async () => {
    const r = await syncInventoryFromPush(fakeDb('old'), {
      projectId: 'p1',
      changed: new Set(['inventory.yaml']),
      commitSha: 'abc',
      readFile: files({ 'inventory.yaml': 'new' }),
    })
    expect(r).toEqual({ status: 'ingested', inventoryId: 'inv-2', path: 'inventory.yaml' })
    expect(ingestInventory).toHaveBeenCalledWith(expect.anything(), 'p1', expect.anything(), 'new', expect.objectContaining({ commitSha: 'abc', source: 'explicit' }))
  })

  it('does nothing when the text matches the current snapshot', async () => {
    const r = await syncInventoryFromPush(fakeDb('same'), {
      projectId: 'p1',
      changed: new Set(['inventory.yaml']),
      commitSha: 'abc',
      readFile: files({ 'inventory.yaml': 'same' }),
    })
    expect(r.status).toBe('same')
    expect(ingestInventory).not.toHaveBeenCalled()
  })

  it('follows routes.inventory in the recipe manifest', async () => {
    const manifest = JSON.stringify({ version: 1, routes: { inventory: 'apps/web/inventory.yaml' } })
    const other = await syncInventoryFromPush(fakeDb(null), {
      projectId: 'p1',
      changed: new Set(['inventory.yaml']),
      commitSha: 'abc',
      readFile: files({ 'mushi.recipe.json': manifest, 'inventory.yaml': 'root' }),
    })
    expect(other.status).toBe('unchanged-path')

    const hit = await syncInventoryFromPush(fakeDb(null), {
      projectId: 'p1',
      changed: new Set(['apps/web/inventory.yaml']),
      commitSha: 'abc',
      readFile: files({ 'mushi.recipe.json': manifest, 'apps/web/inventory.yaml': 'nested' }),
    })
    expect(hit).toMatchObject({ status: 'ingested', path: 'apps/web/inventory.yaml' })
  })

  it('never ingests invalid YAML', async () => {
    const r = await syncInventoryFromPush(fakeDb('old'), {
      projectId: 'p1',
      changed: new Set(['inventory.yaml']),
      commitSha: 'abc',
      readFile: files({ 'inventory.yaml': 'BROKEN' }),
    })
    expect(r).toEqual({ status: 'invalid', issues: 1 })
    expect(ingestInventory).not.toHaveBeenCalled()
  })
})
