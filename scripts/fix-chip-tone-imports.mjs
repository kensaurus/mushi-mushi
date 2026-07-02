#!/usr/bin/env node
/** Fix CHIP_TONE imports inserted mid-block by codemod. */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ADMIN_SRC = join(process.cwd(), 'apps/admin/src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

let fixed = 0
for (const file of walk(ADMIN_SRC)) {
  let src = readFileSync(file, 'utf8')
  const broken = /import \{\nimport \{ CHIP_TONE \} from '([^']+)'\n/m
  if (!broken.test(src)) continue
  src = src.replace(
    /import \{\nimport \{ CHIP_TONE \} from '([^']+)'\n/g,
    'import {\n',
  )
  // Ensure CHIP_TONE import exists once after first import block if file uses CHIP_TONE
  if (src.includes('CHIP_TONE') && !/import \{ CHIP_TONE \}/.test(src)) {
    const chipPath = file.includes('rewards/tabs')
      ? '../../../lib/chipTone'
      : file.includes('components/')
        ? '../lib/chipTone'.replace(/^/, file.split('components/')[1].includes('/') ? '../../'.repeat(file.split('components/')[1].split('/').length - 1) : '../')
        : '../lib/chipTone'
    // simpler: extract from original
    const m = readFileSync(file, 'utf8').match(/import \{ CHIP_TONE \} from '([^']+)'/)
    const importLine = `import { CHIP_TONE } from '${m?.[1] ?? '../lib/chipTone'}'\n`
    const firstImportEnd = src.indexOf('\n', src.indexOf('\nimport ') + 1)
    // insert after last import in first group - find line after closing } from
    const importClose = src.match(/^import \{[\s\S]*?\} from '[^']+'\n/m)
    if (importClose) {
      const idx = src.indexOf(importClose[0]) + importClose[0].length
      src = src.slice(0, idx) + importLine + src.slice(idx)
    }
  }
  // Remove duplicate CHIP_TONE imports
  const lines = src.split('\n')
  let seenChip = false
  const cleaned = lines.filter((line) => {
    if (/^import \{ CHIP_TONE \}/.test(line)) {
      if (seenChip) return false
      seenChip = true
    }
    return true
  })
  src = cleaned.join('\n')
  writeFileSync(file, src)
  fixed++
}
console.log(`Fixed import blocks in ${fixed} files`)
