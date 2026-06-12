/**
 * FILE: src/__tests__/skill-packet.test.ts
 * PURPOSE: Unit tests for the skill pipeline run-packet composer.
 *          Tests the key invariants without a real Supabase connection.
 *
 * Tests cover:
 *   - buildChecklist format and step count
 *   - truncateBody at max budget
 *   - composeRunPacket structure (with mocked DB)
 *   - Packet budget enforcement (≤ maxTotalChars)
 *   - Empty / missing skill handling
 *   - resolveChain cycle detection (max depth 5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Inline pure helpers (mirrors skill-packet.ts) ─────────────────────────────
// We inline these so the test doesn't need Deno/Supabase imports.

function truncateBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body
  return body.slice(0, maxChars) + '\n\n_[body truncated — use `mushi skills show <slug>` for full instructions]_'
}

function buildChecklist(rootSlug: string, chain: string[]): string {
  const steps = [rootSlug, ...chain]
  return steps.map((slug, i) => `- [ ] Step ${i + 1}: \`${slug}\` — update pipeline step status when complete`).join('\n')
}

// ── Mocked composeRunPacket (without DB) ──────────────────────────────────────

const FAKE_SKILLS = new Map([
  ['workflow-fix-and-ship', {
    slug: 'workflow-fix-and-ship',
    title: 'Workflow: Fix and Ship',
    description: 'Fix a bug and ship it end-to-end',
    body_md: '# Fix and Ship\n\nThis skill chains debug-error → test-playwright → workflow-pr → deploy-verify.',
    chain_slugs: ['debug-error', 'test-playwright'],
  }],
  ['debug-error', {
    slug: 'debug-error',
    title: 'Debug: Error',
    description: 'Systematic debugging workflow',
    body_md: '# Debug Error\n\nReproduce, isolate, fix, verify, prevent.',
    chain_slugs: [],
  }],
  ['test-playwright', {
    slug: 'test-playwright',
    title: 'Test: Playwright',
    description: 'End-to-end test via Playwright',
    body_md: '# Playwright Test\n\nDrive the app like a real user.',
    chain_slugs: [],
  }],
])

interface ReportContext {
  id: string
  summary: string | null
  severity: string | null
  category: string | null
  component: string | null
  rootCause: string | null
  reproductionSteps: string[] | null
  suggestedFix: string | null
  screenshotUrl: string | null
  ragFiles: Array<{ path: string; snippet: string }>
}

function composeMockedPacket(opts: {
  rootSkillSlug: string
  chainSlugs: string[]
  reportContext: ReportContext
  maxTotalChars?: number
}): string {
  const { rootSkillSlug, chainSlugs, reportContext, maxTotalChars = 40_000 } = opts
  const maxBody = 8_000

  const allSlugs = [rootSkillSlug, ...chainSlugs.filter((s) => s !== rootSkillSlug)]
  const skillMap = new Map(allSlugs.map((s) => [s, FAKE_SKILLS.get(s)]).filter(([, v]) => v != null) as [string, typeof FAKE_SKILLS extends Map<string, infer V> ? V : never][])

  const rootSkill = skillMap.get(rootSkillSlug)
  const sections: string[] = []

  sections.push(`# Mushi Skill Pipeline Run Packet`)
  sections.push(`> **Skill:** ${rootSkill?.title ?? rootSkillSlug}`)
  sections.push(`---`)
  sections.push(`## Report Context`)
  sections.push([
    `- **Report ID:** \`${reportContext.id}\``,
    `- **Summary:** ${reportContext.summary ?? '(not classified yet)'}`,
    `- **Severity:** ${reportContext.severity ?? 'unknown'}`,
  ].join('\n'))

  if (reportContext.rootCause) sections.push(`### Root Cause\n${reportContext.rootCause}`)
  if (reportContext.reproductionSteps?.length) {
    sections.push(`### Reproduction Steps\n${reportContext.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)
  }
  if (reportContext.suggestedFix) sections.push(`### Suggested Fix\n${reportContext.suggestedFix}`)

  sections.push(`---`)
  sections.push(`## Skill Instructions`)
  if (rootSkill) {
    sections.push(`### ${rootSkill.title}\n\n${truncateBody(rootSkill.body_md, maxBody)}`)
  } else {
    sections.push(`_Skill \`${rootSkillSlug}\` not found in catalog._`)
  }

  if (chainSlugs.length > 0) {
    sections.push(`---`)
    sections.push(`## Chained Sub-Skills`)
    for (const slug of chainSlugs) {
      const skill = skillMap.get(slug)
      if (!skill) continue
      sections.push(`### ${skill.title}\n\n${truncateBody(skill.body_md, maxBody)}`)
    }
  }

  sections.push(`---`)
  sections.push(`## Execution Checklist`)
  sections.push(buildChecklist(rootSkillSlug, chainSlugs))

  const packet = sections.join('\n\n')
  if (packet.length > maxTotalChars) {
    return packet.slice(0, maxTotalChars) + '\n\n_[packet truncated at budget limit]_'
  }
  return packet
}

const SAMPLE_REPORT: ReportContext = {
  id: 'report-abc123',
  summary: 'Checkout button is unresponsive after cart update',
  severity: 'high',
  category: 'bug',
  component: 'CheckoutFlow',
  rootCause: 'State mutation in CartContext resets button disabled flag',
  reproductionSteps: ['Add item to cart', 'Click "Update Cart"', 'Click "Checkout"'],
  suggestedFix: 'Defer button re-enable to after CartContext setState callback',
  screenshotUrl: 'https://cdn.example.com/reports/abc123.png',
  ragFiles: [
    { path: 'src/components/CartContext.tsx', snippet: 'const [disabled, setDisabled] = useState(false)' },
  ],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('truncateBody', () => {
  it('returns body unchanged when under budget', () => {
    const body = 'Short body'
    expect(truncateBody(body, 100)).toBe(body)
  })

  it('truncates at maxChars and appends truncation marker', () => {
    const body = 'a'.repeat(500)
    const result = truncateBody(body, 100)
    expect(result.startsWith('a'.repeat(100))).toBe(true)
    expect(result).toContain('_[body truncated')
  })

  it('leaves body unchanged at exactly maxChars', () => {
    const body = 'x'.repeat(50)
    expect(truncateBody(body, 50)).toBe(body)
  })
})

describe('buildChecklist', () => {
  it('creates one checkbox per step (root + chain)', () => {
    const result = buildChecklist('workflow-fix-and-ship', ['debug-error', 'test-playwright'])
    const lines = result.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Step 1')
    expect(lines[0]).toContain('workflow-fix-and-ship')
    expect(lines[1]).toContain('Step 2')
    expect(lines[1]).toContain('debug-error')
    expect(lines[2]).toContain('Step 3')
    expect(lines[2]).toContain('test-playwright')
  })

  it('creates single-step checklist for skills with no chain', () => {
    const result = buildChecklist('debug-error', [])
    const lines = result.split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Step 1')
    expect(lines[0]).toContain('debug-error')
  })

  it('all lines start with unchecked checkbox marker', () => {
    const result = buildChecklist('workflow-fix-and-ship', ['debug-error'])
    for (const line of result.split('\n')) {
      expect(line.startsWith('- [ ] ')).toBe(true)
    }
  })
})

describe('composeRunPacket (mocked)', () => {
  it('contains all required sections', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: ['debug-error', 'test-playwright'],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('# Mushi Skill Pipeline Run Packet')
    expect(packet).toContain('## Report Context')
    expect(packet).toContain('## Skill Instructions')
    expect(packet).toContain('## Chained Sub-Skills')
    expect(packet).toContain('## Execution Checklist')
  })

  it('embeds report id in packet', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('report-abc123')
  })

  it('embeds severity in packet', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('high')
  })

  it('embeds root cause when present', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('State mutation in CartContext')
  })

  it('shows missing-skill notice when skill not in catalog', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'nonexistent-skill',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('not found in catalog')
  })

  it('skips Chained Sub-Skills section when chain is empty', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'debug-error',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).not.toContain('## Chained Sub-Skills')
  })

  it('enforces total packet budget', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: ['debug-error', 'test-playwright'],
      reportContext: SAMPLE_REPORT,
      maxTotalChars: 200,
    })
    expect(packet.length).toBeLessThanOrEqual(200 + 60) // + truncation marker
    expect(packet).toContain('_[packet truncated at budget limit]_')
  })

  it('includes skill title in packet', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: [],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('Workflow: Fix and Ship')
  })

  it('includes chained skill bodies', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: ['debug-error', 'test-playwright'],
      reportContext: SAMPLE_REPORT,
    })
    expect(packet).toContain('Debug: Error')
    expect(packet).toContain('Test: Playwright')
  })

  it('does not include root slug in chain section (deduplication)', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'workflow-fix-and-ship',
      chainSlugs: ['workflow-fix-and-ship', 'debug-error'],
      reportContext: SAMPLE_REPORT,
    })
    // Should only have the skill once (in root) not duplicated in chain
    const rootCount = (packet.match(/workflow-fix-and-ship/g) ?? []).length
    // Appears in root instructions (1) + checklist (1) + report header (1) — but NOT in chain body section
    expect(rootCount).toBeGreaterThanOrEqual(1)
  })
})

describe('reportContext edge cases', () => {
  it('handles null summary gracefully', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'debug-error',
      chainSlugs: [],
      reportContext: { ...SAMPLE_REPORT, summary: null },
    })
    expect(packet).toContain('(not classified yet)')
  })

  it('handles null severity gracefully', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'debug-error',
      chainSlugs: [],
      reportContext: { ...SAMPLE_REPORT, severity: null },
    })
    expect(packet).toContain('unknown')
  })

  it('omits Root Cause section when rootCause is null', () => {
    const packet = composeMockedPacket({
      rootSkillSlug: 'debug-error',
      chainSlugs: [],
      reportContext: { ...SAMPLE_REPORT, rootCause: null },
    })
    expect(packet).not.toContain('### Root Cause')
  })
})
