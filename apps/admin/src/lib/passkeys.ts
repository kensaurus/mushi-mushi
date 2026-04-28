/**
 * FILE: apps/admin/src/lib/passkeys.ts
 * PURPOSE: Progressive wrapper around Supabase's experimental passkey API.
 */

import { supabase } from './supabase'

interface PasskeyError {
  message?: string
}

interface PasskeyResult {
  error?: PasskeyError | null
}

interface PasskeyCapableAuth {
  signInWithPasskey?: () => Promise<PasskeyResult>
  registerPasskey?: () => Promise<PasskeyResult>
}

const passkeyAuth = supabase.auth as typeof supabase.auth & PasskeyCapableAuth

function unavailable(): { error: string } {
  return {
    error: 'Passkeys are not available in this browser or Supabase client yet. Use an email link or password instead.',
  }
}

export function canUsePasskeys(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof passkeyAuth.signInWithPasskey === 'function'
  )
}

export async function signInWithPasskey(): Promise<{ error?: string }> {
  if (!canUsePasskeys() || !passkeyAuth.signInWithPasskey) return unavailable()
  try {
    const { error } = await passkeyAuth.signInWithPasskey()
    return { error: error?.message }
  } catch (error) {
    return { error: error instanceof Error ? error.message : unavailable().error }
  }
}

export async function registerPasskey(): Promise<{ error?: string }> {
  if (!canUsePasskeys() || !passkeyAuth.registerPasskey) return unavailable()
  try {
    const { error } = await passkeyAuth.registerPasskey()
    return { error: error?.message }
  } catch (error) {
    return { error: error instanceof Error ? error.message : unavailable().error }
  }
}
