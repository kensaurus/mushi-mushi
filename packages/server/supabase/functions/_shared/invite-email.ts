/**
 * FILE: packages/server/supabase/functions/_shared/invite-email.ts
 * PURPOSE: The team invite email for someone who already has an account.
 *
 * Supabase's inviteUserByEmail refuses an address that is already registered,
 * so an existing user invited to a team got no email at all and the inviter
 * had to copy the link by hand. This builds the same invite in the branded
 * layout for sendTransactionalEmail. Pure: no Deno globals.
 */

import { renderEmailHtml, renderEmailText, type EmailDoc } from './email-layout.ts'

export interface InviteEmailInput {
  to: string
  orgName: string
  inviterName: string
  inviterEmail: string | null
  role: string
  note: string | null
  acceptUrl: string
}

const ROLE_WORDS: Record<string, string> = {
  owner: 'an owner',
  admin: 'an admin (manage the team and every app)',
  member: 'a member (triage and fix work)',
  viewer: 'a viewer (read-only)',
}

export function existingUserInviteEmail(input: InviteEmailInput): { subject: string; html: string; text: string } {
  const team = input.orgName.trim() || 'a team'
  const who = input.inviterName.trim() || input.inviterEmail || 'A teammate'
  const role = ROLE_WORDS[input.role] ?? 'a member'
  const doc: EmailDoc = {
    preheader: `${who} invited you to ${team} on Mushi Mushi.`,
    heading: `Join ${team} on Mushi Mushi`,
    blocks: [
      { kind: 'p', text: `${who} invited you to join ${team} as ${role}. You already have an account, so accepting adds the team to it; your own apps stay where they are.` },
      ...(input.note?.trim() ? [{ kind: 'p' as const, text: `Note from ${who}: “${input.note.trim()}”` }] : []),
      { kind: 'button', label: 'Accept the invite', url: input.acceptUrl },
      { kind: 'p', text: 'The invite expires in 7 days. Sign in with this email address to accept it.' },
    ],
    footer: [
      `You got this because ${input.inviterEmail ?? who} invited ${input.to} to a team on Mushi Mushi. Not expecting it? Ignore this email; nothing changes until you accept.`,
    ],
  }
  return { subject: `${who} invited you to ${team} on Mushi Mushi`, html: renderEmailHtml(doc), text: renderEmailText(doc) }
}
