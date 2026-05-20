/**
 * FILE: apps/admin/src/components/explore/exploreLayers.ts
 * PURPOSE: Layer detection heuristic and colour tokens for the codebase atlas.
 *          Must stay in sync with detectExploreLayer() in
 *          billing-projects-queue-graph.ts on the backend — if the heuristic
 *          changes, update both sides.
 */

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
 * Colour tokens per layer — oklch values chosen to be distinct but still
 * harmonise with the existing `NODE_COLORS` palette in lib/tokens.ts.
 * These are resolved CSS colours (not CSS variables) because ReactFlow strips
 * CSS variable references from SVG attributes.
 */
export const LAYER_COLORS: Record<ExploreLayer, string> = {
  ui:      'oklch(0.72 0.19 240)',  // blue — visual surfaces
  lib:     'oklch(0.72 0.19 155)',  // green — shared logic
  backend: 'oklch(0.65 0.22 25)',   // red/amber — server/API
  test:    'oklch(0.72 0.19 300)',  // purple — test files
  config:  'oklch(0.60 0.08 240)',  // muted blue — config/tooling
  other:   'oklch(0.50 0 0)',       // grey — unclassified
}

export const LAYER_ORDER: ExploreLayer[] = ['ui', 'lib', 'backend', 'test', 'config', 'other']
