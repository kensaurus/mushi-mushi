/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SdkInstallConfigurator } from './SdkInstallConfigurator'
import { DEFAULT_SDK_CONFIG, type Framework } from '../../lib/sdkSnippets'

let root: Root | null = null
let host: HTMLDivElement | null = null

function mount(framework: Framework, lockInCode = false, onLockInCodeChange = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      createElement(SdkInstallConfigurator, {
        config: DEFAULT_SDK_CONFIG,
        enabled: true,
        framework,
        onEnabledChange: () => {},
        onChange: () => {},
        lockInCode,
        onLockInCodeChange,
      }),
    ),
  )
  return onLockInCodeChange
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('Lock these settings in my code', () => {
  it('is off by default on web frameworks and says the console decides', () => {
    const onLock = mount('react')
    const box = host!.querySelector<HTMLInputElement>('[data-testid="lock-in-code"]')!
    expect(box.checked).toBe(false)
    expect(host!.querySelector('[data-testid="code-wins-note"]')!.textContent).toContain('without a redeploy')
    act(() => box.click())
    expect(onLock).toHaveBeenCalledWith(true)
  })

  it('when on, says the code value wins', () => {
    mount('loader', true)
    expect(host!.querySelector('[data-testid="code-wins-note"]')!.textContent).toContain("your code's value wins")
  })

  it('is not offered for mobile snippets, which always carry their options', () => {
    mount('expo')
    expect(host!.querySelector('[data-testid="lock-in-code"]')).toBeNull()
    expect(host!.querySelector('[data-testid="code-wins-note"]')!.textContent).toContain("your code's value wins")
  })
})
