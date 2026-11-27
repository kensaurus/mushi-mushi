/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/personas/PersonaEditor.test.tsx
 * PURPOSE: The persona editor (ADR 0075):
 *   - the live preview (what the visitor will try, the brief the model reads)
 *     follows every field as it changes: a phone is 390×844, low vision is
 *     150% zoom, patience is the step cap;
 *   - what the server would refuse (a bad language code, patience or cost
 *     out of range, no name) is said in its words and nothing is sent;
 *   - a new persona is one POST with the ten fields; a change is one PATCH
 *     with only the fields that changed; nothing changed sends nothing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body: unknown }>, reply: null as unknown }))
vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetchMutate: async (path: string, opts: { method?: string; body?: string } = {}) => {
    mocks.calls.push({ path, method: opts.method ?? 'POST', body: opts.body ? JSON.parse(opts.body) : null })
    return mocks.reply ?? { ok: true, data: { persona: { name: 'Busy parent' } } }
  },
}))

import { PersonaEditor } from './PersonaEditor'
import type { Persona, PersonaFields } from '../../lib/personas'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BLANK: PersonaFields = {
  name: '',
  preset: null,
  goal: null,
  locale: 'en-US',
  device: 'desktop',
  expertise: 'new',
  accessibility: [],
  patienceSteps: 30,
  costCapUsd: 1,
  notes: null,
}

const JA: Persona = {
  id: '2000000f-0000-4000-8000-000000000001',
  name: 'Japanese visitor',
  preset: 'japanese_user',
  goal: null,
  locale: 'ja-JP',
  device: 'mobile',
  expertise: 'casual',
  accessibility: [],
  patienceSteps: 30,
  costCapUsd: 1,
  notes: null,
  brief: '',
  plays: { id: '2000000f-0000-4000-8000-000000000001', name: 'Japanese visitor', brief: '', locale: 'ja-JP', device: 'mobile', needs: [], steps: 30 },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

let host: HTMLDivElement
let root: Root
const onSaved = vi.fn()
const onCancel = vi.fn()
beforeEach(() => {
  mocks.calls = []
  mocks.reply = null
  onSaved.mockReset()
  onCancel.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(start: PersonaFields, persona?: Persona) {
  act(() => root.render(createElement(PersonaEditor, { projectId: P, start, persona, onSaved, onCancel })))
}

/** Set a controlled field's value the way typing does, so React's onChange runs. */
async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

const field = (label: string) =>
  [...host.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))?.querySelector('input, textarea, select') as HTMLInputElement
const select = (label: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))?.querySelector('select') as HTMLSelectElement
const slider = () => host.querySelector('input[type="range"]') as HTMLInputElement
const radio = (group: string, text: string) =>
  [...host.querySelectorAll(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)].find((r) => r.textContent?.trim() === text) as HTMLButtonElement
const need = (text: string) => [...host.querySelectorAll('[role="group"][aria-label="What they need"] button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const tries = () => [...host.querySelectorAll('[data-testid="persona-tries"] li')].map((li) => li.textContent?.trim())
const brief = () => host.querySelector('[data-testid="persona-brief"]')!.textContent ?? ''
const submit = (text: string) => [...host.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

describe('the live preview', () => {
  it('follows the name, device, needs, language, patience and goal as they change', async () => {
    render(BLANK)
    expect(brief()).toMatch(/^You are "Unnamed visitor"\. You rarely use apps like this/)
    expect(tries()[0]).toBe('Laptop, 1280×800')

    await type(field('Name'), 'Busy parent')
    expect(brief()).toMatch(/^You are "Busy parent"\./)
    expect(host.querySelector('[data-testid="persona-preview"]')!.textContent).toContain('Busy parent')

    act(() => radio('Device', 'Phone').click())
    expect(radio('Device', 'Phone').getAttribute('aria-checked')).toBe('true')
    expect(tries()[0]).toBe('Phone, 390×844, touch')
    expect(brief()).toContain('You are on a phone, tapping with your thumb.')

    act(() => need('Low vision').click())
    expect(need('Low vision').getAttribute('aria-pressed')).toBe('true')
    expect(tries()[0]).toBe('Phone at 150% zoom, 260×563 CSS px, touch')
    expect(host.querySelector('[data-testid="persona-preview"] svg[role="img"]')!.getAttribute('aria-label')).toContain('150% zoom')
    expect(brief()).toContain('You read at 150% zoom')

    act(() => need('Keyboard only').click())
    expect(tries()).toContain('Moves only with Tab, Enter and Escape')

    await type(select('Language they read'), 'ja-JP')
    expect(tries()).toContain('Browser language ja-JP (Japanese)')
    expect(brief()).toContain('You read Japanese (ja-JP) best')

    await type(slider(), '12')
    expect(host.textContent).toContain('gives up after ~12 steps')
    expect(tries()).toContain('Stops after 12 steps')
    expect(brief()).toContain('You give up after about 12 steps')

    expect(tries().at(-1)).toBe('Tries the goal you type on the test page')
    await type(field('What they came to do'), 'sign up and add a photo')
    expect(tries().at(-1)).toBe('Tries to sign up and add a photo')

    // The needs read in the server's order, whatever order they were picked in.
    expect(brief().indexOf('150% zoom')).toBeLessThan(brief().indexOf('Tab, Enter and Escape'))
  })
})

describe('what the server would refuse', () => {
  it('says so in its words and sends nothing: no name, a bad language code, cost out of range', async () => {
    render(BLANK)
    await type(select('Language they read'), 'other')
    await type(field('Language code'), 'Japanese')
    await type(field('Most a test may spend'), '25')
    await act(async () => submit('Add persona').click())
    expect(host.textContent).toContain('Give the persona a name (up to 60 characters).')
    expect(host.textContent).toContain('The language is a code like en-US or ja-JP.')
    expect(host.textContent).toContain('The cost cap is from $0.05 to $20 a test.')
    expect(field('Language code').getAttribute('aria-invalid')).toBe('true')
    expect(mocks.calls).toEqual([])
  })

  it('refuses patience out of range (an old row saved before the limits)', async () => {
    render({ ...BLANK, name: 'Old row', patienceSteps: 3 })
    await act(async () => submit('Add persona').click())
    expect(host.textContent).toContain('Patience is a whole number of steps from 5 to 80.')
    expect(slider().getAttribute('aria-invalid')).toBe('true')
    expect(mocks.calls).toEqual([])
  })

  it("shows the server's own refusal", async () => {
    mocks.reply = { ok: false, error: { code: 'NAME_TAKEN', message: 'This app already has a persona called "Busy parent". Pick another name.' } }
    render(BLANK)
    await type(field('Name'), 'Busy parent')
    await act(async () => submit('Add persona').click())
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Pick another name.')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('saving', () => {
  it('adds a new persona with one POST of the ten fields', async () => {
    render(BLANK)
    await type(field('Name'), '  Busy   parent ')
    act(() => radio('Device', 'Phone').click())
    act(() => need('Reduced motion').click())
    await act(async () => submit('Add persona').click())
    expect(mocks.calls).toEqual([
      {
        path: `/v1/admin/projects/${P}/personas`,
        method: 'POST',
        body: { name: 'Busy parent', preset: null, goal: null, locale: 'en-US', device: 'mobile', expertise: 'new', accessibility: ['reduced_motion'], patienceSteps: 30, costCapUsd: 1, notes: null },
      },
    ])
    expect(onSaved).toHaveBeenCalledWith('Busy parent')
  })

  it('sends nothing until something changes, then a PATCH with only the changed fields', async () => {
    mocks.reply = { ok: true, data: { persona: { ...JA, patienceSteps: 12, goal: 'find a lesson' } } }
    render(JA, JA)
    expect(submit('Save changes').disabled).toBe(true)
    expect(host.textContent).toContain('Nothing changed yet.')

    await type(slider(), '12')
    await type(field('What they came to do'), 'find a lesson')
    expect(submit('Save changes').disabled).toBe(false)
    await act(async () => submit('Save changes').click())
    expect(mocks.calls).toEqual([{ path: `/v1/admin/projects/${P}/personas/${JA.id}`, method: 'PATCH', body: { patienceSteps: 12, goal: 'find a lesson' } }])
    expect(onSaved).toHaveBeenCalledWith('Japanese visitor')
  })

  it('opens an existing persona with its own language picked', () => {
    render(JA, JA)
    expect(select('Language they read').value).toBe('ja-JP')
    expect(radio('Device', 'Phone').getAttribute('aria-checked')).toBe('true')
  })
})
