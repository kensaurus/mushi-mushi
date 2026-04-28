import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase-server'

/**
 * Supabase magic-link callback. The signup flow asks Supabase to email a
 * verification link with `emailRedirectTo = cloudUrl('/auth/callback')`,
 * so this route is the user's FIRST authenticated touchpoint after they
 * confirm their email.
 *
 * Why this file exists at all:
 *   The previous build passed `${NEXT_PUBLIC_APP_URL}/auth/callback` as the
 *   email redirect target but never shipped a handler — clicking the magic
 *   link 404'd silently, leaving new users stuck on the "Check your email"
 *   page forever. This is the missing handler that closes the loop.
 *
 * Behavior:
 *   - PKCE flow (?code=...): exchange the code for a session; cookies are
 *     set by the SSR client through next/headers. On success → /dashboard.
 *   - `redirect_to` query param: optional override (e.g. /signup/check-email
 *     → /dashboard?welcome=1). We allow it only when the path is same-origin.
 *   - Any error: redirect to /login with `?error=auth_callback_failed`
 *     instead of throwing — the user should always land somewhere actionable.
 *
 * NOTE on the older hash-fragment flow (#access_token=…): Supabase JS SSR
 * doesn't deliver fragments to the server, so projects that still use the
 * implicit grant must enable PKCE (it's the default for new projects since
 * 2024). If you migrated from a pre-PKCE Supabase project, flip
 * `flowType: 'pkce'` in your Supabase client config; otherwise this handler
 * silently won't see a code.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  // The `next` param lets ad-hoc callers (e.g. magic-link via /login) deep-link
  // back into the cloud app after auth. We sanitize to same-origin paths so a
  // crafted email can't hijack the open redirect into a phishing landing.
  const rawNext = url.searchParams.get('next') ?? '/dashboard'
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  if (errorParam) {
    const target = new URL('/login', url.origin)
    target.searchParams.set('error', errorParam)
    return NextResponse.redirect(target)
  }

  if (!code) {
    const target = new URL('/login', url.origin)
    target.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(target)
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const target = new URL('/login', url.origin)
    target.searchParams.set('error', 'auth_callback_failed')
    return NextResponse.redirect(target)
  }

  return NextResponse.redirect(new URL(safeNext, url.origin))
}
