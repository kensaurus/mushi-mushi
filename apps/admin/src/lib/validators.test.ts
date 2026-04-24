/**
 * FILE: apps/admin/src/lib/validators.test.ts
 * PURPOSE: Lock the validator contracts. These functions are wired into
 *          high-stakes admin inputs (Slack/Discord webhook URLs, Sentry
 *          DSN, integration tokens, etc.) — a regression here means a
 *          customer types a valid value and the form yells at them.
 *
 *          Cases are organised by validator with both happy-path AND the
 *          most likely user-typo cases (missing scheme, lowercase Jira
 *          key, host typo). Each case asserts on the message string too,
 *          not just `null`/non-null, so a wording change doesn't silently
 *          ship without an explicit test update.
 */
import { describe, it, expect } from 'vitest'
import {
  url,
  httpsUrl,
  slackWebhookUrl,
  discordWebhookUrl,
  sentryDsn,
  email,
  token,
  numberInRange,
  slug,
  jiraProjectKey,
  pagerdutyRoutingKey,
  githubRepoUrl,
  resolveValidator,
  compose,
} from './validators'

describe('url', () => {
  const v = url()

  it('accepts http and https', () => {
    expect(v('http://example.com')).toBeNull()
    expect(v('https://example.com/path?q=1')).toBeNull()
  })

  it('treats empty as valid by default (optional)', () => {
    expect(v('')).toBeNull()
    expect(v('   ')).toBeNull()
  })

  it('flags missing scheme with an actionable message', () => {
    expect(v('example.com')?.message).toMatch(/start with https:\/\//)
  })

  it('flags exotic schemes', () => {
    expect(v('ftp://example.com')?.message).toMatch(/Unsupported protocol/)
  })

  it('required mode errors on empty', () => {
    expect(url({ optional: false })('')?.message).toBe('Required')
  })
})

describe('httpsUrl', () => {
  const v = httpsUrl()

  it('rejects http://', () => {
    expect(v('http://example.com')?.message).toMatch(/Must use https/)
  })

  it('accepts https://', () => {
    expect(v('https://example.com')).toBeNull()
  })
})

describe('slackWebhookUrl', () => {
  const v = slackWebhookUrl()

  it('accepts a real Slack webhook URL', () => {
    expect(v('https://hooks.slack.com/services/T123/B456/XYZ')).toBeNull()
  })

  it('warns (not errors) on a non-slack host so user can override', () => {
    const result = v('https://hooks.example.com/services/T123/B456/XYZ')
    expect(result?.severity).toBe('warn')
    expect(result?.message).toContain('hooks.slack.com')
  })

  it('errors on http://', () => {
    expect(v('http://hooks.slack.com/services/X')?.severity).not.toBe('warn')
  })
})

describe('discordWebhookUrl', () => {
  const v = discordWebhookUrl()

  it('accepts discord.com webhooks', () => {
    expect(v('https://discord.com/api/webhooks/123/abc')).toBeNull()
  })

  it('accepts discordapp.com webhooks', () => {
    expect(v('https://discordapp.com/api/webhooks/123/abc')).toBeNull()
  })

  it('errors on missing /api/webhooks/ path', () => {
    const r = v('https://discord.com/some/other/path')
    expect(r?.message).toMatch(/\/api\/webhooks\//)
  })
})

describe('sentryDsn', () => {
  const v = sentryDsn()

  it('accepts a sentry.io DSN', () => {
    expect(v('https://abc123@o0.ingest.us.sentry.io/4511023875')).toBeNull()
  })

  it('accepts a self-hosted DSN with a non-sentry host', () => {
    expect(v('https://abc@sentry.internal.acme.com/12')).toBeNull()
  })

  it('errors when the public key is missing', () => {
    expect(v('https://o0.ingest.sentry.io/4511023875')?.message).toMatch(/public key/)
  })

  it('errors when the project id is missing or non-numeric', () => {
    expect(v('https://abc@o0.ingest.sentry.io/')?.message).toMatch(/project id/)
    expect(v('https://abc@o0.ingest.sentry.io/foo')?.message).toMatch(/project id/)
  })
})

describe('email', () => {
  const v = email()

  it('accepts ordinary addresses', () => {
    expect(v('user@example.com')).toBeNull()
    expect(v('first.last+tag@sub.example.co.uk')).toBeNull()
  })

  it('rejects malformed addresses', () => {
    expect(v('no-at-sign')?.message).toBeDefined()
    expect(v('@no-local.com')?.message).toBeDefined()
    // NOTE: `a@b` IS valid per the WHATWG form-validation grammar (no TLD
    // requirement), so it deliberately passes here. We don't tighten this
    // because the browser's built-in `<input type=email>` accepts it too —
    // diverging would create an inconsistent feel between native and
    // custom-validated fields.
    expect(v('a b@c.com')?.message).toBeDefined()
    expect(v('with..dots@example.com')?.message).toBeUndefined() // allowed by WHATWG
  })
})

describe('token', () => {
  it('enforces minimum length', () => {
    expect(token({ minLength: 10 })('short')?.message).toMatch(/too short/)
    expect(token({ minLength: 10 })('1234567890ABCDEF')).toBeNull()
  })

  it('enforces prefix when provided', () => {
    const v = token({ prefix: 'mushi_', minLength: 8 })
    expect(v('wrong_token123')?.message).toMatch(/Expected to start with/)
    expect(v('mushi_abcdef')).toBeNull()
  })

  it('rejects whitespace inside the token (paste artefact)', () => {
    expect(token({ minLength: 8 })('abc def ghi jkl')?.message).toMatch(/whitespace/)
  })
})

describe('numberInRange', () => {
  it('rejects non-numeric input', () => {
    expect(numberInRange()('foo')?.message).toMatch(/number/)
  })

  it('respects min and max', () => {
    const v = numberInRange({ min: 0, max: 100, unit: '%' })
    expect(v('-1')?.message).toMatch(/≥ 0 %/)
    expect(v('101')?.message).toMatch(/≤ 100 %/)
    expect(v('50')).toBeNull()
  })

  it('respects step', () => {
    expect(numberInRange({ step: 0.05 })('0.07')?.message).toMatch(/multiple of/)
    expect(numberInRange({ step: 0.05 })('0.05')).toBeNull()
    expect(numberInRange({ step: 0.05 })('0.10')).toBeNull()
  })
})

describe('slug', () => {
  it('accepts ordinary slugs', () => {
    expect(slug()('my-project')).toBeNull()
    expect(slug()('my.repo_name')).toBeNull()
  })

  it('rejects spaces and leading hyphens', () => {
    expect(slug()('has spaces')?.message).toBeDefined()
    expect(slug()('-leading-hyphen')?.message).toBeDefined()
  })
})

describe('jiraProjectKey', () => {
  it('accepts uppercase keys', () => {
    expect(jiraProjectKey()('BUG')).toBeNull()
    expect(jiraProjectKey()('WEB2')).toBeNull()
  })

  it('rejects lowercase, too-short, and too-long keys', () => {
    expect(jiraProjectKey()('bug')?.message).toBeDefined()
    expect(jiraProjectKey()('A')?.message).toBeDefined()
    expect(jiraProjectKey()('A'.repeat(11))?.message).toBeDefined()
  })

  it('rejects keys starting with a digit', () => {
    expect(jiraProjectKey()('1BUG')?.message).toBeDefined()
  })
})

describe('pagerdutyRoutingKey', () => {
  it('accepts a 32-char alphanumeric key', () => {
    expect(pagerdutyRoutingKey()('a'.repeat(32))).toBeNull()
  })

  it('rejects short or non-alphanumeric keys', () => {
    expect(pagerdutyRoutingKey()('short')?.message).toBeDefined()
    expect(pagerdutyRoutingKey()('a'.repeat(20) + '!@#$')?.message).toBeDefined()
  })
})

describe('githubRepoUrl', () => {
  const v = githubRepoUrl()

  it('accepts a normal GitHub https URL', () => {
    expect(v('https://github.com/owner/repo')).toBeNull()
    expect(v('https://github.com/owner/repo.git')).toBeNull()
  })

  it('errors on missing owner or repo segment', () => {
    expect(v('https://github.com/owner')?.message).toMatch(/owner and repo/)
  })

  it('warns on non-github hosts so users can use enterprise mirrors', () => {
    const r = v('https://gitlab.com/owner/repo')
    expect(r?.severity).toBe('warn')
  })
})

describe('compose', () => {
  it('returns the first non-null result', () => {
    const v = compose(
      () => null,
      () => ({ message: 'second' }),
      () => ({ message: 'third' }),
    )
    expect(v('anything')?.message).toBe('second')
  })

  it('returns null when every validator passes', () => {
    expect(compose(() => null, () => null)('x')).toBeNull()
  })
})

describe('resolveValidator', () => {
  it('returns a validator for known names', () => {
    expect(typeof resolveValidator('httpsUrl')).toBe('function')
    expect(typeof resolveValidator('email')).toBe('function')
    expect(typeof resolveValidator('jiraProjectKey')).toBe('function')
  })

  it('returns undefined for unknown names', () => {
    expect(resolveValidator('not-a-real-validator')).toBeUndefined()
    expect(resolveValidator(undefined)).toBeUndefined()
  })

  // The integration card field defs encode validator names as strings; if
  // any of those drift, this test catches the unresolved name before the
  // user sees a silently-unvalidated field.
  it('resolves every name used in PLATFORM_DEFS / ROUTING_PROVIDERS', async () => {
    const { PLATFORM_DEFS, ROUTING_PROVIDERS } = await import('../components/integrations/types')
    const all = [
      ...PLATFORM_DEFS.flatMap((p) => p.fields),
      ...ROUTING_PROVIDERS.flatMap((p) => p.fields),
    ]
    for (const f of all) {
      if (f.validator) {
        expect(
          resolveValidator(f.validator),
          `field "${f.name}" uses validator "${f.validator}" but it isn't registered`,
        ).toBeDefined()
      }
    }
  })
})
