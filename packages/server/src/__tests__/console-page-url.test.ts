/**
 * The console page the server links to (CLI sign-in approval, MCP consent):
 * a self-host's own console when ADMIN_BASE_URL is set, Mushi Cloud's
 * otherwise, exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { consolePageUrlFrom } from '../../supabase/functions/_shared/console-page-url.ts'

describe('consolePageUrlFrom', () => {
  it('a self-host with ADMIN_BASE_URL sends people to its own console', () => {
    expect(consolePageUrlFrom({ mode: 'self-hosted', adminBaseUrl: 'http://localhost:6464/' }, 'cli-auth?code=AB12')).toBe('http://localhost:6464/cli-auth?code=AB12')
    expect(consolePageUrlFrom({ mode: 'self-hosted', adminBaseUrl: 'https://ops.example.com/mushi' }, '/mcp-auth?txn=1')).toBe('https://ops.example.com/mushi/mcp-auth?txn=1')
  })
  it('Mushi Cloud keeps the allowlist origin + /mushi-mushi/admin, whatever ADMIN_BASE_URL says', () => {
    expect(consolePageUrlFrom({ mode: 'hosted', adminBaseUrl: 'https://elsewhere.example.com' }, 'cli-auth?code=X')).toBe('https://kensaur.us/mushi-mushi/admin/cli-auth?code=X')
    expect(consolePageUrlFrom({ mode: 'hosted', originAllowlist: 'https://a.example.com, https://b.example.com' }, 'cli-auth?code=X')).toBe('https://a.example.com/mushi-mushi/admin/cli-auth?code=X')
  })
  it('a self-host without ADMIN_BASE_URL (or with a non-URL) falls back to the old rule', () => {
    expect(consolePageUrlFrom({ mode: 'self-hosted' }, 'cli-auth?code=X')).toBe('https://kensaur.us/mushi-mushi/admin/cli-auth?code=X')
    expect(consolePageUrlFrom({ mode: 'self-hosted', adminBaseUrl: 'javascript:alert(1)' }, 'x')).toBe('https://kensaur.us/mushi-mushi/admin/x')
  })
})
