/**
 * Every demo clip the docs embed has its three files in docs/screenshots/,
 * and no docs source points back at a GIF.
 *
 * The docs used to embed 2–8 MB demo GIFs; each page view paid that in
 * CloudFront egress. DocVideo now loads `{stem}.webm` / `.mp4` /
 * `-poster.webp`, made by scripts/marketing/demo-video.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ADMIN_SCREENSHOTS, adminDemoVideo } from '../data/admin-screenshots'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS = join(__dirname, '..')
const SCREENSHOTS = join(DOCS, '..', '..', 'docs', 'screenshots')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.(tsx?|mdx?)$/.test(name)) acc.push(full)
  }
  return acc
}

describe('docs demo clips', () => {
  const showcase = readFileSync(join(DOCS, 'components', 'DocsMediaShowcase.tsx'), 'utf8')
  const showcaseClips = showcase
    .split('<DocScreenshot')
    .filter((block) => /^\s+animated$/m.test(block))
    .map((block) => /src="([^"]+)"/.exec(block)?.[1])

  const clips = new Set([
    ...Object.entries(ADMIN_SCREENSHOTS).map(([page, entry]) => adminDemoVideo(page, entry)),
    ...showcaseClips,
  ])

  it('finds the landing showcase clips', () => {
    expect(showcaseClips).toEqual(['tour-pdca-loop', 'glotit-report-flow'])
  })

  it.each([...clips])('%s has webm, mp4 and poster', (stem) => {
    for (const file of [`${stem}.webm`, `${stem}.mp4`, `${stem}-poster.webp`]) {
      expect(existsSync(join(SCREENSHOTS, file)), file).toBe(true)
    }
  })

  it('no docs source embeds a .gif', () => {
    const offenders = ['app', 'components', 'content', 'data', 'lib']
      .flatMap((dir) => walk(join(DOCS, dir)))
      .filter((file) => !file.endsWith('demo-videos.test.ts'))
      .filter((file) => /\.gif\b/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(DOCS.length + 1))
    expect(offenders).toEqual([])
  })
})
