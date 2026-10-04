/**
 * @vitest-environment jsdom
 */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandIcon, brandTitle, resolveBrand } from './BrandIcon'
import { BRAND_MARKS } from './brandMarks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

function render(el: ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

/** Every service the owner asked to see with its real logo. */
const REQUIRED = [
  'anthropic',
  'openai',
  'openrouter',
  'firecrawl',
  'browserbase',
  'cursor',
  'supabase',
  'sentry',
  'github',
  'slack',
  'linear',
  'jira',
  'discord',
  'microsoftteams',
  'telegram',
  'stripe',
  'claude',
  'vscode',
  'windsurf',
  'zed',
] as const

describe('brand marks', () => {
  it.each(REQUIRED)('vendors a real path for %s', (id) => {
    const mark = BRAND_MARKS[id]
    expect(mark.paths.length).toBeGreaterThan(0)
    expect(mark.paths[0].d.length).toBeGreaterThan(40)
    expect(mark.hex).toMatch(/^#[0-9A-F]{6}$/i)
  })
})

describe('resolveBrand', () => {
  it('accepts ids, names, integration kinds and domains', () => {
    expect(resolveBrand('anthropic')).toBe('anthropic')
    expect(resolveBrand('Microsoft Teams')).toBe('microsoftteams')
    expect(resolveBrand('claude_code_agent')).toBe('claude')
    expect(resolveBrand('cursor_cloud')).toBe('cursor')
    expect(resolveBrand('VS Code Insiders')).toBe('vscode')
    expect(resolveBrand('linear.app')).toBe('linear')
    expect(resolveBrand('https://www.firecrawl.dev/app/api-keys')).toBe('firecrawl')
    expect(resolveBrand('acme.atlassian.net')).toBe('jira')
    expect(resolveBrand('o1.ingest.sentry.io')).toBe('sentry')
  })

  it('returns null for an unknown service', () => {
    expect(resolveBrand('langfuse')).toBeNull()
    expect(resolveBrand('')).toBeNull()
    expect(brandTitle('nope')).toBeNull()
  })
})

describe('BrandIcon', () => {
  it('has the brand name as its accessible name by default', () => {
    const el = render(<BrandIcon brand="supabase" />)
    const svg = el.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Supabase')
    expect(svg.getAttribute('data-brand')).toBe('supabase')
    // mushi-mushi-allowlist: asserts the vendored brand colour
    expect(svg.getAttribute('fill')).toBe('#3FCF8E')
  })

  it('is hidden from screen readers when decorative', () => {
    const el = render(<BrandIcon brand="slack" decorative />)
    const svg = el.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBeNull()
  })

  it('draws near-black marks and mono icons in the text colour', () => {
    const dark = render(<BrandIcon brand="github" />)
    expect(dark.querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
    act(() => root?.unmount())
    const mono = render(<BrandIcon brand="stripe" mono />)
    expect(mono.querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
  })

  it('renders a neutral fallback with the given name for an unknown brand', () => {
    const el = render(<BrandIcon brand="langfuse" label="Langfuse" />)
    const svg = el.querySelector('svg')!
    expect(svg.getAttribute('data-brand')).toBe('unknown')
    expect(svg.getAttribute('aria-label')).toBe('Langfuse')
  })
})
