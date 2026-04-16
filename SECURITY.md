# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue.**

Instead, email: **security@mushimushi.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a patch within 7 days for critical issues.

## Scope

- All `@mushi-mushi/*` npm packages
- Supabase Edge Functions (server-side)
- Admin console application
- CLI tool

## Out of Scope

- Self-hosted deployments configured by the user
- Third-party integrations (Jira, Linear, PagerDuty)
- Vulnerabilities requiring physical access

## Security Best Practices for Users

- **Never commit your API keys** — use environment variables
- **Rotate API keys** regularly via the admin console
- **Enable SSO** for team projects (Enterprise tier)
- **Review audit logs** periodically for suspicious activity
