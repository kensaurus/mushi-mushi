/**
 * FILE: apps/admin/src/lib/editorAgentsTitle.test.ts
 * PURPOSE: The Editor agents browser title leads with the page name.
 */

import { describe, expect, it } from 'vitest'
import { editorAgentsPageTitle } from './editorAgentsTitle'

describe('editorAgentsPageTitle', () => {
  it('leads with Editor agents on every tab', () => {
    expect(editorAgentsPageTitle('Overview')).toBe('Editor agents · Overview')
    expect(editorAgentsPageTitle('Setup')).toBe('Editor agents · Setup')
    expect(editorAgentsPageTitle('Catalog')).toBe('Editor agents · Catalog')
    expect(editorAgentsPageTitle('Examples')).toBe('Editor agents · Examples')
  })

  it('stays first when the posture summary is joined into the browser title', () => {
    // useDocumentTitle appends the page summary with " · ".
    const browserTitle = `${editorAgentsPageTitle('Overview')} · MCP posture — key scopes, connection status, and recommended next steps for agent access. — Mushi Mushi`
    expect(browserTitle.startsWith('Editor agents')).toBe(true)
  })
})
