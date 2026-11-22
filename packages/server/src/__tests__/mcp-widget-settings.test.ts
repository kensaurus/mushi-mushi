/**
 * The hosted MCP's widget-settings helper is a copy of the stdio one (the
 * Deno edge function cannot import packages/mcp). Below the header comment
 * the two files must stay identical, so get_widget_settings and
 * set_widget_settings answer the same on both transports.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { widgetSettingsBody, widgetSettingsView } from '../../supabase/functions/_shared/widget-settings'

const body = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')

describe('widget-settings helper copies', () => {
  it('match below the header', () => {
    expect(body('../../supabase/functions/_shared/widget-settings.ts')).toBe(body('../../../mcp/src/widget-settings.ts'))
  })

  it('build the PUT body the sdk-config route validates', () => {
    expect(widgetSettingsBody({ accent: 'AUTO', theme: 'inherit' })).toEqual({ widget: { accent: null, theme: 'inherit' } })
    expect(widgetSettingsView(null).widget.position).toBe('bottom-right')
  })
})
