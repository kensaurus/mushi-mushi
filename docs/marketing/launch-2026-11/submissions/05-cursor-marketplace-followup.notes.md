# Notes: Cursor Marketplace follow-up email (never paste this file)

Paste file: `05-cursor-marketplace-followup.paste.md`.
- Line 1 is the **subject**.
- Everything after it is the **body**.

## Where it goes

- **To:** `marketplace-publishing@cursor.com`.
- Cursor staff said this is the follow-up channel: "You'll need to follow-up
  with marketplace-publishing@cursor.com! We cannot escalate requests from the
  forum." (Colin, Community Support Engineer, 2026-11-02, forum thread
  https://forum.cursor.com/t/176935, read through Firecrawl 2026-11-11.)
- **Do not resubmit the form.** "The form doesn't send a confirmation email …
  There's no fixed review timeline, and reviews can take a few weeks. Please
  don't resubmit the form." (Colin, 2026-10-23, forum.)
- **All marketplace plugins must be open source**, and updates are reviewed
  too (Condor, 2026-03-23, https://forum.cursor.com/t/155138). Mushi Mushi is.
- **Docs:** https://cursor.com/docs/reference/plugins. A plugin needs
  `.cursor-plugin/plugin.json` (or a root `plugin.json`) in a public repo, with
  the logo committed; then submit the repo link at
  https://cursor.com/marketplace/publish.
  - Ours is `packages/cursor-plugin/.cursor-plugin/plugin.json`.
- **One user's claim, not Cursor policy:** "rsb", who says he does not work
  for Cursor, writes that Cursor prefers plugins with uptake evidence and a
  cursor.directory listing first. We have the listing and no uptake numbers
  worth citing, so the email does not claim any.

## Before you send

- [ ] **Check the signature.** It reads "Kenji Sakuramoto / Kensaurus LLC".
  Change it if you sign differently (for example 合同会社 in full).
- [ ] **Check the hosted URL.** `packages/cursor-plugin/mcp.json` must point at
  `https://kensaur.us/mushi-mushi/hosted-mcp/`. It does on this branch
  (2026-11-11). `docs/marketing/GTM-DISTRIBUTION.md` says master once had a
  `your-project.supabase.co` placeholder: confirm master before you send.
- [ ] **Don't attach npm download numbers.** They are CI and mirrors, not
  adoption (research note §1.5).
- [ ] Send from the address the application used.

## Owner time

3 minutes.

## Kill switch

- No reply by 2026-12-09 (4 weeks): stop chasing.
- cursor.directory plus the MCP deeplink on `/connect` already cover Cursor
  users.
