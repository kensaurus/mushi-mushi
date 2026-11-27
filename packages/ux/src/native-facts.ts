// SPDX-License-Identifier: MIT
/**
 * What a native screen says (ADR 0073), from the files a phone driver can
 * write next to its screenshot, with no device access here:
 *
 *   - `window.xml`      Android `uiautomator dump` (adb exec-out uiautomator dump /dev/tty)
 *   - `hierarchy.json`  `maestro hierarchy` (Android and iOS)
 *   - `facts.json`      any subset of the scorecard's page facts the driver wrote itself
 *
 * The scorecard judges a page on its facts (text, controls, headings) and its
 * screenshots; a phone screen with only pixels would be judged blind. This
 * reads the visible text and the tappable labels from whichever file is
 * there, fills every other fact with an honest "not measured" (axe null,
 * settle time null), and keeps the screen's own name as its path.
 *
 * Pure: strings in, facts out. No XML library: uiautomator's dump is flat
 * attribute soup, and a small attribute reader is enough and safe (it never
 * resolves entities beyond the five XML ones, never fetches anything).
 */

import type { UxPageFacts } from './scorecard-rubric.js'

const MAX_TEXT = 12_000
const MAX_CONTROLS = 120
const MAX_HEADINGS = 40

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return XML_ENTITIES[e.toLowerCase()] ?? ''
  })
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

export interface NativeNode {
  text: string
  /** content-desc / accessibilityText: what a screen reader announces. */
  label: string
  className: string
  clickable: boolean
  heading: boolean
  /** Visible on screen (non-empty bounds, not hidden). */
  visible: boolean
}

/** Pure: the nodes of an Android `uiautomator dump`. */
export function parseUiautomator(xml: string): NativeNode[] {
  const out: NativeNode[] = []
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of m[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]!] = decodeXml(a[2]!)
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs.bounds ?? '')
    const visible = attrs['visible-to-user'] !== 'false' && (!bounds || (Number(bounds[3]) > Number(bounds[1]) && Number(bounds[4]) > Number(bounds[2])))
    out.push({
      text: clean(attrs.text ?? ''),
      label: clean(attrs['content-desc'] ?? ''),
      className: attrs.class ?? '',
      clickable: attrs.clickable === 'true',
      heading: attrs.heading === 'true',
      visible,
    })
  }
  return out
}

interface MaestroNode {
  attributes?: Record<string, unknown>
  children?: MaestroNode[]
}

/** Pure: the nodes of a `maestro hierarchy` dump (depth-first, at most 5,000). */
export function parseMaestroHierarchy(json: string): NativeNode[] {
  let root: MaestroNode
  try {
    root = JSON.parse(json) as MaestroNode
  } catch {
    return []
  }
  const out: NativeNode[] = []
  const stack: MaestroNode[] = [root]
  while (stack.length && out.length < 5000) {
    const n = stack.pop()!
    const a = n.attributes ?? {}
    const str = (k: string) => (typeof a[k] === 'string' ? clean(a[k] as string) : '')
    const flag = (k: string) => a[k] === true || a[k] === 'true'
    if (Object.keys(a).length) {
      out.push({
        text: str('text'),
        label: str('accessibilityText') || str('content-desc') || str('hintText'),
        className: str('class') || str('elementType'),
        clickable: flag('clickable') || /button/i.test(str('class') || str('elementType')),
        heading: flag('heading') || /header/i.test(str('traits')),
        visible: a.visible !== false && a.visible !== 'false',
      })
    }
    for (const c of [...(n.children ?? [])].reverse()) stack.push(c)
  }
  return out
}

/** Pure: the scorecard's text, controls and headings of a screen's nodes. */
export function nodesToContent(nodes: readonly NativeNode[]): { text: string; controls: string[]; headings: string[] } {
  const words: string[] = []
  const controls: string[] = []
  const headings: string[] = []
  for (const n of nodes) {
    if (!n.visible) continue
    const said = n.text || n.label
    if (!said) continue
    if (words[words.length - 1] !== said) words.push(said)
    if (n.clickable && said.length <= 80 && !controls.includes(said) && controls.length < MAX_CONTROLS) controls.push(said)
    if (n.heading && said.length <= 200 && !headings.includes(said) && headings.length < MAX_HEADINGS) headings.push(said)
  }
  return { text: words.join('\n').slice(0, MAX_TEXT), controls, headings }
}

/** Pure: width and height of a PNG from its header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // IHDR is always the first chunk: length(4) "IHDR"(4) width(4) height(4).
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Pure: a screen name as a page key and path (`Onboarding step 1` → `/onboarding-step-1`). */
export function screenPath(name: string): string {
  const slug = name
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter(Boolean)
    .join('-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
  return `/${slug || 'screen'}`.slice(0, 500)
}

const clampDim = (n: number) => Math.max(200, Math.min(4000, Math.round(n)))

/**
 * Pure: complete scorecard facts for one native screen. `given` is what the
 * driver wrote in facts.json (any subset; a field there wins), `nodes` the
 * hierarchy when one was dumped, `png` the settled screenshot's size, `scale`
 * the device's pixel ratio (pixels per point; 1 keeps pixels).
 */
export function nativeFacts(input: { folder: string; given?: Partial<UxPageFacts> | null; nodes?: readonly NativeNode[] | null; png?: { width: number; height: number } | null; scale?: number }): UxPageFacts {
  const g = input.given ?? {}
  const content = input.nodes?.length ? nodesToContent(input.nodes) : { text: '', controls: [], headings: [] }
  const path = typeof g.path === 'string' && g.path.startsWith('/') ? g.path.slice(0, 500) : screenPath(typeof g.key === 'string' && g.key ? g.key : input.folder)
  const key = typeof g.key === 'string' && g.key ? g.key.slice(0, 500) : path
  const scale = input.scale && input.scale > 0 ? input.scale : 1
  const vp = g.viewport && Number.isFinite(g.viewport.width) && Number.isFinite(g.viewport.height)
    ? { width: clampDim(g.viewport.width), height: clampDim(g.viewport.height) }
    : input.png
      ? { width: clampDim(input.png.width / scale), height: clampDim(input.png.height / scale) }
      : { width: 390, height: 844 }
  const label = typeof g.label === 'string' && g.label ? g.label.slice(0, 300) : content.headings[0] ?? input.folder.replace(/[-_]+/g, ' ').slice(0, 300)
  return {
    key,
    path,
    label,
    title: typeof g.title === 'string' ? g.title.slice(0, 300) : label,
    ...(typeof g.breadcrumb === 'string' ? { breadcrumb: g.breadcrumb.slice(0, 300) } : {}),
    headings: Array.isArray(g.headings) ? g.headings.slice(0, MAX_HEADINGS).map((h) => String(h).slice(0, 200)) : content.headings,
    text: typeof g.text === 'string' ? g.text.slice(0, MAX_TEXT) : content.text,
    controls: Array.isArray(g.controls) ? g.controls.slice(0, MAX_CONTROLS).map((c) => String(c).slice(0, 120)) : content.controls,
    ...(typeof g.earlyText === 'string' ? { earlyText: g.earlyText.slice(0, 4000) } : {}),
    settleMs: typeof g.settleMs === 'number' && g.settleMs >= 0 ? Math.min(600_000, Math.round(g.settleMs)) : null,
    axe: g.axe ?? null,
    overflowX: g.overflowX === true,
    consoleErrors: typeof g.consoleErrors === 'number' && g.consoleErrors >= 0 ? Math.min(10_000, Math.round(g.consoleErrors)) : 0,
    cls: typeof g.cls === 'number' && g.cls >= 0 ? Math.min(100, g.cls) : 0,
    viewport: vp,
  }
}
