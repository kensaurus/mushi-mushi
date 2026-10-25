/**
 * qa_stories fields for test-gen-from-story. The Playwright spec stays on
 * the draft PR. The runner skips `local` and runs `firecrawl_actions` only
 * from the JSON `usableFirecrawlScript` produces. A page with auth_required
 * true, or a story flagged auth_required, keeps Playwright — Firecrawl cannot
 * sign in. So does a story with no public URL (the run would record
 * `no_target_url`), and a story with no linked page whose persona says the
 * user is already signed in.
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

/** Story fields that say the flow needs a session. `persona` is free text. */
export interface StoryAuthHint {
  auth_required?: boolean
  persona?: string | null
}

export interface StoredQaStoryScript {
  script: string
  script_lang: 'playwright-ts' | 'firecrawl-actions'
  browser_provider: 'local' | 'firecrawl_actions'
  target_url: string | null
}

export interface QaStoryInsertRow {
  project_id: string
  name: string
  prompt: string
  script: string
  script_lang: StoredQaStoryScript['script_lang']
  browser_provider: StoredQaStoryScript['browser_provider']
  target_url?: string
  source: 'test_gen_from_story'
  approval_status: 'approved' | 'pending_review'
  automation_mode: 'auto' | 'review' | 'approve'
  origin_story_node_id: string
  generation_model: string
  enabled: boolean
}

/** Pages named by id on the story. These are the prompt routes.
 *  A story that lists none stays empty — a user_story tag is not a route.
 */
export function pagesForStory(
  story: { id: string; pages?: string[] | null },
  pages: readonly StoryPageRef[] | null | undefined,
): StoryPageRef[] {
  const ids = story.pages ?? []
  if (ids.length === 0) return []
  const idSet = new Set(ids)
  return (pages ?? []).filter((page) => idSet.has(page.id))
}

/** Pages for the sign-in decision and the scheduled URL.
 *  Named pages win. When the story lists no ids (or none match), pages
 *  tagged with the story still count. The prompt does not use this fallback.
 */
export function pagesForAuthAndTarget(
  story: { id: string; pages?: string[] | null },
  pages: readonly StoryPageRef[] | null | undefined,
): StoryPageRef[] {
  const all = pages ?? []
  const ids = new Set(story.pages ?? [])
  const linked = ids.size > 0 ? all.filter((page) => ids.has(page.id)) : []
  return linked.length > 0 ? linked : all.filter((page) => page.user_story === story.id)
}

const GUEST_PERSONA = /\b(guest|anonymous|visitor|public|unauthenticated|logged[ -]?out|signed[ -]?out)\b/i
const SIGNED_IN_PHRASE = /\b(logged[ -]?in|signed[ -]?in|account holder)\b/i
// Session words only. Role labels (member, subscriber, registered) stay
// schedulable unless the story or a page sets auth_required.
const SIGNED_IN_TOKEN = new Set(['admin', 'administrator', 'authenticated'])

/** True when the persona is someone who already has a session. */
function personaImpliesSignedIn(persona: string | null | undefined): boolean {
  const text = persona?.trim() ?? ''
  if (!text || GUEST_PERSONA.test(text)) return false
  if (SIGNED_IN_PHRASE.test(text)) return true
  return text.toLowerCase().split(/[^a-z0-9]+/).some((token) => SIGNED_IN_TOKEN.has(token))
}

function storyNeedsSignIn(story: StoryAuthHint | null | undefined, linkedPageCount: number): boolean {
  if (story?.auth_required === true) return true
  if (story?.auth_required === false) return false
  if (linkedPageCount > 0) return false
  return personaImpliesSignedIn(story?.persona)
}

export function storedQaStoryScript(input: {
  playwright: string
  firecrawlActions?: string | null
  pages: readonly StoryPageRef[]
  baseUrls?: Array<string | null | undefined>
  story?: StoryAuthHint | null
}): StoredQaStoryScript {
  const local: StoredQaStoryScript = {
    script: input.playwright,
    script_lang: 'playwright-ts',
    browser_provider: 'local',
    target_url: null,
  }
  // Omitted page auth_required is not a login wall. An empty page list is
  // not either, unless the story itself says the user is signed in.
  if (input.pages.some((page) => page.auth_required === true)) return local
  if (storyNeedsSignIn(input.story, input.pages.length)) return local
  const script = usableFirecrawlScript(input.firecrawlActions)
  if (!script) return local
  const target = cloudTarget(input.baseUrls, input.pages)
  if (!target) return local
  return {
    script,
    script_lang: 'firecrawl-actions',
    browser_provider: 'firecrawl_actions',
    target_url: target,
  }
}

/** qa_stories insert. `target_url` is omitted when the stored row has none. */
export function qaStoryInsertRow(input: {
  projectId: string
  name: string
  prompt: string
  stored: StoredQaStoryScript
  approvalStatus: QaStoryInsertRow['approval_status']
  automationMode: QaStoryInsertRow['automation_mode']
  storyId: string
  generationModel: string
}): QaStoryInsertRow {
  return {
    project_id: input.projectId,
    name: input.name,
    prompt: input.prompt,
    script: input.stored.script,
    script_lang: input.stored.script_lang,
    browser_provider: input.stored.browser_provider,
    ...(input.stored.target_url ? { target_url: input.stored.target_url } : {}),
    source: 'test_gen_from_story',
    approval_status: input.approvalStatus,
    automation_mode: input.automationMode,
    origin_story_node_id: input.storyId,
    generation_model: input.generationModel,
    enabled: input.automationMode === 'auto',
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
