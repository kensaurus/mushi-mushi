// Tests for the upload selection and compaction in deploy-edge-function.mjs.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { compactSource, functionUploadFiles, parseFingerprint, stripCommentsAndIndent } from './deploy-edge-function.mjs'

const ts = createRequire(join(fileURLToPath(new URL('../packages/server/', import.meta.url)), 'package.json'))('typescript')
const compact = (src, rel = 'supabase/functions/x/index.ts') => compactSource(ts, rel, Buffer.from(src, 'utf8')).toString('utf8')
const parse = (src) => ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

describe('functionUploadFiles', () => {
  it('uploads the function plus only the _shared files it imports, never tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'mushi-deploy-'))
    try {
      const fn = join(root, 'fn')
      const shared = join(root, '_shared')
      mkdirSync(fn, { recursive: true })
      mkdirSync(join(shared, 'deep'), { recursive: true })
      writeFileSync(join(fn, 'index.ts'), "import { a } from '../_shared/a.ts'\nconst m = await import('../_shared/lazy.ts')\n// import { nope } from '../_shared/missing.ts'\n")
      writeFileSync(join(fn, 'index.test.ts'), "import { unused } from '../_shared/only-tests.ts'\n")
      writeFileSync(join(shared, 'a.ts'), "export * from './deep/b.ts'\nexport const a = 1\nconst asset = new URL('./data.json', import.meta.url)\n")
      writeFileSync(join(shared, 'deep', 'b.ts'), 'export const b = 2\n')
      writeFileSync(join(shared, 'lazy.ts'), 'export const lazy = 3\n')
      writeFileSync(join(shared, 'data.json'), '{"k": 1}\n')
      writeFileSync(join(shared, 'unrelated.ts'), 'export const u = 4\n')
      writeFileSync(join(shared, 'only-tests.ts'), 'export const unused = 5\n')
      const got = functionUploadFiles([join(fn, 'index.ts'), join(fn, 'index.test.ts')]).map((f) => f.slice(root.length + 1).replace(/\\/g, '/')).sort()
      assert.deepEqual(got, ['_shared/a.ts', '_shared/data.json', '_shared/deep/b.ts', '_shared/lazy.ts', 'fn/index.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('compactSource', () => {
  it('drops comments and indentation but keeps every literal byte for byte', () => {
    const src = [
      '/** Doc. */',
      'export function f(x: number) {',
      '  // explain',
      '  const sql = `',
      '    select a, b -- keep this indentation',
      '      from t // not a comment inside a template',
      '  `',
      "  const s = '// also not a comment' /* inline */ + \"/* nor this */\"",
      '  const re = /\\/\\/[a-z]+/g',
      '  return { sql, s, re, x }',
      '}',
      '',
    ].join('\n')
    const out = compact(src)
    assert.ok(!out.includes('Doc.'))
    assert.ok(!out.includes('explain'))
    assert.ok(!out.includes('inline'))
    assert.ok(out.includes('    select a, b -- keep this indentation\n      from t // not a comment inside a template\n  `'))
    assert.ok(out.includes("'// also not a comment'"))
    assert.ok(out.includes('"/* nor this */"'))
    assert.ok(out.includes('/\\/\\/[a-z]+/g'))
    assert.equal(parseFingerprint(ts, parse(out)), parseFingerprint(ts, parse(src)))
  })

  it('keeps the line break a removed multi-line comment carried (return + ASI)', () => {
    const src = 'function g() {\n  return /*\n  why\n  */ 1\n}\n'
    const out = compact(src)
    // `return` followed by a line break returns undefined; the break must survive.
    assert.match(out, /return\s*\n\s*1/)
    assert.equal(parseFingerprint(ts, parse(out)), parseFingerprint(ts, parse(src)))
  })

  it('leaves files with comment directives exactly as written', () => {
    for (const src of ['// @ts-ignore\nconst a: number = "x"\n', '// @deno-types="./x.d.ts"\nimport x from "./x.js"\n', '/// <reference lib="deno.ns" />\nconst a = 1\n']) {
      assert.equal(compact(src), src)
    }
  })

  it('minifies JSON and leaves other files alone', () => {
    assert.equal(compact('{\n  "a": [1, 2]\n}\n', 'x/data.json'), '{"a":[1,2]}')
    assert.equal(compact('  raw  text\n', 'x/notes.txt'), '  raw  text\n')
  })

  it('the parse fingerprint catches a change in meaning', () => {
    // Same tokens, different parse: a line break after `return` changes the tree.
    assert.notEqual(parseFingerprint(ts, parse('function f() { return\n1 }')), parseFingerprint(ts, parse('function f() { return 1 }')))
    // And it ignores comments, which is what compaction removes.
    assert.equal(parseFingerprint(ts, parse('/** d */ const a = 1 // c\n')), parseFingerprint(ts, parse('const a = 1\n')))
  })

  it('stripCommentsAndIndent keeps a template literal that opens after a removed comment', () => {
    const src = '// lead\nconst q = `\n  keep\n    this\n`\n'
    const out = stripCommentsAndIndent(ts, parse(src), src)
    assert.ok(out.includes('`\n  keep\n    this\n`'))
  })
})
