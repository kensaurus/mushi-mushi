/** Optional replay dep — admin console does not record session replay. */
export function record(): () => void {
  return () => {}
}
