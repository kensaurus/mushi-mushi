/** Public asset paths that respect MUSHI_BASE_PATH in production deploys. */
export function publicAssetPath(path: string): string {
  const base = (process.env.NEXT_PUBLIC_MUSHI_BASE_PATH ?? '').replace(/\/+$/, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}
