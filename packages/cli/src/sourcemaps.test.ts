import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findMapFiles } from './sourcemaps.js'

function makeTmp(): string {
  const dir = join(
    tmpdir(),
    `mushi-sourcemaps-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('findMapFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTmp()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty array when the directory is empty', async () => {
    const result = await findMapFiles(dir)
    expect(result).toEqual([])
  })

  it('finds .js.map files at the top level', async () => {
    writeFileSync(join(dir, 'bundle.js.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/bundle\.js\.map$/)
  })

  it('finds .css.map files at the top level', async () => {
    writeFileSync(join(dir, 'styles.css.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/styles\.css\.map$/)
  })

  it('finds map files recursively in subdirectories', async () => {
    mkdirSync(join(dir, 'assets', 'js'), { recursive: true })
    mkdirSync(join(dir, 'assets', 'css'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'js', 'app.js.map'), '{}')
    writeFileSync(join(dir, 'assets', 'css', 'main.css.map'), '{}')
    writeFileSync(join(dir, 'assets', 'js', 'vendor.js.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(3)
  })

  it('ignores non-.map files', async () => {
    writeFileSync(join(dir, 'bundle.js'), 'console.log(1)')
    writeFileSync(join(dir, 'bundle.js.map'), '{}')
    writeFileSync(join(dir, 'readme.txt'), 'hello')
    writeFileSync(join(dir, 'data.json'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/\.map$/)
  })

  it('ignores .map files that are not .js.map or .css.map', async () => {
    writeFileSync(join(dir, 'data.json.map'), '{}')
    writeFileSync(join(dir, 'app.ts.map'), '{}')
    writeFileSync(join(dir, 'app.js.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/app\.js\.map$/)
  })

  it('handles deeply nested directories', async () => {
    const deep = join(dir, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'chunk.js.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/chunk\.js\.map$/)
  })

  it('returns paths sorted deterministically (is an array, not a set)', async () => {
    writeFileSync(join(dir, 'a.js.map'), '{}')
    writeFileSync(join(dir, 'b.js.map'), '{}')
    const result = await findMapFiles(dir)
    expect(result).toHaveLength(2)
  })

  it('rejects when the directory does not exist', async () => {
    await expect(findMapFiles(join(dir, 'nonexistent'))).rejects.toThrow()
  })
})
