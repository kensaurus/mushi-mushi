import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

type CookieToSet = { name: string; value: string; options: CookieOptions }

export const getSupabaseServer = async () => {
  const store = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        toSet.forEach(({ name, value, options }) => {
          try {
            store.set({ name, value, ...options })
          } catch {
            // ignored when called from a server component (next/headers limitation)
          }
        })
      },
    },
  })
}

export const apiBaseUrl = () =>
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.mushimushi.dev'
