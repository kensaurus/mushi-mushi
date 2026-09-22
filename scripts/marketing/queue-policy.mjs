// scripts/marketing/queue-policy.mjs
//
// Decides which items in docs/marketing/social/queue.json may be posted.
// Kept apart from post-bluesky.mjs, which reads credentials the moment it is
// imported, so the rules can be unit-tested (queue-policy.test.mjs).
//
// The queue is only ever run by hand, usually on a launch day, often months
// after its dates were written. Before these guards, "due" meant "unposted and
// scheduled in the past", so four April posts written in a retired voice would
// all have fired the first time anyone ran the script. Two guards now apply:
//
//   - `disabled: true` retires an item without deleting its history. Pair it
//     with `disabled_reason` so the next reader knows why it was pulled.
//   - An item scheduled more than MAX_STALE_DAYS ago is stale: it was written
//     for a moment that has passed. It is refused unless the caller opts in
//     with allowStale (the `--allow-stale` flag).

export const MAX_STALE_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Sort every unposted queue item into exactly one bucket.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} queue parsed queue.json
 * @param {{ now?: number, allowStale?: boolean, maxStaleDays?: number }} [options]
 * @returns {{
 *   due: Array<Record<string, unknown> & { index: number }>,
 *   stale: Array<Record<string, unknown> & { index: number }>,
 *   disabled: Array<Record<string, unknown> & { index: number }>,
 *   invalid: Array<Record<string, unknown> & { index: number }>,
 * }}
 *   `due` may be posted now; `stale` was refused for age; `disabled` was
 *   retired on purpose; `invalid` has a `scheduled_for` that is not a date.
 *   Future-scheduled items appear in no bucket.
 */
export function classifyQueue(
  queue,
  { now = Date.now(), allowStale = false, maxStaleDays = MAX_STALE_DAYS } = {},
) {
  const due = []
  const stale = []
  const disabled = []
  const invalid = []
  const staleBefore = now - maxStaleDays * DAY_MS

  queue.forEach((item, index) => {
    if (item.posted_at) return
    const entry = { ...item, index }
    if (item.disabled === true) {
      disabled.push(entry)
      return
    }
    // No date means "post whenever the script next runs" — unchanged from the
    // original queue contract.
    if (!item.scheduled_for) {
      due.push(entry)
      return
    }
    const at = Date.parse(String(item.scheduled_for))
    if (Number.isNaN(at)) {
      invalid.push(entry)
      return
    }
    if (at > now) return
    if (at < staleBefore && !allowStale) {
      stale.push(entry)
      return
    }
    due.push(entry)
  })

  return { due, stale, disabled, invalid }
}
