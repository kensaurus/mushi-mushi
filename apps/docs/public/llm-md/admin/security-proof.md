# Security proof

Source: https://kensaur.us/mushi-mushi/docs/admin/security-proof

---
title: Security proof
description: Each release in Mushi Mushi shows its Security proof, the scans your own CI ran for the commit it ships. Dependencies and secrets on every PR, an optional AI review, and a weekly scan of your staging site.
---

# Security proof

**Where:** Releases → open a release → **Ship it** → Security proof

A release's Security proof answers one question: did the scans come back clean
for the commit this release ships? Your own GitHub Actions run the scanners, with
your minutes and your keys. Mushi Mushi only reads the results and files what they
find as bugs.

| Lane | Tool | When |
|---|---|---|
| Dependencies | OSV-Scanner | every PR |
| Secrets | Gitleaks (redacted, never stores the secret) | every PR |
| AI review | `claude-code-security-review`, with your own Anthropic key | opt-in, trusted authors' PRs only |
| Live site | ZAP baseline (passive) and Nuclei (non-intrusive templates) | weekly, against your staging URL |

---

## Add the workflow

1. Open a release, then **Ship it**. With no scan yet the panel offers **Open a pull
   request** (Mushi adds `.github/workflows/mushi-security.yml`) or **Copy the workflow**.
2. Add the `MUSHI_API_KEY` secret: a key bound to this app with `mcp:write`
   (**Projects → API keys**). Without it the scans still run on your PRs; nothing is sent.
3. Optional repo variables:
   - `MUSHI_SECURITY_AI_REVIEW` = `true`, and the `ANTHROPIC_API_KEY` secret, turns on the
     AI review.
   - `MUSHI_SECURITY_TRUSTED_AUTHORS`: comma-separated GitHub logins whose PRs the AI
     review may read. The default is the repo owner, plus Mushi's own fix-agent bot when
     your Mushi has a GitHub App.
   - `MUSHI_STAGING_URL`: the site the weekly scan visits. Never your production URL.

The template is in the repo at
[`docs/templates/mushi-security.yml`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/templates/mushi-security.yml).

---

## How a release is proven

- **Pin the commit.** Automatic releases take it from the deploy or release webhook.
  Otherwise paste it in the panel, or run the workflow on it from the Actions tab with
  `sha` set (the panel shows the `gh workflow run` command).
- **Proven** means the dependency and secret scans passed for that commit, and no lane
  you turned on has findings, errors or a stale run.
- **Not proven yet** means a required scan has no result for that commit. A scan that
  never ran is never shown as a pass.
- The live-site scan runs weekly, so it counts when it ran within 8 days before the
  release.

---

## What becomes a bug

Findings of medium severity and above are filed as bugs with a plain fix, one bug per
root cause, at most 10 a day (most severe first). A dependency hole that **Known holes**
already tracks is linked to that bug, not filed twice. Low findings stay on the
release's proof.

Mushi never runs the scanners itself and never uses Semgrep registry or opengrep rules.
The AI review is not hardened against prompt injection, so it never reads a fork or a
stranger's PR.

## From an agent

`get_security_proof` (MCP) returns the same lanes for a release, a commit, or the newest
commit the scans saw.
