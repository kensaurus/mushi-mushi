/**
 * /mcp published its tab first ("Overview · Editor agents · MCP posture…"),
 * so the browser tab led with the section. The page name leads.
 */

import { describe, expect, it } from 'vitest'
import { mcpPageContextTitle } from './mcpPageTitle'
import { composeTitle } from './useDocumentTitle'

const OVERVIEW_SUMMARY =
  'MCP posture — key scopes, connection status, and recommended next steps for agent access.'

describe('mcpPageContextTitle', () => {
  it('leads the browser title with Editor agents, then the section, then the summary', () => {
    for (const tabLabel of ['Overview', 'Setup', 'Catalog', 'Examples']) {
      const title = composeTitle(mcpPageContextTitle(tabLabel), OVERVIEW_SUMMARY)
      expect(title.startsWith('Editor agents · ')).toBe(true)
      expect(title.indexOf(tabLabel)).toBeGreaterThan(title.indexOf('Editor agents'))
      expect(title.indexOf(OVERVIEW_SUMMARY)).toBeGreaterThan(title.indexOf(tabLabel))
      expect(title.endsWith('— Mushi Mushi')).toBe(true)
    }

    const overviewTitle = composeTitle(mcpPageContextTitle('Overview'), OVERVIEW_SUMMARY)
    expect(overviewTitle.startsWith('Editor agents · Overview · MCP posture')).toBe(true)
  })
})
