import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

describe('shell chrome static contract', () => {
  it('Layout uses chrome-top-row on desktop sub-header without legacy py-1.5-only chrome', () => {
    const layout = readFileSync(resolve(root, 'components/Layout.tsx'), 'utf8')
    expect(layout).toContain('chrome-top-row')
    expect(layout).toMatch(/hidden md:flex chrome-top-row items-center/)
    expect(layout).not.toMatch(/hidden md:flex items-center gap-3 px-5 py-1\.5 border-b/)
  })

  it('TesterLayout mirrors chrome-top-row on sidebar brand and sub-header', () => {
    const tester = readFileSync(resolve(root, 'components/tester/TesterLayout.tsx'), 'utf8')
    expect(tester).toContain('chrome-top-row')
    expect(tester).toMatch(/hidden chrome-top-row items-center/)
  })

  it('OrgSwitcher and ProjectSwitcher use HeaderContextChip', () => {
    const org = readFileSync(resolve(root, 'components/OrgSwitcher.tsx'), 'utf8')
    const project = readFileSync(resolve(root, 'components/ProjectSwitcher.tsx'), 'utf8')
    expect(org).toContain('HeaderContextChip')
    expect(project).toContain('HeaderContextChip')
    expect(project).toMatch(/\/>\s*\n\s*<ActiveProjectStatusChip snapshot=\{snapshot\} \/>/)
  })

  it('sidebar micro labels use text-2xs floor', () => {
    const micro = readFileSync(resolve(root, 'components/sidebar/SidebarMicroChrome.ts'), 'utf8')
    expect(micro).toContain('text-2xs')
    expect(micro).not.toContain('text-3xs')
  })
})
