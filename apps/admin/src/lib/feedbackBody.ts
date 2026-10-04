/**
 * FILE: apps/admin/src/lib/feedbackBody.ts
 * PURPOSE: The body the Feedback modal sends to POST /v1/support/contact,
 *          and how much of it the person may type.
 *
 * The server caps the whole body at 5,000 characters, but the modal let
 * people type 5,000 and then wrapped it in a `[Bug]` header and a page
 * footer, so a full-length report came back as BAD_BODY. The counter now
 * shows the room left after the wrapper.
 */

/** Mirrors the server cap in admin-ops.ts (`message.length > 5000`). */
const SUPPORT_BODY_MAX = 5000
/** Long query strings must not eat the person's room. */
const PAGE_CONTEXT_MAX = 300

type FeedbackType = 'bug' | 'feature'

export function feedbackPageContextLine(pathname: string, search: string): string {
  const line = `Page: ${pathname}${search}`
  return line.length > PAGE_CONTEXT_MAX ? `${line.slice(0, PAGE_CONTEXT_MAX - 1)}…` : line
}

export function composeFeedbackBody(type: FeedbackType, body: string, pageContext: string): string {
  const header = `[${type === 'bug' ? 'Bug' : 'Feature Request'}]`
  const text = body.trim() || '(no description provided)'
  return `${header}\n\n${text}\n\n---\n${pageContext}`
}

/** Characters the person can type before the composed body hits the cap. */
export function feedbackBodyBudget(type: FeedbackType, pageContext: string): number {
  const overhead = composeFeedbackBody(type, 'x', pageContext).length - 1
  return Math.max(0, SUPPORT_BODY_MAX - overhead)
}
