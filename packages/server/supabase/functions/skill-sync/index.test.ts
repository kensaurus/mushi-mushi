/**
 * FILE: packages/server/supabase/functions/skill-sync/index.test.ts
 * PURPOSE: Deno tests for the pure parsing functions skill-sync uses
 *          (_shared/skill-frontmatter.ts), imported, not copied.
 *
 * Run with:
 *   cd packages/server && deno test supabase/functions/skill-sync/index.test.ts --allow-none
 *
 * These tests cover:
 *   - parseFrontmatter: valid, missing delimiters, missing required fields
 *   - parseChainSlugs: cursor path patterns, skills/ paths, deduplication
 *   - categoryFromSlug: all known prefixes, unknown prefix fallback
 *   - scanForSecrets (the shared _shared/secret-scan.ts guard skill-sync uses):
 *     various secret patterns and clean content
 *   - description length enforcement (≤ 1024 chars per spec)
 */

import { scanForSecrets } from '../_shared/secret-scan.ts'

import { capSkillDescription, categoryFromSlug, parseChainSlugs, parseFrontmatter } from '../_shared/skill-frontmatter.ts'

// ── Tests ─────────────────────────────────────────────────────────────────────

const { test } = Deno

// ── parseFrontmatter ──────────────────────────────────────────────────────────

test('parseFrontmatter: parses a valid SKILL.md frontmatter', () => {
  const raw = `---
name: workflow-fix-and-ship
description: Fix a bug and ship it end-to-end
license: MIT
---

# Workflow: Fix and Ship

This skill chains debug-error → test-playwright → workflow-pr → deploy-verify.
`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('expected result, got null')
  const { frontmatter, body } = result

  if (frontmatter.name !== 'workflow-fix-and-ship') {
    throw new Error(`name: expected 'workflow-fix-and-ship', got '${frontmatter.name}'`)
  }
  if (frontmatter.description !== 'Fix a bug and ship it end-to-end') {
    throw new Error(`description mismatch: '${frontmatter.description}'`)
  }
  if (frontmatter.license !== 'MIT') {
    throw new Error(`license: expected 'MIT', got '${frontmatter.license}'`)
  }
  if (!body.includes('# Workflow: Fix and Ship')) {
    throw new Error(`body should include heading, got: '${body.slice(0, 80)}'`)
  }
})

test('parseFrontmatter: returns null when no opening delimiter', () => {
  const raw = `name: no-delimiter\ndescription: missing dashes\n\n# Body`
  const result = parseFrontmatter(raw)
  if (result !== null) throw new Error('expected null for missing delimiter')
})

test('parseFrontmatter: handles YAML fold block scalar (>) in description', () => {
  // Production index.ts supports block scalars so long descriptions can be
  // multi-line. This test pins the behaviour of the inlined copy.
  const raw = `---
name: test-skill
description: >
  This is a folded
  multi-line description
  that spans several lines.
license: MIT
---

# Body here
`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('expected result, got null')
  const desc = result.frontmatter.description
  if (!desc.includes('folded') || !desc.includes('multi-line')) {
    throw new Error(`fold scalar not parsed: '${desc}'`)
  }
  // Folded lines are joined with a space (no newlines in the value)
  if (desc.includes('\n')) throw new Error('fold scalar must not contain newlines')
})

test('parseFrontmatter: returns null when closing delimiter is missing', () => {
  const raw = `---\nname: unclosed\ndescription: no closing\n\n# Body`
  const result = parseFrontmatter(raw)
  if (result !== null) throw new Error('expected null for unclosed frontmatter')
})

test('parseFrontmatter: strips surrounding quotes from values', () => {
  const raw = `---\nname: "quoted-name"\ndescription: 'single-quoted'\n---\n\n# Body`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('expected result')
  if (result.frontmatter.name !== 'quoted-name') {
    throw new Error(`expected 'quoted-name', got '${result.frontmatter.name}'`)
  }
  if (result.frontmatter.description !== 'single-quoted') {
    throw new Error(`expected 'single-quoted', got '${result.frontmatter.description}'`)
  }
})

test('parseFrontmatter: handles empty body after frontmatter', () => {
  const raw = `---\nname: empty-body\ndescription: no body\n---\n`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('expected result')
  if (result.body !== '') throw new Error(`expected empty body, got '${result.body}'`)
})

test('parseFrontmatter: leading whitespace is trimmed from raw input', () => {
  const raw = `\n\n---\nname: leading-space\ndescription: padded\n---\n\n# Body`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('expected result despite leading whitespace')
  if (result.frontmatter.name !== 'leading-space') {
    throw new Error(`name mismatch: '${result.frontmatter.name}'`)
  }
})

// ── categoryFromSlug ──────────────────────────────────────────────────────────

test('categoryFromSlug: known prefix workflow', () => {
  const cat = categoryFromSlug('workflow-fix-and-ship')
  if (cat !== 'workflow') throw new Error(`expected 'workflow', got '${cat}'`)
})

test('categoryFromSlug: known prefix debug', () => {
  const cat = categoryFromSlug('debug-error')
  if (cat !== 'debug') throw new Error(`expected 'debug', got '${cat}'`)
})

test('categoryFromSlug: known prefix mushi', () => {
  const cat = categoryFromSlug('mushi-health')
  if (cat !== 'mushi') throw new Error(`expected 'mushi', got '${cat}'`)
})

test('categoryFromSlug: unknown prefix returns other', () => {
  const cat = categoryFromSlug('custom-my-tool')
  if (cat !== 'other') throw new Error(`expected 'other', got '${cat}'`)
})

test('categoryFromSlug: slug with no dash returns other', () => {
  const cat = categoryFromSlug('nodash')
  if (cat !== 'other') throw new Error(`expected 'other', got '${cat}'`)
})

test('categoryFromSlug: known prefix audit', () => {
  const cat = categoryFromSlug('audit-security')
  if (cat !== 'audit') throw new Error(`expected 'audit', got '${cat}'`)
})

// ── parseChainSlugs ───────────────────────────────────────────────────────────

test('parseChainSlugs: extracts slugs from cursor skills path', () => {
  const body = `
## How to use
Read \`~/.cursor/skills/debug-error/SKILL.md\` and follow it.
Then read \`~/.cursor/skills/test-playwright/SKILL.md\` and follow it.
Then read \`~/.cursor/skills/workflow-pr/SKILL.md\` and follow it.
`
  const slugs = parseChainSlugs(body)
  if (!slugs.includes('debug-error')) throw new Error('expected debug-error in chain')
  if (!slugs.includes('test-playwright')) throw new Error('expected test-playwright in chain')
  if (!slugs.includes('workflow-pr')) throw new Error('expected workflow-pr in chain')
  if (slugs.length !== 3) throw new Error(`expected 3 slugs, got ${slugs.length}: ${JSON.stringify(slugs)}`)
})

test('parseChainSlugs: extracts slugs from skills/ path format', () => {
  const body = `Read skill/deploy-verify/SKILL.md to run post-deploy checks.`
  const slugs = parseChainSlugs(body)
  if (!slugs.includes('deploy-verify')) throw new Error('expected deploy-verify')
})

test('parseChainSlugs: deduplicates repeated slugs', () => {
  const body = `
Read \`skills/debug-error/SKILL.md\` first.
Later: read \`skills/debug-error/SKILL.md\` again for reference.
`
  const slugs = parseChainSlugs(body)
  const count = slugs.filter((s) => s === 'debug-error').length
  if (count !== 1) throw new Error(`expected 1 occurrence of debug-error, got ${count}`)
})

test('parseChainSlugs: returns empty array when no chain references', () => {
  const body = `This skill has no chained sub-skills. Just do the work.`
  const slugs = parseChainSlugs(body)
  if (slugs.length !== 0) throw new Error(`expected empty array, got ${JSON.stringify(slugs)}`)
})

test('parseChainSlugs: handles both path formats in the same body', () => {
  const body = `
Read \`~/.cursor/skills/workflow-fix-and-ship/SKILL.md\`.
Also see skills/test-unit/SKILL.md.
`
  const slugs = parseChainSlugs(body)
  if (!slugs.includes('workflow-fix-and-ship')) throw new Error('missing workflow-fix-and-ship')
  if (!slugs.includes('test-unit')) throw new Error('missing test-unit')
})

// ── scanForSecrets (shared guard) ─────────────────────────────────────────────────

test('scanForSecrets: detects OpenAI-style key', () => {
  const text = `Here is a key: sk-abcdefghij1234567890ABCD for testing` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!scanForSecrets(text)) throw new Error('should have detected OpenAI key pattern')
})

test('scanForSecrets: detects AWS access key ID', () => {
  const text = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE` // gitleaks:allow check-no-secrets: ignore-line -- AWS's documented fake example key, used to assert the scanner fires
  if (!scanForSecrets(text)) throw new Error('should have detected AKIA pattern')
})

test('scanForSecrets: detects GitHub PAT', () => {
  const text = `TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890AB` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!scanForSecrets(text)) throw new Error('should have detected ghp_ token')
})

test('scanForSecrets: detects PEM private key header', () => {
  const text = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!scanForSecrets(text)) throw new Error('should have detected PEM key')
})

test('scanForSecrets: returns false for clean content', () => {
  const text = `
# Skill: workflow-fix-and-ship

This skill fixes bugs and ships them. No secrets here.
Use \`gh pr create\` to open a pull request.
`
  if (scanForSecrets(text)) throw new Error('false positive on clean content')
})

test('scanForSecrets: returns false for partial key-like strings that are too short', () => {
  // sk- followed by <20 chars should NOT match (OpenAI keys are longer)
  const text = `color: sk-red or sk-12345`
  if (scanForSecrets(text)) throw new Error('false positive on short sk- string')
})

// ── Description length enforcement ───────────────────────────────────────────
// The production skill-sync enforces a 1024-char cap on `description` before
// upserting into agent_skills (per Agent Skills spec). These tests verify the
// SKILL.md parsing path that feeds the description field — specifically that a
// description longer than 1024 chars in frontmatter is treated as too long and
// that a 1024-char description is accepted exactly at the boundary.

test('parseFrontmatter: description at exactly 1024 chars is valid', () => {
  const desc1024 = 'a'.repeat(1024)
  const raw = `---\nname: test-skill\ndescription: ${desc1024}\n---\nBody.`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('parseFrontmatter returned null for valid input')
  if (result.frontmatter.description !== desc1024) throw new Error('description mismatch')
  if (result.frontmatter.description.length !== 1024) throw new Error(`expected 1024, got ${result.frontmatter.description.length}`)
})

test('parseFrontmatter: description beyond 1024 chars is parsed; capSkillDescription cuts it', () => {
  // parseFrontmatter returns the raw value; skill-sync stores capSkillDescription(desc).
  const desc2000 = 'b'.repeat(2000)
  const raw = `---\nname: test-skill\ndescription: ${desc2000}\n---\nBody.`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('parseFrontmatter returned null')
  if (result.frontmatter.description.length !== 2000) throw new Error('parseFrontmatter should not truncate')
  const capped = capSkillDescription(result.frontmatter.description)
  if (capped !== desc2000.slice(0, 1024)) throw new Error(`expected the first 1024 chars, got ${capped.length}`)
  if (capSkillDescription('short') !== 'short') throw new Error('a short description must pass through')
})
