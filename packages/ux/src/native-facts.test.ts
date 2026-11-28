import { describe, expect, it } from 'vitest'
import { nativeFacts, nodesToContent, parseMaestroHierarchy, parseUiautomator, pngSize, screenPath } from './native-facts.js'

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
  <node index="1" text="Welcome to Shop &amp; Go" class="android.widget.TextView" heading="true" clickable="false" bounds="[48,200][1032,320]" />
  <node index="2" text="Get started" class="android.widget.Button" clickable="true" bounds="[48,2000][1032,2140]" />
  <node index="3" text="" content-desc="Close" class="android.widget.ImageButton" clickable="true" bounds="[960,80][1040,160]" />
  <node index="4" text="Hidden" class="android.widget.TextView" clickable="false" bounds="[0,0][0,0]" />
</node></hierarchy>`

describe('parseUiautomator', () => {
  it('reads the text, labels, headings and tappable controls of a dump, decoding entities', () => {
    const nodes = parseUiautomator(DUMP)
    expect(nodes).toHaveLength(5)
    const c = nodesToContent(nodes)
    expect(c.text).toBe('Welcome to Shop & Go\nGet started\nClose')
    expect(c.controls).toEqual(['Get started', 'Close'])
    expect(c.headings).toEqual(['Welcome to Shop & Go'])
  })

  it('reads nothing from something that is not a dump', () => {
    expect(parseUiautomator('not xml at all')).toEqual([])
  })
})

describe('parseMaestroHierarchy', () => {
  it('walks the tree depth-first and reads text and accessibility labels', () => {
    const json = JSON.stringify({
      attributes: {},
      children: [
        { attributes: { text: 'Sign in', clickable: 'true' }, children: [] },
        { attributes: { accessibilityText: 'Email', class: 'android.widget.EditText' }, children: [{ attributes: { text: 'Forgot password?', clickable: true } }] },
      ],
    })
    const c = nodesToContent(parseMaestroHierarchy(json))
    expect(c.text).toBe('Sign in\nEmail\nForgot password?')
    expect(c.controls).toEqual(['Sign in', 'Forgot password?'])
    expect(parseMaestroHierarchy('{bad')).toEqual([])
  })
})

describe('pngSize', () => {
  it('reads the header of a PNG and refuses anything else', () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 1080)
    new DataView(png.buffer).setUint32(20, 2400)
    expect(pngSize(png)).toEqual({ width: 1080, height: 2400 })
    // A PNG re-encoded by a PowerShell redirect starts with a BOM, not the signature.
    expect(pngSize(new Uint8Array([0xef, 0xbb, 0xbf, ...png.slice(3)]))).toBeNull()
    expect(pngSize(new Uint8Array(4))).toBeNull()
  })
})

describe('nativeFacts', () => {
  it('builds complete facts from a folder name, a dump and the screenshot size, in points', () => {
    const f = nativeFacts({ folder: 'Get_Started', nodes: parseUiautomator(DUMP), png: { width: 1080, height: 2400 }, scale: 2.625 })
    expect(f).toMatchObject({ key: '/get-started', path: '/get-started', label: 'Welcome to Shop & Go', settleMs: null, axe: null, consoleErrors: 0, viewport: { width: 411, height: 914 } })
    expect(f.controls).toEqual(['Get started', 'Close'])
  })

  it('keeps what the driver wrote in facts.json, and never guesses what it cannot measure', () => {
    const f = nativeFacts({ folder: 'x', given: { key: '/checkout?view=card', path: '/checkout?view=card', label: 'Checkout', text: 'Pay now', viewport: { width: 390, height: 844 } } })
    expect(f).toMatchObject({ key: '/checkout?view=card', label: 'Checkout', text: 'Pay now', viewport: { width: 390, height: 844 }, axe: null, settleMs: null })
    expect(nativeFacts({ folder: 'x' }).viewport).toEqual({ width: 390, height: 844 })
  })

  it('names a screen by its folder', () => {
    expect(screenPath('Onboarding step 1')).toBe('/onboarding-step-1')
    expect(screenPath('***')).toBe('/screen')
  })
})
