/**
 * FILE: invite-email.test.ts
 * PURPOSE: An existing account invited to a team gets an email (Supabase's
 *          inviteUserByEmail refuses registered addresses, so it got none).
 */
import { describe, expect, it } from 'vitest'
import { existingUserInviteEmail } from '../../supabase/functions/_shared/invite-email.ts'

const base = {
  to: 'sakura@example.com',
  orgName: 'kenji',
  inviterName: 'Kenji',
  inviterEmail: 'kenji@example.com',
  role: 'admin',
  note: null,
  acceptUrl: 'https://kensaur.us/mushi-mushi/admin/invite/accept?token=abc',
}

describe('existingUserInviteEmail', () => {
  it('names the team, the inviter, the role and links the accept page', () => {
    const mail = existingUserInviteEmail(base)
    expect(mail.subject).toBe('Kenji invited you to kenji on Mushi Mushi')
    expect(mail.text).toContain('as an admin (manage the team and every app)')
    expect(mail.text).toContain(base.acceptUrl)
    expect(mail.html).toContain(base.acceptUrl.replace(/&/g, '&amp;'))
    expect(mail.text).toContain('your own apps stay where they are')
  })

  it('carries the note and escapes untrusted text in the HTML', () => {
    const mail = existingUserInviteEmail({ ...base, orgName: '<b>Team</b>', note: 'see <script>' })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<b>Team</b>')
    expect(mail.text).toContain('see <script>')
  })

  it('falls back sensibly with no inviter name and an unknown role', () => {
    const mail = existingUserInviteEmail({ ...base, inviterName: '', role: 'weird' })
    expect(mail.subject).toBe('kenji@example.com invited you to kenji on Mushi Mushi')
    expect(mail.text).toContain('as a member')
  })
})
