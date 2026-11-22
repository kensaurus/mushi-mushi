import { describe, expect, it } from 'vitest'
import { mergeRuntimeWidget } from './runtime-widget'

describe('mergeRuntimeWidget (ADR 0068: code wins, the console fills the rest)', () => {
  const console = (widget: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ widget, ...extra }) as never

  it('without console settings, keeps exactly what the app set', () => {
    const host = { buttonPosition: 'bottom-left' as const, theme: { accent: '#111111' } }
    expect(mergeRuntimeWidget(host, null)).toEqual(host)
    expect(mergeRuntimeWidget(undefined, undefined)).toEqual({ buttonPosition: undefined, theme: undefined })
  })

  it("the console's colour and corner fill what the app left unset", () => {
    const out = mergeRuntimeWidget(undefined, console({ accent: '#7c3aed', accentText: 'white', position: 'bottom-left' }))
    expect(out).toEqual({ buttonPosition: 'bottom-left', theme: { accent: '#7c3aed', accentFg: 'white' } })
  })

  it("the app's own colour and corner win over the console", () => {
    const host = { buttonPosition: 'bottom-right' as const, theme: { accent: '#111111' } }
    const out = mergeRuntimeWidget(host, console({ accent: '#7c3aed', accentText: 'white', position: 'bottom-left' }))
    expect(out).toEqual(host)
  })

  it("keeps the app's text colour and other tokens when only the accent comes from the console", () => {
    const out = mergeRuntimeWidget({ theme: { accentFg: '#000000', radius: 4 } as never }, console({ accent: '#7c3aed', accentText: 'white' }))
    expect(out.theme).toEqual({ accentFg: '#000000', radius: 4, accent: '#7c3aed' })
  })

  it('ignores top corners (the button has none), invalid colours, and a disabled console config', () => {
    expect(mergeRuntimeWidget(undefined, console({ position: 'top-left' })).buttonPosition).toBeUndefined()
    expect(mergeRuntimeWidget(undefined, console({ accent: 'purple' })).theme).toBeUndefined()
    expect(mergeRuntimeWidget(undefined, console({ accent: '#7c3aed', position: 'bottom-left' }, { enabled: false }))).toEqual({
      buttonPosition: undefined,
      theme: undefined,
    })
  })

  it('never applies the native defaults the server always sends (trigger mode, minimum length)', () => {
    const out = mergeRuntimeWidget(undefined, console({}, { native: { triggerMode: 'both', minDescriptionLength: 20 } }))
    expect(out).toEqual({ buttonPosition: undefined, theme: undefined })
  })
})
