// Tests for the self-host environment-variable reference generator.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defaultOf, driftProblems, mdxCell, parseTemplate, templateNames } from './gen-env-reference.mjs'

const TEMPLATE = `# =====
# Intro that is not a note
# =====

# --- Core ---
# MUSHI_INTERNAL_CALLER_SECRET=…   # Lets pg_cron call your functions
ANTHROPIC_API_KEY=sk-ant-x

# --- Code index (optional) ---
# Files one sweep fetches. Default: 300
# MUSHI_REPO_INDEX_SWEEP_RUN_FILES=300
`

describe('parseTemplate', () => {
  it('reads sections, notes, inline comments and optional (commented) variables', () => {
    const { sections } = parseTemplate(TEMPLATE)
    assert.deepEqual(sections.map((s) => s.title), ['Core', 'Code index (optional)'])
    const core = sections[0].groups[0].vars
    assert.deepEqual(core.map((v) => [v.name, v.optional, v.inline]), [
      ['MUSHI_INTERNAL_CALLER_SECRET', true, 'Lets pg_cron call your functions'],
      ['ANTHROPIC_API_KEY', false, ''],
    ])
    assert.deepEqual(sections[1].groups[0].note, ['Files one sweep fetches. Default: 300'])
    assert.deepEqual([...templateNames(TEMPLATE)], ['MUSHI_INTERNAL_CALLER_SECRET', 'ANTHROPIC_API_KEY', 'MUSHI_REPO_INDEX_SWEEP_RUN_FILES'])
  })
})

describe('defaultOf and mdxCell', () => {
  it('finds a stated default', () => {
    assert.equal(defaultOf('Files one sweep fetches. Default: 300'), '300')
    assert.equal(defaultOf('where they go (default: this project’s own api)'), 'this project’s own api')
    assert.equal(defaultOf('Default. Absent means sales'), null)
  })
  it('escapes MDX and table syntax outside code spans only', () => {
    assert.equal(mdxCell('a|b <x> {y} *z*'), 'a\\|b &lt;x&gt; &#123;y&#125; \\*z\\*')
    assert.equal(mdxCell('see `a|<b>`'), 'see `a\\|<b>`')
  })
})

describe('driftProblems', () => {
  const names = {
    functions: new Set(['ANTHROPIC_API_KEY', 'STALE_NAME']),
    compose: new Set(['JWT_SECRET']),
    console: new Set(['VITE_SUPABASE_URL']),
  }
  it('flags a read nobody documented, a documented name nobody reads, and skips platform builtins', () => {
    const problems = driftProblems(
      {
        fnReads: new Set(['ANTHROPIC_API_KEY', 'NEW_SECRET', 'SUPABASE_URL', 'NODE_ENV']),
        fnLiterals: new Set(['ANTHROPIC_API_KEY', 'NEW_SECRET']),
        adminReads: new Set(['VITE_SUPABASE_URL', 'VITE_NEW']),
        composeVars: new Set(['JWT_SECRET', 'EXTRA']),
      },
      names,
    )
    assert.deepEqual(problems, [
      'functions read NEW_SECRET but packages/server/.env.example does not list it',
      'packages/server/.env.example lists STALE_NAME but no function reads it',
      'the console reads VITE_NEW but apps/admin/.env.example does not list it',
      'deploy/docker-compose.yml reads ${EXTRA} but deploy/.env.example does not list it',
    ])
  })
})
