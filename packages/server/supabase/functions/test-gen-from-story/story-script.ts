/**
 * qa_stories fields for test-gen-from-story. The Playwright spec stays on
 * the draft PR. The runner skips `local` and runs `firecrawl_actions` only
 * from the JSON `usableFirecrawlScript` produces. A page with auth_required
 * true keeps Playwright — Firecrawl cannot sign in.
 */
import { usableFirecrawlScript } from './firecrawl-script.ts'

export interface StoryPageRef {
  id: string
  path?: string
  route?: string
  title?: string
  auth_required?: boolean
  user_story?: string
}

export interface StoredQaStoryScript {
  script: string
  script_lang: 'playwright-ts' | 'firecrawl-actions'
  browser_provider: 'local' | 'firecrawl_actions'
  target_url: string | null
}

/** Pages the story runs on: its page ids, else pages tagged with the story. */
export function pagesForStory(
  story: { id: string; pages?: string[] | null },
  pages: readonly StoryPageRef[] | null | undefined,
): StoryPageRef[] {
  const all = pages ?? []
  const ids = new Set(story.pages ?? [])
  const linked = ids.size > 0 ? all.filter((page) => ids.has(page.id)) : []
  return linked.length > 0 ? linked : all.filter((page) => page.user_story === story.id)
}

export function storedQaStoryScript(input: {
  playwright: string
  firecrawlActions?: string | null
  pages: readonly StoryPageRef[]
  baseUrls?: Array<string | null | undefined>
}): StoredQaStoryScript {
  const local: StoredQaStoryScript = {
    script: input.playwright,
    script_lang: 'playwright-ts',
    browser_provider: 'local',
    target_url: null,
  }
  // Omitted auth_required is not a login wall, and neither is an empty page list.
  if (input.pages.some((page) => page.auth_required === true)) return local
  const script = usableFirecrawlScript(input.firecrawlActions)
  if (!script) return local
  return {
    script,
    script_lang: 'firecrawl-actions',
    browser_provider: 'firecrawl_actions',
    target_url: cloudTarget(input.baseUrls, input.pages),
  }
}

function cloudTarget(baseUrls: Array<string | null | undefined> | undefined, pages: readonly StoryPageRef[]): string | null {
  const base = (baseUrls ?? []).map(publicUrl).find((url): url is URL => url !== null)
  if (!base) return null
  const route = pages.map((page) => (page.path || page.route || '').trim())
    .find((value) => value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://'))
  if (!route) return base.toString()
  try {
    const abs = new URL(route, base)
    const ok = abs.hostname === base.hostname && isCloudHost(abs.hostname) && !abs.username && !abs.password
      && (abs.protocol === 'http:' || abs.protocol === 'https:')
    return ok ? abs.toString() : base.toString()
  } catch {
    return base.toString()
  }
}

function publicUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return isCloudHost(url.hostname) ? url : null
  } catch {
    return null
  }
}

function isCloudHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':')) return false
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return true
  const a = Number(match[1])
  const b = Number(match[2])
  const c = Number(match[3])
  const d = Number(match[4])
  if ([a, b, c, d].some((n) => n > 255)) return false
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  return !(a === 192 && b === 168)
}
