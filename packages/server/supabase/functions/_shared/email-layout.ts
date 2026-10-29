/**
 * FILE: packages/server/supabase/functions/_shared/email-layout.ts
 * PURPOSE: One branded layout for Mushi's own emails (the Production Check
 *          report, the lifecycle emails): an HTML body and its plain-text twin
 *          from the same blocks, so the two never say different things.
 *
 *          Email-client rules it follows: one 600px column built from tables,
 *          every style inline (Gmail drops <style> except for the dark-mode
 *          block, which Apple Mail honours), a hidden preheader, body text at
 *          15px, a button at least 44px tall, text-only branding. No <img> at
 *          all: a remote image is a tracking pixel, and a blocked one leaves a
 *          hole. Colours come from @mushi-mushi/brand (paper, ink, vermillion);
 *          the button is ink on white text, since white on vermillion is under
 *          4.5:1.
 *
 * Pure: no Deno globals, so vitest and Deno tests import it directly.
 */

export type EmailSeverity = 'high' | 'medium' | 'low'

export type EmailBlock =
  | { kind: 'p'; text: string }
  | { kind: 'findings'; rows: Array<{ severity: EmailSeverity; title: string; detail?: string }>; more?: string }
  | { kind: 'checks'; items: string[] }
  | { kind: 'pre'; text: string }
  | { kind: 'button'; label: string; url: string }
  | { kind: 'link'; label: string; url: string }

export interface EmailDoc {
  /** Inbox preview line (shown after the subject, hidden in the body). */
  preheader: string
  heading: string
  blocks: EmailBlock[]
  /** Small print under the rule: why you got it, how to stop it. */
  footer: Array<string | { label: string; url: string; before?: string }>
}

const C = {
  paper: '#f8f4ed',
  wash: '#efe7da',
  card: '#ffffff',
  ink: '#0e0d0b',
  muted: '#5c5852',
  faint: '#9a9489',
  rule: '#e4dccd',
  vermillion: '#e03c2c',
} as const

const SEVERITY: Record<EmailSeverity, { label: string; fg: string; bg: string }> = {
  high: { label: 'Fix first', fg: '#9f1c12', bg: '#fde8e5' },
  medium: { label: 'Fix soon', fg: '#7a4f00', bg: '#fcf0d2' },
  low: { label: 'Nice to fix', fg: '#44403c', bg: C.wash },
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Only http(s) and mailto links are rendered; anything else becomes '#'. */
function safeUrl(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url) ? escapeHtml(url) : '#'
}

function block(b: EmailBlock): string {
  switch (b.kind) {
    case 'p':
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink}">${escapeHtml(b.text)}</p>`
    case 'findings': {
      const rows = b.rows
        .map((r) => {
          const s = SEVERITY[r.severity]
          const detail = r.detail
            ? `<div style="margin-top:4px;font-size:14px;line-height:1.5;color:${C.muted}">${escapeHtml(r.detail)}</div>`
            : ''
          return `<tr><td style="padding:12px 0;border-top:1px solid ${C.rule}">` +
            `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:${s.fg};background:${s.bg}">${s.label}</span>` +
            `<div style="margin-top:6px;font-size:15px;line-height:1.5;font-weight:600;color:${C.ink}">${escapeHtml(r.title)}</div>${detail}</td></tr>`
        })
        .join('')
      const more = b.more
        ? `<p style="margin:4px 0 16px;font-size:14px;color:${C.muted}">${escapeHtml(b.more)}</p>`
        : ''
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-bottom:1px solid ${C.rule}">${rows}</table>${more}`
    }
    case 'checks':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${b.items
        .map(
          (i) =>
            `<tr><td width="24" valign="top" style="padding:4px 0;font-size:15px;line-height:1.5;color:#1e7a46;font-weight:700">&#10003;</td>` +
            `<td style="padding:4px 0;font-size:15px;line-height:1.5;color:${C.ink}">${escapeHtml(i)}</td></tr>`,
        )
        .join('')}</table>`
    case 'pre':
      return `<pre style="margin:0 0 16px;padding:12px 14px;background:${C.wash};border-radius:8px;font-family:${MONO};font-size:13px;line-height:1.5;color:${C.ink};white-space:pre-wrap;word-break:break-word">${escapeHtml(b.text)}</pre>`
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td class="m-btn" style="border-radius:8px;background:${C.ink}">` +
        `<a href="${safeUrl(b.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;line-height:18px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(b.label)}</a>` +
        `</td></tr></table>`
    case 'link':
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6"><a href="${safeUrl(b.url)}" style="color:${C.ink};text-decoration:underline">${escapeHtml(b.label)}</a></p>`
  }
}

function footerLine(f: EmailDoc['footer'][number]): string {
  if (typeof f === 'string') return escapeHtml(f)
  return `${f.before ? `${escapeHtml(f.before)} ` : ''}<a href="${safeUrl(f.url)}" style="color:${C.muted};text-decoration:underline">${escapeHtml(f.label)}</a>`
}

export function renderEmailHtml(doc: EmailDoc): string {
  const body = doc.blocks.map(block).join('\n')
  const footer = doc.footer
    .map((f) => `<p class="m-muted" style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${C.muted}">${footerLine(f)}</p>`)
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(doc.heading)}</title>
<style>@media (prefers-color-scheme: dark){.m-bg{background:#151412!important}.m-card{background:#1f1d1a!important;border-color:#3a3631!important;border-top-color:#e03c2c!important}.m-muted,.m-muted a{color:#bdb5a8!important}.m-ink,.m-card p,.m-card div,.m-card td,.m-card h1{color:#f3eee6!important}.m-card a{color:#f3eee6!important}.m-btn{background:#f3eee6!important}.m-btn a{color:#0e0d0b!important}}</style></head>
<body class="m-bg" style="margin:0;padding:0;background:${C.paper};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(doc.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-bg" style="background:${C.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 14px;font-size:15px;font-weight:700;color:${C.ink}" class="m-ink"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${C.vermillion};margin-right:8px;vertical-align:middle"></span><span style="vertical-align:middle">Mushi Mushi</span></td></tr>
<tr><td class="m-card" style="background:${C.card};border:1px solid ${C.rule};border-top:4px solid ${C.vermillion};border-radius:12px;padding:28px 28px 12px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${C.ink}">${escapeHtml(doc.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 4px 0">${footer}</td></tr>
</table></td></tr></table></body></html>`
}

export function renderEmailText(doc: EmailDoc): string {
  const parts: string[] = [doc.heading, '']
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'p':
        parts.push(b.text, '')
        break
      case 'findings':
        for (const r of b.rows) {
          parts.push(`[${SEVERITY[r.severity].label}] ${r.title}`)
          if (r.detail) parts.push(`  ${r.detail}`)
        }
        if (b.more) parts.push(b.more)
        parts.push('')
        break
      case 'checks':
        for (const i of b.items) parts.push(`- ${i}`)
        parts.push('')
        break
      case 'pre':
        parts.push(...b.text.split('\n').map((l) => (l ? `  ${l}` : '')), '')
        break
      case 'button':
      case 'link':
        parts.push(`${b.label}: ${b.url}`, '')
        break
    }
  }
  parts.push('--')
  for (const f of doc.footer) parts.push(typeof f === 'string' ? f : `${f.before ? `${f.before} ` : ''}${f.label}: ${f.url}`)
  return parts.join('\n')
}
