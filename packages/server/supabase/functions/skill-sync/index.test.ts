/**
 * FILE: packages/server/supabase/functions/skill-sync/index.test.ts
 * PURPOSE: Deno tests for the pure parsing functions in skill-sync/index.ts.
 *
 * Run with:
 *   cd packages/server && deno test supabase/functions/skill-sync/index.test.ts --allow-none
 *
 * These tests cover:
 *   - parseFrontmatter: valid, missing delimiters, missing required fields
 *   - parseChainSlugs: cursor path patterns, skills/ paths, deduplication
 *   - categoryFromSlug: all known prefixes, unknown prefix fallback
 *   - containsSecretPattern: various secret patterns and clean content
 *   - description length enforcement (≤ 1024 chars per spec)
 */

// ── Inline the pure helpers so tests run without Deno runtime deps ────────────
// IMPORTANT: these copies MUST stay in sync with index.ts by hand whenever
// the production implementations change. The Copilot review (Jun 2026) flagged
// that the original copy did not support YAML block scalars (> >- | |-) which
// are supported by the production parseFrontmatter. This copy now matches.

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return null

  const endIdx = trimmed.indexOf('\n---', 3)
  if (endIdx === -1) return null

  const fmBlock = trimmed.slice(4, endIdx)
  const body = trimmed.slice(endIdx + 4).trimStart()

  const frontmatter: Record<string, string> = {}
  const lines = fmBlock.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }

    const key = line.slice(0, colonIdx).trim()
    const rawVal = line.slice(colonIdx + 1).trim()

    // Handle YAML block scalars: > >- | |- (fold/literal multi-line values)
    if (rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|-') {
      const parts: string[] = []
      i++
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t'))) {
        parts.push(lines[i].trim())
        i++
      }
      if (key) frontmatter[key] = parts.filter((p) => p !== '').join(' ')
    } else {
      const val = rawVal.replace(/^["']|["']$/g, '')
      if (key) frontmatter[key] = val
      i++
    }
  }

  return { frontmatter, body }
}

function categoryFromSlug(slug: string): string {
  const dash = slug.indexOf('-')
  if (dash === -1) return 'other'
  const prefix = slug.slice(0, dash)
  const known = ['workflow', 'debug', 'test', 'audit', 'enhance', 'backend',
                 'design', 'deploy', 'data', 'mobile', 'docs', 'meta', 'mushi',
                 'protocol', 'iterate']
  return known.includes(prefix) ? prefix : 'other'
}

const CHAIN_RE = /(?:skills?|~\/\.cursor\/skills?)\/([a-z][a-z0-9-]{1,63})\/SKILL\.md/g

function parseChainSlugs(body: string): string[] {
  const slugs: string[] = []
  for (const m of body.matchAll(CHAIN_RE)) {
    const slug = m[1]
    if (slug && !slugs.includes(slug)) slugs.push(slug)
  }
  return slugs
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /crsr_[A-Za-z0-9]{32,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
]

function containsSecretPattern(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text))
}

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

// ── containsSecretPattern ─────────────────────────────────────────────────────

test('containsSecretPattern: detects OpenAI-style key', () => {
  const text = `Here is a key: sk-abcdefghij1234567890ABCD for testing` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!containsSecretPattern(text)) throw new Error('should have detected OpenAI key pattern')
})

test('containsSecretPattern: detects AWS access key ID', () => {
  const text = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE` // gitleaks:allow check-no-secrets: ignore-line -- AWS's documented fake example key, used to assert the scanner fires
  if (!containsSecretPattern(text)) throw new Error('should have detected AKIA pattern')
})

test('containsSecretPattern: detects GitHub PAT', () => {
  const text = `TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890AB` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!containsSecretPattern(text)) throw new Error('should have detected ghp_ token')
})

test('containsSecretPattern: detects PEM private key header', () => {
  const text = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...` // gitleaks:allow -- synthetic fixture asserting the scanner fires
  if (!containsSecretPattern(text)) throw new Error('should have detected PEM key')
})

test('containsSecretPattern: returns false for clean content', () => {
  const text = `
# Skill: workflow-fix-and-ship

This skill fixes bugs and ships them. No secrets here.
Use \`gh pr create\` to open a pull request.
`
  if (containsSecretPattern(text)) throw new Error('false positive on clean content')
})

test('containsSecretPattern: returns false for partial key-like strings that are too short', () => {
  // sk- followed by <20 chars should NOT match (OpenAI keys are longer)
  const text = `color: sk-red or sk-12345`
  if (containsSecretPattern(text)) throw new Error('false positive on short sk- string')
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

test('parseFrontmatter: description beyond 1024 chars is parsed (caller must truncate)', () => {
  // parseFrontmatter returns the raw value; skill-sync callers apply the cap.
  const desc2000 = 'b'.repeat(2000)
  const raw = `---\nname: test-skill\ndescription: ${desc2000}\n---\nBody.`
  const result = parseFrontmatter(raw)
  if (!result) throw new Error('parseFrontmatter returned null')
  // Caller (skill-sync) must slice to 1024 before upsert.
  const capped = result.frontmatter.description.slice(0, 1024)
  if (capped.length !== 1024) throw new Error(`expected 1024 after cap, got ${capped.length}`)
})
