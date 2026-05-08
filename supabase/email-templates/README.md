Supabase Auth Email Templates — Source of Truth

These HTML files are the canonical source for the auth emails sent by the
Mushi Mushi Supabase project (`dxptnwrhwsqckaftyymj`). The Supabase dashboard
is the *runtime* source — pasting from these files keeps the dashboard and
the repo in sync.

Why this folder exists
----------------------
Before this folder, the templates lived only in the Supabase dashboard. The
default templates (`<h2>Magic Link</h2><p>Follow this link to login:</p>
<p><a href="...">Log In</a></p>`) looked like phishing emails: no brand,
no preheader, no security note, generic "Log In" CTA. We rebuilt them in
the editorial Mushi Mushi voice — washi paper background, sumi ink type,
vermillion CTA, mono eyebrows — and stored them here so:

  1. Anyone can audit / diff template changes without logging into Supabase.
  2. Templates can be applied programmatically (e.g. via a `pnpm sync:email`
     script in the future).
  3. Designers can preview the HTML locally before deploying.

How to apply changes
--------------------
Manual (current process):
  1. Edit the HTML in this folder.
  2. Open https://supabase.com/dashboard/project/dxptnwrhwsqckaftyymj/auth/templates
  3. Click the corresponding template, paste the new body + subject.
  4. Click "Save changes".

⚠️  Gotcha if you automate this via Playwright/MCP:
  The dashboard wraps Monaco with a *debounced* onChange (~300 ms). If you
  call `monaco.editor.getEditors()[0].setValue(html)` and then click the
  Save button in the same tick, the PATCH ships with the **stale** body —
  the subject saves, but the body silently reverts on reload. Workaround:
  wait at least 500 ms after `setValue` so React's body state catches up,
  THEN click Save. Confirm the dirty flag flipped (the Save button became
  enabled) before clicking. Also auto-accept any `beforeunload` dialogs
  that appear when navigating between templates.

Variables (Go template syntax — Supabase substitutes at send time):
  - `{{ .ConfirmationURL }}` — the action link (verify / recover / invite).
  - `{{ .Token }}`           — the 6-digit OTP code (we don't show it; we use
                                 the link instead because the admin console
                                 doesn't have a manual code-entry screen).
  - `{{ .TokenHash }}`       — PKCE token hash (for verifyOtp flow).
  - `{{ .SiteURL }}`         — configured Site URL (e.g. https://kensaur.us/mushi-mushi/admin).
  - `{{ .Email }}`           — recipient address.
  - `{{ .Data }}`            — user metadata (use `{{ .Data.full_name }}` etc.).
  - `{{ .RedirectTo }}`      — the `redirectTo` param passed at send time.

Design system constraints (kept inline because email clients strip <link>):
  - Brand vermillion: #e03c2c   (CTA fill, brand wordmark accent)
  - Paper:           #f8f4ed   (body background)
  - Ink:             #0e0d0b   (headlines)
  - Ink muted:       #5c5852   (body copy)
  - Ink faint:       #9a9489   (security note, footer fine print)
  - Edge:            #ece4d3   (card border, fallback-link border)
  - Card surface:    #ffffff   (white card on paper)

Subjects (paste into the Subject field — NOT in the body):
  - Magic Link            → "Your Mushi Mushi sign-in link"
  - Reset Password        → "Reset your Mushi Mushi password"
  - Confirm Sign Up       → "Confirm your Mushi Mushi account"
  - Invite User           → "You've been invited to Mushi Mushi"
  - Change Email Address  → "Confirm your new Mushi Mushi email"

Email-client compatibility
--------------------------
All five templates are tested against the constraints that matter:
  - Pure inline CSS for layout; <style> only carries media queries +
    dark-mode hints (Outlook 2016 / Outlook.com strip <style>; Gmail keeps
    media queries; Apple Mail honours `prefers-color-scheme`).
  - Tables for the outermost layout (Outlook fallback).
  - Max width 560 px so the card fits a single mobile fold without
    horizontal scroll.
  - Preheader hidden via `display:none; max-height:0` so the inbox preview
    line is the security-friendly summary, not "View this email in your
    browser".
  - Buttons are bulletproof (`<a>` inside a `<td bgcolor=...>`) so Outlook
    still paints the CTA when it ignores `border-radius`.
