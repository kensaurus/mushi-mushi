/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 134: the starter-questions field re-joined its value on every key,
 * so spaces and commas vanished as they were typed. QA bug 128: a failed
 * GET (members) left "Loading assistant…" on screen forever.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn() }))
vi.mock('../lib/supabase', () => api)
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AssistantConfigCard, parseStarterQuestions } from './AssistantConfigCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CFG = {
  enabled: true,
  label: 'Ask',
  greeting: null,
  suggestions: [],
  knowledge: '',
  knowledgeChars: 0,
  knowledgeCap: 40000,
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

/** Type one key at a time, the way React sees a user typing. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  for (const ch of text) {
    act(() => {
      setter.call(input, input.value + ch)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

describe('AssistantConfigCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps spaces and commas while typing, and saves the parsed list', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: CFG })
    act(() => root.render(createElement(AssistantConfigCard, { projectId: 'p1' })))
    await flush()
    const input = Array.from(container.querySelectorAll('input')).find((i) =>
      /Starter questions/.test(i.closest('label')?.textContent ?? i.getAttribute('aria-label') ?? ''),
    ) ?? (Array.from(container.querySelectorAll('input')) as HTMLInputElement[])[2]
    typeInto(input as HTMLInputElement, 'How do I pay, Where is it')
    expect((input as HTMLInputElement).value).toBe('How do I pay, Where is it')

    act(() => (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save assistant') as HTMLButtonElement).click())
    await flush()
    const put = api.apiFetch.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(put[1].body).suggestions).toEqual(['How do I pay', 'Where is it'])
  })

  it('a failed load explains why instead of spinning forever', async () => {
    api.apiFetch.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only project owners and admins can view the assistant settings. Ask an owner or admin of this project.' },
    })
    act(() => root.render(createElement(AssistantConfigCard, { projectId: 'p1' })))
    await flush()
    expect(container.textContent).not.toContain('Loading assistant')
    expect(container.textContent).toContain('Only project owners and admins')
  })

  it('parseStarterQuestions trims, drops empties and caps at six', () => {
    expect(parseStarterQuestions(' a ,, b,c,d,e,f,g ')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})
