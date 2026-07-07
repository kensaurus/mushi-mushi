import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ENTRY_CANDIDATES,
  MUSHI_MARKER_END,
  MUSHI_MARKER_START,
  findSdkImport,
  injectSnippet,
} from './snippet-inject.js'

const SNIPPET = `import { Mushi } from '@mushi-mushi/web'\nMushi.init({ projectId: 'x', apiKey: 'y' })`

describe('injectSnippet', () => {
  it('prepends a marker block when none exists', () => {
    const out = injectSnippet(`console.log('app')\n`, SNIPPET)
    expect(out.startsWith(MUSHI_MARKER_START)).toBe(true)
    expect(out).toContain(MUSHI_MARKER_END)
    expect(out).toContain("console.log('app')")
  })

  it('is idempotent — re-running replaces the block, never duplicates', () => {
    const once = injectSnippet(`console.log('app')\n`, SNIPPET)
    const twice = injectSnippet(once, SNIPPET)
    expect(twice.match(new RegExp(MUSHI_MARKER_START.replace(/[/<>]/g, '\\$&'), 'g'))).toHaveLength(1)
    expect(twice).toBe(once)
  })

  it('replaces the block content when the snippet changes', () => {
    const once = injectSnippet(`app()\n`, SNIPPET)
    const updated = injectSnippet(once, `// new snippet`)
    expect(updated).toContain('// new snippet')
    expect(updated).not.toContain('Mushi.init')
    expect(updated).toContain('app()')
  })

  it('preserves a shebang line at the top', () => {
    const out = injectSnippet(`#!/usr/bin/env node\napp()\n`, SNIPPET)
    expect(out.startsWith('#!/usr/bin/env node\n')).toBe(true)
    expect(out.indexOf(MUSHI_MARKER_START)).toBeGreaterThan(0)
  })

  it('strips orphaned half-markers instead of nesting blocks', () => {
    const corrupted = `${MUSHI_MARKER_START}\napp()\n` // END marker lost
    const out = injectSnippet(corrupted, SNIPPET)
    const starts = out.split('\n').filter((l) => l.includes(MUSHI_MARKER_START))
    expect(starts).toHaveLength(1)
    expect(out).toContain('app()')
  })
})

describe('findSdkImport', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('finds an @mushi-mushi import in src/', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mushi-inject-'))
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'main.tsx'), `import { MushiProvider } from '@mushi-mushi/react'`)
    const hit = await findSdkImport(dir)
    expect(hit?.file).toContain('main.tsx')
  })

  it('returns null when nothing references the SDK', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mushi-inject-'))
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'main.ts'), `console.log('no sdk here')`)
    expect(await findSdkImport(dir)).toBeNull()
  })

  it('skips node_modules', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mushi-inject-'))
    await mkdir(join(dir, 'src', 'node_modules'), { recursive: true })
    await writeFile(join(dir, 'src', 'node_modules', 'x.ts'), `import '@mushi-mushi/web'`)
    await writeFile(join(dir, 'src', 'app.ts'), `export {}`)
    expect(await findSdkImport(dir)).toBeNull()
  })
})

describe('ENTRY_CANDIDATES', () => {
  it('only lists frameworks with order-independent init (no JSX providers)', () => {
    expect(Object.keys(ENTRY_CANDIDATES)).toEqual(['vanilla'])
  })
})
