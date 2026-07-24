import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { detectFramework, envVarsToWrite, type PackageJson } from './detect'

/**
 * RealWorld attunement dogfood: run the CLI's framework detection against the
 * REAL Conduit fixture repos under examples/realworld/ — not synthetic
 * package.json blobs. If a fixture's dependency shape drifts (or detect's
 * ordering changes), this catches the init wizard mis-wiring a realistic app.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const FIXTURES = path.join(REPO_ROOT, 'examples', 'realworld')

function loadPkg(dir: string): PackageJson {
  return JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf-8'),
  ) as PackageJson
}

describe('CLI detect on RealWorld fixtures', () => {
  it('fixtures exist (guards against silent rename)', () => {
    for (const d of ['backend-express', 'frontend-react-vite', 'frontend-hash']) {
      expect(existsSync(path.join(FIXTURES, d, 'package.json')), d).toBe(true)
    }
  })

  it('backend-express → express → @mushi-mushi/node, bare MUSHI_* env vars', () => {
    const dir = path.join(FIXTURES, 'backend-express')
    const fw = detectFramework(dir, loadPkg(dir))
    expect(fw.id).toBe('express')
    expect(fw.packageName).toBe('@mushi-mushi/node')

    const env = envVarsToWrite('mushi_key', 'proj-id', fw, 'http://localhost:4199/functions/v1/api')
    expect(env).toContain('MUSHI_PROJECT_ID=proj-id')
    expect(env).toContain('MUSHI_API_KEY=mushi_key')
    expect(env).toContain('MUSHI_API_ENDPOINT=http://localhost:4199/functions/v1/api')
    expect(env).not.toContain('VITE_')
  })

  it('frontend-react-vite → react → @mushi-mushi/react, VITE_* env vars', () => {
    const dir = path.join(FIXTURES, 'frontend-react-vite')
    const fw = detectFramework(dir, loadPkg(dir))
    expect(fw.id).toBe('react')
    expect(fw.packageName).toBe('@mushi-mushi/react')

    const env = envVarsToWrite('mushi_key', 'proj-id', fw)
    expect(env).toContain('VITE_MUSHI_PROJECT_ID=proj-id')
    expect(env).toContain('VITE_MUSHI_API_KEY=mushi_key')
  })

  it('frontend-hash → vanilla → @mushi-mushi/web, VITE_* env vars', () => {
    const dir = path.join(FIXTURES, 'frontend-hash')
    const fw = detectFramework(dir, loadPkg(dir))
    expect(fw.id).toBe('vanilla')
    expect(fw.packageName).toBe('@mushi-mushi/web')

    const env = envVarsToWrite('mushi_key', 'proj-id', fw)
    expect(env).toContain('VITE_MUSHI_PROJECT_ID=proj-id')
  })
})
