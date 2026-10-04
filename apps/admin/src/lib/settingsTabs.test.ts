/**
 * FILE: apps/admin/src/lib/settingsTabs.test.ts
 * PURPOSE: Settings went from seven tabs to five. Old links (bookmarks, the
 *          server's `?tab=firecrawl` / `?tab=keys`) and tabs remembered in
 *          localStorage must still open the right tab and section.
 */

import { describe, expect, it } from 'vitest'
import { SETTINGS_TAB_IDS } from '../components/settings/types'
import { isStoredSettingsTab, normalizeSettingsLocation, resolveSettingsTab } from './settingsTabs'

const OLD_IDS = ['firecrawl', 'browserbase', 'health', 'dev', 'keys']
import { SETTINGS_TAB_DESCRIPTIONS, SETTINGS_TAB_LABELS } from './settingsTabExplainer'

describe('SETTINGS_TAB_IDS', () => {
  it('is the five tabs, in strip order', () => {
    expect(SETTINGS_TAB_IDS).toEqual(['general', 'byok', 'tools', 'voice', 'sdk'])
  })
})

describe('resolveSettingsTab', () => {
  it('passes every real tab through with no section', () => {
    for (const id of SETTINGS_TAB_IDS) {
      expect(resolveSettingsTab(id)).toEqual({ tab: id, anchor: null })
    }
  })

  it.each([
    ['firecrawl', 'tools', 'firecrawl'],
    ['browserbase', 'tools', 'browserbase'],
    ['health', 'sdk', null],
    ['dev', 'sdk', 'debug-logging'],
    ['keys', 'byok', null],
  ])('maps the old id %s to %s (section %s)', (alias, tab, anchor) => {
    expect(resolveSettingsTab(alias)).toEqual({ tab, anchor })
  })

  it('maps every old id onto a real tab, and no old id is still a tab', () => {
    for (const alias of OLD_IDS) {
      expect(SETTINGS_TAB_IDS).toContain(resolveSettingsTab(alias)?.tab)
      expect(SETTINGS_TAB_IDS).not.toContain(alias)
    }
  })

  it('returns null for unknown values, null and object keys', () => {
    expect(resolveSettingsTab(null)).toBeNull()
    expect(resolveSettingsTab(undefined)).toBeNull()
    expect(resolveSettingsTab('')).toBeNull()
    expect(resolveSettingsTab('removed-tab')).toBeNull()
    expect(resolveSettingsTab('constructor')).toBeNull()
    expect(resolveSettingsTab('toString')).toBeNull()
    expect(resolveSettingsTab(42)).toBeNull()
  })
})

describe('isStoredSettingsTab', () => {
  it('keeps a remembered old id so it can open its new tab', () => {
    expect(isStoredSettingsTab('health')).toBe(true)
    expect(resolveSettingsTab('health')?.tab).toBe('sdk')
    expect(isStoredSettingsTab('firecrawl')).toBe(true)
    expect(resolveSettingsTab('firecrawl')?.tab).toBe('tools')
  })

  it('accepts nothing saved and real tabs, rejects anything else', () => {
    expect(isStoredSettingsTab(null)).toBe(true)
    expect(isStoredSettingsTab('sdk')).toBe(true)
    expect(isStoredSettingsTab('removed-tab')).toBe(false)
    expect(isStoredSettingsTab(7)).toBe(false)
  })
})

describe('normalizeSettingsLocation', () => {
  it('leaves canonical, missing and unknown tabs alone', () => {
    expect(normalizeSettingsLocation('?tab=tools', '')).toBeNull()
    expect(normalizeSettingsLocation('', '')).toBeNull()
    expect(normalizeSettingsLocation('?project=p1', '#spend-limits')).toBeNull()
    expect(normalizeSettingsLocation('?tab=nope', '')).toBeNull()
  })

  it('rewrites an old id to its tab and adds the section hash', () => {
    expect(normalizeSettingsLocation('?tab=firecrawl', '')).toEqual({ search: '?tab=tools', hash: '#firecrawl' })
    expect(normalizeSettingsLocation('?tab=browserbase', '')).toEqual({
      search: '?tab=tools',
      hash: '#browserbase',
    })
    expect(normalizeSettingsLocation('?tab=dev', '')).toEqual({ search: '?tab=sdk', hash: '#debug-logging' })
    expect(normalizeSettingsLocation('?tab=health', '')).toEqual({ search: '?tab=sdk', hash: '' })
    expect(normalizeSettingsLocation('?tab=keys', '')).toEqual({ search: '?tab=byok', hash: '' })
  })

  it('keeps other query params and a hash the link already had', () => {
    expect(normalizeSettingsLocation('?project=p1&tab=firecrawl&x=1', '#allowed')).toEqual({
      search: '?project=p1&tab=tools&x=1',
      hash: '#allowed',
    })
  })

  it('ignores an empty hash', () => {
    expect(normalizeSettingsLocation('?tab=firecrawl', '#')).toEqual({ search: '?tab=tools', hash: '#firecrawl' })
  })
})

describe('Settings tab labels', () => {
  it('uses short nouns for every tab', () => {
    expect(SETTINGS_TAB_LABELS).toEqual({
      general: 'General',
      byok: 'AI keys',
      tools: 'Web tools',
      voice: 'Voice reports',
      sdk: 'SDK & connection',
    })
  })

  it('describes what each tab holds', () => {
    expect(SETTINGS_TAB_DESCRIPTIONS.general).toBe(
      'Bug alerts, error tracking, your database link, how bugs are sorted, and limits',
    )
    expect(SETTINGS_TAB_DESCRIPTIONS.byok).toBe(
      'Your Anthropic, OpenAI, OpenRouter, Cursor, Firecrawl, Browserbase and Supabase keys',
    )
    expect(SETTINGS_TAB_DESCRIPTIONS.tools).toBe(
      'Firecrawl reads public web pages while diagnosing; Browserbase runs scheduled tests in a cloud browser',
    )
    expect(SETTINGS_TAB_DESCRIPTIONS.sdk).toBe(
      'Install the bug widget, check it can reach Mushi, send a test bug, and turn on debug logging',
    )
  })

  it('gives every tab a label and a description, and no two tabs the same label', () => {
    for (const id of SETTINGS_TAB_IDS) {
      expect(SETTINGS_TAB_LABELS[id]).toBeTruthy()
      expect(SETTINGS_TAB_DESCRIPTIONS[id]).toBeTruthy()
    }
    expect(new Set(Object.values(SETTINGS_TAB_LABELS)).size).toBe(SETTINGS_TAB_IDS.length)
  })
})
