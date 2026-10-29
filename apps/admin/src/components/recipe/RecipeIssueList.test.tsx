/**
 * FILE: apps/admin/src/components/recipe/RecipeIssueList.test.tsx
 * PURPOSE: Token-issue rows keep the full file path on a wrapping line so a
 *          phone-width page does not clip it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { RecipeIssue } from '../../lib/recipeTypes'
import { RecipeIssueList } from './RecipeIssueList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LONG_FILE = 'packages/design-system/tokens/color/semantic.tokens.json'

describe('RecipeIssueList', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  function render(issues: RecipeIssue[]) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root?.render(createElement(RecipeIssueList, { issues }))
    })
  }

  it('puts a long token-file path on its own wrapping line', () => {
    render([
      {
        severity: 'warn',
        code: 'token_duplicate',
        message: 'defined in two files; the later file wins.',
        file: LONG_FILE,
        path: 'color.action.primary',
      },
    ])
    const path = host?.querySelector('li > span.basis-full')
    expect(path?.textContent).toBe(`${LONG_FILE} · color.action.primary`)
    expect(path?.className).toContain('wrap-break-word')
    expect(path?.className).toContain('min-w-0')
  })
})
