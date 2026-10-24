/**
 * @vitest-environment jsdom
 *
 * A local story is not a cloud schedule. Choosing Local Playwright hides the
 * cron picker and says the story runs only via `mushi qa run`.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_QA_RUN_LABEL } from '../../lib/qaProviderGuide'
import { CreateStoryModal } from './CreateStoryModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(createElement(CreateStoryModal, { projectId: 'p1', onClose: () => {}, onCreated: () => {} }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function select(label: string): HTMLSelectElement {
  const field = [...document.body.querySelectorAll('label')].find((el) => el.textContent?.includes(label))
  const control = field?.querySelector('select')
  if (!control) throw new Error(`no select for ${label}`)
  return control
}

describe('CreateStoryModal local provider', () => {
  it('shows the cloud schedule until Local Playwright is chosen', () => {
    render()
    expect(document.body.textContent).toContain('Run schedule')
    expect(document.body.textContent).not.toContain(LOCAL_QA_RUN_LABEL)
  })

  it('hides the schedule and says the story runs only via the CLI', () => {
    render()
    const provider = select('Browser provider')
    act(() => {
      provider.value = 'local'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(document.body.textContent).toContain(LOCAL_QA_RUN_LABEL)
    expect(document.body.textContent).not.toContain('Run schedule')
  })
})
