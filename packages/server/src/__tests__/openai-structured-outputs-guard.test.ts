/**
 * FILE: openai-structured-outputs-guard.test.ts
 * PURPOSE: Stop the MUSHI-MUSHI-SERVER-1V class of outage from shipping again.
 *
 *          OpenAI's strict structured-outputs mode requires every schema key to
 *          appear in `required` — Zod `.optional()` fields therefore make the
 *          provider reject the request at call time:
 *            "Invalid schema for response_format 'response': ... Missing 'area'."
 *          The AI SDK's OpenAI provider enables strict mode by default for
 *          capable models, so any `generateObject`/`streamObject` call that
 *          routes an optional-field schema through `openai(...)` must pass
 *          `{ structuredOutputs: false }` on the model factory.
 *
 *          This bug was patched piecemeal four times (fast-filter, pdca-runner
 *          ×2, test-gen-from-story) before classify-report crashed in
 *          production with the exact same shape. This static scan enforces the
 *          invariant repo-wide instead of one outage at a time:
 *
 *          For every structured-output call block in the edge functions whose
 *          `model:` is an OpenAI factory invocation, either
 *            (a) the factory call sets `structuredOutputs: false`, or
 *            (b) the schema it references contains no `.optional(` (fully
 *                required / `.nullable()` schemas are strict-mode safe — see
 *                _shared/fix-schema.ts which documents this contract).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const FUNCTIONS_DIR = resolve(__dirname, '../../supabase/functions')

/** Recursively collect .ts sources, skipping tests and non-code assets. */
function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...collectSources(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Extract a balanced `{...}` block starting at the first `{` at/after `from`. */
function balancedBlock(src: string, from: number): string | null {
  const open = src.indexOf('{', from)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return null
}

/** Find the `const <name> = z.object({...})` definition text for a schema. */
function schemaDefinition(name: string, fileSrc: string, sharedSources: Map<string, string>): string | null {
  const rx = new RegExp(`(?:const|export const)\\s+${name}\\s*[:=]`)
  const inFile = fileSrc.match(rx)
  if (inFile && inFile.index !== undefined) {
    const block = balancedBlock(fileSrc, inFile.index)
    if (block) return block
  }
  for (const src of sharedSources.values()) {
    const m = src.match(rx)
    if (m && m.index !== undefined) {
      const block = balancedBlock(src, m.index)
      if (block) return block
    }
  }
  return null
}

interface Violation {
  file: string
  line: number
  call: string
  schemaRef: string
}

function scan(): Violation[] {
  const files = collectSources(FUNCTIONS_DIR)
  const sharedSources = new Map<string, string>()
  for (const f of files) {
    if (f.includes(`${join('functions', '_shared')}`)) {
      sharedSources.set(f, readFileSync(f, 'utf8'))
    }
  }

  const violations: Violation[] = []
  const CALL_RX = /\b(generateObject|streamObject|generateValidatedObject)\s*\(/g

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    CALL_RX.lastIndex = 0
    while ((m = CALL_RX.exec(src)) !== null) {
      const callName = m[1]
      // For generateValidatedObject(schema, {...}) the options object is the
      // second argument; balancedBlock finds the first `{` either way, which
      // for generateValidatedObject may be the schema arg — so search from the
      // call for the first `{` and, if the block lacks `model:`, take the next.
      let searchFrom = m.index
      let block = balancedBlock(src, searchFrom)
      if (block && !/\bmodel\s*:/.test(block)) {
        const next = src.indexOf('{', src.indexOf(block, searchFrom) + block.length)
        block = next === -1 ? null : balancedBlock(src, next)
      }
      if (!block || !/\bmodel\s*:/.test(block)) continue

      // OpenAI factory? Matches `model: openai(...)` and
      // `model: createOpenAI({...})(MODEL, ...)` shapes.
      const modelMatch = block.match(/model\s*:\s*([^,\n]*(?:\n[^,\n]*)?)/)
      const modelExpr = modelMatch?.[1] ?? ''
      const isOpenAi = /\bopenai\s*\(|createOpenAI\s*\([^)]*\)\s*\(/i.test(modelExpr)
      if (!isOpenAi) continue
      if (/structuredOutputs\s*:\s*false/.test(block)) continue

      // Resolve the schema this call sends.
      let schemaText: string | null = null
      let schemaRef = ''
      if (callName === 'generateValidatedObject') {
        const argMatch = src.slice(m.index).match(/generateValidatedObject\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$]*)/)
        schemaRef = argMatch?.[1] ?? ''
        schemaText = schemaRef ? schemaDefinition(schemaRef, src, sharedSources) : null
      } else {
        const sMatch = block.match(/schema\s*:\s*([A-Za-z_$][\w$]*)/)
        if (sMatch) {
          schemaRef = sMatch[1]
          if (schemaRef === 'z') {
            // Inline z.object({...}) — inspect the call block itself.
            schemaText = block
          } else {
            schemaText = schemaDefinition(schemaRef, src, sharedSources)
          }
        } else if (/schema\s*:\s*z\./.test(block)) {
          schemaRef = '(inline)'
          schemaText = block
        }
      }
      // No schema at all (generateText-like usage caught by the regex) → safe.
      if (!schemaText && !schemaRef) continue

      // Unresolvable schema reference: fail closed — require the option.
      const hasOptional = schemaText === null || /\.optional\s*\(/.test(schemaText)
      if (hasOptional) {
        const line = src.slice(0, m.index).split('\n').length
        violations.push({ file, line, call: callName, schemaRef: schemaRef || '(unknown)' })
      }
    }
  }
  return violations
}

describe('OpenAI structured-outputs guard (MUSHI-MUSHI-SERVER-1V)', () => {
  it('every OpenAI structured-output call with an optional-field schema passes structuredOutputs:false', () => {
    const violations = scan()
    const detail = violations
      .map((v) => `  ${basename(v.file)}:${v.line} ${v.call}(schema: ${v.schemaRef})`)
      .join('\n')
    expect(
      violations,
      `OpenAI strict structured-outputs rejects .optional() schema fields at call time.\n` +
        `Add { structuredOutputs: false } to the openai(model, ...) factory call (see fast-filter/index.ts), ` +
        `or make the schema fully required/.nullable().\nViolations:\n${detail}`,
    ).toEqual([])
  })

  it('the classify-report Stage 2 fallback keeps the fix in place', () => {
    const src = readFileSync(join(FUNCTIONS_DIR, 'classify-report', 'index.ts'), 'utf8')
    expect(src).toMatch(/openai\(FALLBACK_MODEL,\s*\{\s*structuredOutputs:\s*false\s*\}\)/)
  })
})
