/**
 * FILE: apps/admin/src/components/explore/exploreLayers.ts
 * PURPOSE: Layer detection heuristic and colour tokens for the codebase atlas.
 *
 * NOTE: The backend has its own `detectExploreLayer()` in
 * `billing-projects-queue-graph.ts` which runs during indexing and stores the
 * layer on each `project_codebase_files` row. The two implementations need not
 * be identical — the backend's version is the source of truth for what's in the
 * DB. This client-side heuristic is only used for nodes returned without a
 * pre-computed layer (e.g. fresh uploads that haven't been re-indexed). When in
 * doubt, the backend label wins; update the backend function to change how nodes
 * are categorised.
 */

import { readVizToken } from '../../lib/vizTokens'
import type { ExploreLayer } from './exploreTypes'

/**
 * Bucket a file path into one of five architectural layers based on common
 * directory and file-extension conventions. Order matters: more-specific
 * patterns come first.
 */
export function detectLayer(filePath: string): ExploreLayer {
  const p = filePath.toLowerCase()
  if (
    /\/(tests?|__tests?__|spec|e2e|cypress|playwright)\//u.test(p) ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/u.test(p)
  ) return 'test'
  if (
    /\/(server|api|backend|functions?|edge|supabase|prisma|db|database|migrations?)\//u.test(p)
  ) return 'backend'
  if (
    /\/(app|pages|screens|views|routes)\//u.test(p) ||
    /\/(components?|ui|widgets?)\//u.test(p) ||
    /\.(tsx|jsx)$/u.test(p)
  ) return 'ui'
  if (
    /\/(lib|libs?|utils?|helpers?|hooks?|shared|common|core|packages?)\//u.test(p)
  ) return 'lib'
  if (
    /\/(config|configs?|\.github|tooling|scripts?|deploy|build)\//u.test(p) ||
    /\.(json|yaml|yml|toml|env|mjs|cjs)$/u.test(p)
  ) return 'config'
  return 'other'
}

export const LAYER_LABELS: Record<ExploreLayer, string> = {
  ui:      'UI',
  lib:     'Library',
  backend: 'Backend',
  test:    'Tests',
  config:  'Config',
  other:   'Other',
}

/**
 * Colour tokens per layer — resolved via `readVizToken` because ReactFlow
 * strips CSS variable references from SVG attributes. Fallbacks in
 * vizTokens.ts match the @theme `--color-viz-layer-*` values.
 */
export const LAYER_COLORS: Record<ExploreLayer, string> = {
  get ui() { return readVizToken('viz-layer-ui') },
  get lib() { return readVizToken('viz-layer-lib') },
  get backend() { return readVizToken('viz-layer-backend') },
  get test() { return readVizToken('viz-layer-test') },
  get config() { return readVizToken('viz-layer-config') },
  get other() { return readVizToken('viz-layer-other') },
}

export const LAYER_ORDER: ExploreLayer[] = ['ui', 'lib', 'backend', 'test', 'config', 'other']
