import { beforeEach, describe, expect, it } from 'vitest'
import {
  deriveHasAnyProject,
  forgetHasAnyProject,
  readRememberedHasAnyProject,
  rememberHasAnyProject,
} from './projectPresence'

describe('projectPresence (console audit 2026-10-20, B1)', () => {
  beforeEach(() => {
    forgetHasAnyProject()
    window.localStorage.clear()
  })

  it('a resolved response is the truth and is remembered', () => {
    expect(deriveHasAnyProject({ has_any_project: false }, true)).toEqual({ hasAnyProject: false, resolved: true })
    expect(deriveHasAnyProject({ has_any_project: true }, false)).toEqual({ hasAnyProject: true, resolved: true })
  })

  it('a failed or pending fetch keeps the remembered answer instead of saying "no projects"', () => {
    expect(deriveHasAnyProject(null, true)).toEqual({ hasAnyProject: true, resolved: false })
    expect(deriveHasAnyProject(undefined, false)).toEqual({ hasAnyProject: false, resolved: false })
  })

  it('with nothing remembered, assumes a project exists until told otherwise', () => {
    expect(deriveHasAnyProject(null, null)).toEqual({ hasAnyProject: true, resolved: false })
  })

  it('remembers across reads and forgets on sign-out', () => {
    expect(readRememberedHasAnyProject()).toBeNull()
    rememberHasAnyProject(true)
    expect(readRememberedHasAnyProject()).toBe(true)
    expect(window.localStorage.getItem('mushi:has_any_project')).toBe('1')
    forgetHasAnyProject()
    expect(readRememberedHasAnyProject()).toBeNull()
    expect(window.localStorage.getItem('mushi:has_any_project')).toBeNull()
  })

  it('reads a value another tab wrote', () => {
    window.localStorage.setItem('mushi:has_any_project', '0')
    expect(readRememberedHasAnyProject()).toBe(false)
  })
})
