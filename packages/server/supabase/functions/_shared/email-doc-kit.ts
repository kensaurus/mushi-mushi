/**
 * FILE: packages/server/supabase/functions/_shared/email-doc-kit.ts
 * PURPOSE: Render an email-layout.ts EmailDoc on the KENSAURUS email kit
 *          (`renderMail`, yen-yen ADR 0100), so a template written as an
 *          EmailDoc moves to the kit without rewriting its words.
 *
 * The kit has no severity pill or check list, so:
 *   findings  → one paragraph per row, "[Fix first] <title>" then the detail
 *   checks    → one paragraph of "- <item>" lines
 *   pre       → the kit's monospace code block (line breaks kept)
 *   link      → a "<label>: <url>" line (the kit has one button style)
 *   footer    → small notes above the kit's fixed sender footer
 * Text parts keep email-layout.ts's shapes ("[Fix first] …", "- …"), so the
 * plain-text twin reads the same as before.
 *
 * Pure: no Deno globals, so vitest and Deno tests import it directly.
 */
import { renderMail, type MailBlock, type RenderedMail } from './kensaurus-spine/mail.ts'
import type { EmailDoc, EmailSeverity } from './email-layout.ts'

const SEVERITY_LABEL: Record<EmailSeverity, string> = {
  high: 'Fix first',
  medium: 'Fix soon',
  low: 'Nice to fix',
}

export interface DocOnKitOptions {
  subject: string
  /** utm_campaign and the go-link `c`. */
  campaign: string
  /** false hides the "More from KENSAURUS" row. */
  crossLinks?: boolean
}

export function docToMailBlocks(doc: EmailDoc): MailBlock[] {
  const out: MailBlock[] = [{ type: 'heading', text: doc.heading }]
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'p':
        out.push({ type: 'paragraph', text: b.text })
        break
      case 'findings':
        for (const r of b.rows) {
          out.push({ type: 'paragraph', text: `[${SEVERITY_LABEL[r.severity]}] ${r.title}${r.detail ? `\n${r.detail}` : ''}` })
        }
        if (b.more) out.push({ type: 'note', text: b.more })
        break
      case 'checks':
        out.push({ type: 'paragraph', text: b.items.map((i) => `- ${i}`).join('\n') })
        break
      case 'pre':
        out.push({ type: 'code', mono: true, value: b.text })
        break
      case 'button':
        out.push({ type: 'button', label: b.label, url: b.url })
        break
      case 'link':
        out.push({ type: 'paragraph', text: `${b.label}: ${b.url}` })
        break
    }
  }
  if (doc.footer.length) out.push({ type: 'divider' })
  for (const f of doc.footer) {
    out.push({ type: 'note', text: typeof f === 'string' ? f : `${f.before ? `${f.before} ` : ''}${f.label}: ${f.url}` })
  }
  return out
}

/** A mushi-mushi transactional email from an EmailDoc. Throws on a non-https link (the kit's rule). */
export function renderDocOnKit(doc: EmailDoc, opts: DocOnKitOptions): RenderedMail {
  return renderMail({
    app: 'mushi-mushi',
    lang: 'en',
    kind: 'transactional',
    campaign: opts.campaign,
    subject: opts.subject,
    preheader: doc.preheader,
    crossLinks: opts.crossLinks,
    blocks: docToMailBlocks(doc),
  })
}
