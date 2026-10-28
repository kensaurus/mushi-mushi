import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  fixPacketFromFixContext,
  reportDetailRequestPath,
  reportFixContextRequestPath,
} from './reportDetailLoad'

const ID = 'be0ecaf0-cfee-4929-a4b4-d4a15d135acf'

describe('report detail load', () => {
  it('asks the detail route to skip the code-index embedding', () => {
    expect(reportDetailRequestPath(ID)).toBe(`/v1/admin/reports/${ID}?rag=0`)
  })

  it('loads code quotes from fix-context afterwards', () => {
    expect(reportFixContextRequestPath(ID)).toBe(`/v1/admin/reports/${ID}/fix-context`)
  })

  it('reads fix_prompt, the field fix-context returns', () => {
    const packet = '# Fix this Mushi report\n\n### `src/App.tsx`\n```\nconst x = 1\n```'
    expect(fixPacketFromFixContext({ fix_prompt: packet })).toBe(packet)
    expect(fixPacketFromFixContext({ fix_packet: packet })).toBeNull()
    expect(fixPacketFromFixContext({ fix_prompt: '   ' })).toBeNull()
    expect(fixPacketFromFixContext(null)).toBeNull()
  })

  it('is what the report page uses for the first request and the follow-up', () => {
    const page = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../pages/ReportDetailPage.tsx'),
      'utf8',
    )
    expect(page).toContain('reportDetailRequestPath(id)')
    expect(page).toContain('reportFixContextRequestPath(id)')
    expect(page).toContain('fixPacketFromFixContext(')
    expect(page).not.toContain('res.data?.fix_packet')
    expect(page).not.toContain('res.data?.fix_prompt')
  })
})
