/**
 * @vitest-environment jsdom
 */

/**
 * "Clear" used to reset only the error text; the page kept the chosen file
 * and "Ingest selected file" still sent it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryYamlDropzone } from './InventoryYamlDropzone'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('InventoryYamlDropzone', () => {
  it('Clear tells the page to drop the selected file', async () => {
    const onCleared = vi.fn()
    act(() => root.render(createElement(InventoryYamlDropzone, { onParsed: vi.fn(), onCleared })))
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!
    // Round 3: nothing picked, nothing to clear.
    expect(clear.disabled).toBe(true)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['schema_version: 2\n'], 'inventory.yaml', { type: 'text/yaml' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="inventory-yaml-file"]')?.textContent).toBe('inventory.yaml')
    expect(clear.disabled).toBe(false)
    await act(async () => clear.click())
    expect(onCleared).toHaveBeenCalledTimes(1)
    expect((container.querySelector('input[type="file"]') as HTMLInputElement).value).toBe('')
  })
})
