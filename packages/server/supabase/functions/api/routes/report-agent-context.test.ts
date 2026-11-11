import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  inventoryAnchorOf,
  inventoryBlastRadiusNote,
  mergeAffected,
  pagePathOf,
} from './report-agent-context-helpers.ts'

Deno.test('the inventory anchor is read from the RPC camelCase keys', () => {
  const anchor = inventoryAnchorOf({ actionNodeId: 'n1', actionLabel: 'Sign in', nodeType: 'action' })
  assertEquals(anchor, { nodeId: 'n1', label: 'Sign in' })
  assertEquals(
    inventoryBlastRadiusNote(anchor),
    'This report is filed against the "Sign in" user-story action — changes here may affect that flow.',
  )
})

Deno.test('the snake_case keys the detail route used to read are not an anchor', () => {
  // get_report_inventory_action never returns these; reading them left the
  // fix packet's blast-radius line empty on every report.
  assertEquals(inventoryAnchorOf({ node_id: 'n1', label: 'Sign in' }), null)
  assertEquals(inventoryAnchorOf(null), null)
  assertEquals(inventoryBlastRadiusNote(inventoryAnchorOf({ actionNodeId: 'n1', actionLabel: '  ' })), null)
})

Deno.test('page anchors use the URL pathname, like buildReportGraph', () => {
  assertEquals(pagePathOf('https://app.example.com/login?next=/x#top'), '/login')
  assertEquals(pagePathOf('/settings/billing'), '/settings/billing')
  assertEquals(pagePathOf(null), null)
})

Deno.test('blast radii merge to one entry per node at its shallowest depth', () => {
  const merged = mergeAffected([
    {
      anchor: { node_id: 'c1', node_type: 'component', label: 'LoginForm', via: 'component' },
      affected: [
        { target_node_id: 'p1', node_type: 'page', label: '/login', min_depth: 1 },
        { target_node_id: 'x9', node_type: 'component', label: 'Header', min_depth: 3 },
      ],
    },
    {
      anchor: { node_id: 'p1', node_type: 'page', label: '/login', via: 'page' },
      affected: [
        { target_node_id: 'x9', node_type: 'component', label: 'Header', min_depth: 1 },
        { target_node_id: 'c1', node_type: 'component', label: 'LoginForm', min_depth: 1 },
      ],
    },
  ])
  // Anchors are the report itself, never "affected".
  assertEquals(merged, [
    { target_node_id: 'x9', node_type: 'component', label: 'Header', min_depth: 1, via: ['component', 'page'] },
  ])
})
