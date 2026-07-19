/**
 * Tests for the global output-format helpers (Phase 4: `-o/--output`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  setGlobalOutputFormat,
  getGlobalOutputFormat,
  outputIsJson,
  printResult,
} from './cli-shared.js'

afterEach(() => {
  setGlobalOutputFormat('text') // reset global state between tests
  vi.restoreAllMocks()
})

describe('setGlobalOutputFormat / getGlobalOutputFormat', () => {
  it('defaults to text', () => {
    setGlobalOutputFormat(undefined)
    expect(getGlobalOutputFormat()).toBe('text')
  })

  it('sets json', () => {
    setGlobalOutputFormat('json')
    expect(getGlobalOutputFormat()).toBe('json')
  })

  it('treats any non-json value as text', () => {
    setGlobalOutputFormat('yaml')
    expect(getGlobalOutputFormat()).toBe('text')
    setGlobalOutputFormat('')
    expect(getGlobalOutputFormat()).toBe('text')
  })
})

describe('outputIsJson', () => {
  it('false by default', () => {
    setGlobalOutputFormat('text')
    expect(outputIsJson()).toBe(false)
    expect(outputIsJson(false)).toBe(false)
  })

  it('true when local --json flag is set', () => {
    setGlobalOutputFormat('text')
    expect(outputIsJson(true)).toBe(true)
  })

  it('true when global -o json is set (even without local flag)', () => {
    setGlobalOutputFormat('json')
    expect(outputIsJson()).toBe(true)
    expect(outputIsJson(false)).toBe(true) // global wins
  })
})

describe('printResult', () => {
  it('renders human output in text mode', () => {
    setGlobalOutputFormat('text')
    const render = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    printResult({ a: 1 }, { render })
    expect(render).toHaveBeenCalledWith({ a: 1 })
    expect(log).not.toHaveBeenCalled()
  })

  it('prints JSON in json mode, skipping render', () => {
    setGlobalOutputFormat('json')
    const render = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    printResult({ a: 1 }, { render })
    expect(render).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2))
  })

  it('local json flag forces JSON even in global text mode', () => {
    setGlobalOutputFormat('text')
    const render = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    printResult({ b: 2 }, { json: true, render })
    expect(render).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(JSON.stringify({ b: 2 }, null, 2))
  })
})
