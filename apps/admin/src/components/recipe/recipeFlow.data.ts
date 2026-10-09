/**
 * FILE: apps/admin/src/components/recipe/recipeFlow.data.ts
 * PURPOSE: Fixed layout for the App Recipe canvas — four lanes left → right
 *          (Sources · Build · Deploy · Runtime), one node per element and a
 *          small set of "feeds" edges. Positions live here, never computed by
 *          a layout engine (same pattern as pdca-flow/pdcaFlow.data.ts).
 *
 *          Readability floor: the canvas never zooms out below
 *          RECIPE_MIN_ZOOM, so the smallest card text (text-2xs, 12 px)
 *          never renders under 12 px. Fitting a 4-lane diagram into a
 *          narrow column used to scale it to ~0.5 (6 px text); now the
 *          diagram opens at 100% anchored top-left and pans instead.
 */

import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { RECIPE_LANES, elementStateMeta } from './recipeState'

const RECIPE_NODE_WIDTH = 248
const LANE_GAP = 296
/** Vertical step between stacked cards: taller than a canvas card, which is capped at RECIPE_CARD_MAX_HEIGHT (max-h-65 in RecipeElementCard). */
const ROW = 280

/** Never zoom out below 100%: card text is at least 12 px (text-2xs) and must render at 12 px or more. */
export const RECIPE_MIN_ZOOM = 1
export const RECIPE_MAX_ZOOM = 1.25
/** Smallest font used inside the canvas (text-2xs), in px. */
export const RECIPE_SMALLEST_FONT_PX = 12
/** Space above the first card for the lane headings. */
export const RECIPE_LANE_HEADER_Y = -76
/** Tallest a canvas card renders (px, enforced by max-h-65 on the card); ROW leaves room for it. */
export const RECIPE_CARD_MAX_HEIGHT = 260

const LANE_X: Record<(typeof RECIPE_LANES)[number]['id'], number> = {
  sources: 0,
  build: LANE_GAP,
  deploy: LANE_GAP * 2,
  runtime: LANE_GAP * 3,
}

/** Top-left of each element card. Sources stack vertically; schema feeds routes. */
export const RECIPE_POSITIONS: Record<RecipeElementKey, { x: number; y: number }> = {
  schema: { x: LANE_X.sources, y: 0 },
  routes: { x: LANE_X.sources, y: ROW },
  design: { x: LANE_X.sources, y: ROW * 2 },
  gates: { x: LANE_X.build, y: ROW / 2 },
  ci: { x: LANE_X.build, y: ROW * 1.5 },
  deploy: { x: LANE_X.deploy, y: ROW },
  env: { x: LANE_X.runtime, y: ROW / 2 },
  integrations: { x: LANE_X.runtime, y: ROW * 1.5 },
}

/** The diagram's extent in canvas px (lane headings included), for the pan bounds and the "does it fit" check. */
export function recipeDiagramBounds(): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const xs = Object.values(RECIPE_POSITIONS).map((p) => p.x)
  const ys = Object.values(RECIPE_POSITIONS).map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs) + RECIPE_NODE_WIDTH
  const minY = RECIPE_LANE_HEADER_Y
  const maxY = Math.max(...ys) + RECIPE_CARD_MAX_HEIGHT
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

type RecipeHandleId = 'l' | 'r' | 't' | 'b'

/** What feeds what. Kept deliberately small so the picture stays readable. */
const RECIPE_EDGES: ReadonlyArray<{
  from: RecipeElementKey
  to: RecipeElementKey
  sourceHandle: RecipeHandleId
  targetHandle: RecipeHandleId
  label: string
}> = [
  { from: 'schema', to: 'routes', sourceHandle: 'b', targetHandle: 't', label: 'tables back routes' },
  { from: 'routes', to: 'gates', sourceHandle: 'r', targetHandle: 'l', label: 'stories feed gates' },
  { from: 'gates', to: 'ci', sourceHandle: 'b', targetHandle: 't', label: 'gates run in CI' },
  { from: 'ci', to: 'deploy', sourceHandle: 'r', targetHandle: 'l', label: 'CI ships builds' },
  { from: 'design', to: 'deploy', sourceHandle: 'r', targetHandle: 'l', label: 'tokens ship with the build' },
  { from: 'deploy', to: 'env', sourceHandle: 'r', targetHandle: 'l', label: 'runs with env' },
  { from: 'deploy', to: 'integrations', sourceHandle: 'r', targetHandle: 'l', label: 'talks to integrations' },
]

export interface RecipeNodeData extends Record<string, unknown> {
  element: RecipeElementSummary
  selected: boolean
  onSelect: (key: RecipeElementKey) => void
}

export interface RecipeLaneNodeData extends Record<string, unknown> {
  label: string
  hint: string
}

export function buildRecipeNodes(
  elements: RecipeElementSummary[],
  selectedKey: RecipeElementKey | null,
  onSelect: (key: RecipeElementKey) => void,
): Node[] {
  const laneNodes: Node<RecipeLaneNodeData>[] = RECIPE_LANES.map((lane) => ({
    id: `lane:${lane.id}`,
    type: 'recipeLane',
    position: { x: LANE_X[lane.id], y: RECIPE_LANE_HEADER_Y },
    data: { label: lane.label, hint: lane.hint },
    draggable: false,
    selectable: false,
    focusable: false,
    style: { width: RECIPE_NODE_WIDTH },
  }))
  const elementNodes: Node<RecipeNodeData>[] = elements.map((element) => ({
    id: element.key,
    type: 'recipeElement',
    position: RECIPE_POSITIONS[element.key],
    data: { element, selected: selectedKey === element.key, onSelect },
    draggable: false,
    selectable: false,
    // The card inside is a real <button>; the wrapper must not be a second tab stop.
    focusable: false,
    style: { width: RECIPE_NODE_WIDTH },
  }))
  return [...laneNodes, ...elementNodes]
}

export function buildRecipeEdges(elements: RecipeElementSummary[]): Edge[] {
  const byKey = new Map(elements.map((e) => [e.key, e]))
  return RECIPE_EDGES.map((e) => {
    const sourceState = elementStateMeta(byKey.get(e.from)?.state).state
    // A feed from a source that is not known-good is drawn dashed: what flows
    // downstream from it is unverified.
    const unverified = sourceState !== 'ok'
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'smoothstep',
      ariaLabel: `${e.from} to ${e.to}: ${e.label}`,
      focusable: false,
      selectable: false,
      style: {
        stroke: 'var(--color-fg-faint)',
        strokeWidth: 1.5,
        strokeDasharray: unverified ? '5 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--color-fg-faint)' },
    }
  })
}
