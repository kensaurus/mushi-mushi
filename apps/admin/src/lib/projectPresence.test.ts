import { beforeEach, describe, expect, it } from 'vitest'
import {
  deriveHasAnyProject,
  forgetHasAnyProject,
  readRememberedHasAnyProject,
  rememberHasAnyProject,
  statsWithProjectPresence,
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

  describe('statsWithProjectPresence', () => {
    const empty = { hasAnyProject: false, projectCount: 0, label: 'none' }

    it('no data and nothing remembered assumes a project exists', () => {
      expect(statsWithProjectPresence(null, empty)).toEqual({ ...empty, hasAnyProject: true })
      expect(statsWithProjectPresence(undefined, empty)).toEqual({ ...empty, hasAnyProject: true })
    })

    it('no data keeps a remembered "no projects"', () => {
      rememberHasAnyProject(false)
      expect(statsWithProjectPresence(null, empty)).toEqual({ ...empty, hasAnyProject: false })
    })

    it('a resolved payload wins, including hasAnyProject: false', () => {
      rememberHasAnyProject(true)
      expect(statsWithProjectPresence({ ...empty, hasAnyProject: false, projectCount: 4 }, empty)).toEqual({
        ...empty,
        hasAnyProject: false,
        projectCount: 4,
      })
    })

    it('partial data is merged over empty', () => {
      const partial = { hasAnyProject: true, projectCount: 2 } as typeof empty
      expect(statsWithProjectPresence(partial, empty)).toEqual({
        hasAnyProject: true,
        projectCount: 2,
        label: 'none',
      })
    })
  })
})
