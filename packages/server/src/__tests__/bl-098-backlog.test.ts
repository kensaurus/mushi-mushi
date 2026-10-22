/**
 * FILE: bl-098-backlog.test.ts
 * PURPOSE: BL-098 stays verify-done until migration 20261022010254 is applied.
 *          Closing it drops the known-bug count while unused legacy Vault
 *          secrets are still left in place.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const backlog = readFileSync(resolve(__dirname, '../../../../docs/BACKLOG.md'), 'utf8')

function section(name: string, next: string): string {
  const start = backlog.indexOf(name)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = backlog.slice(start + name.length)
  const end = rest.indexOf(next)
  return end === -1 ? rest : rest.slice(0, end)
}

function tableRows(block: string): string[][] {
  return block
    .split('\n')
    .filter((line) => line.startsWith('| BL-'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
}

function summaryCount(label: string): number {
  const match = backlog.match(new RegExp(`\\| ${label} \\| (\\d+) \\|`))
  expect(match, `summary row for ${label}`).not.toBeNull()
  return Number(match![1])
}

describe('BL-098 stays verify-done until the vault cleanup migration is applied', () => {
  const indexRows = tableRows(section('## Index', '## Recently closed'))
  const closedRows = tableRows(section('## Recently closed', '\n## '))
  const row = indexRows.find((cols) => cols[0] === 'BL-098')

  it('is an open known-bug in verify-done, citing migration 20261022010254', () => {
    expect(row).toBeDefined()
    expect(row![1]).toBe('known-bug')
    expect(row![3]).toBe('verify-done')
    expect(row![2]).toContain('until migration `20261022010254` is applied')
  })

  it('is absent from the recently closed table and the closed tally', () => {
    expect(closedRows.some((cols) => cols[0] === 'BL-098')).toBe(false)
    expect(backlog).not.toMatch(/BL-098 closed/)
    expect(backlog).not.toMatch(/BL-098 on 2026-10-22/)
  })

  it('keeps the known-bug and verify-done tallies aligned with the index', () => {
    const knownBugs = indexRows.filter((cols) => cols[1] === 'known-bug')
    const verifyDone = indexRows.filter((cols) => cols[3] === 'verify-done')
    expect(knownBugs.map((cols) => cols[0])).toContain('BL-098')
    expect(summaryCount('known-bug')).toBe(knownBugs.length)
    expect(summaryCount('known-bug')).toBeGreaterThan(0)
    expect(summaryCount('verify-done')).toBe(verifyDone.length)
    expect(verifyDone.map((cols) => cols[0])).toContain('BL-098')
  })
})
