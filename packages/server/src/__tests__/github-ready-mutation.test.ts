/**
 * Undrafting a PR used GraphQL `markPullRequestAsReady`, which does not exist
 * ("Field 'markPullRequestAsReady' doesn't exist on type 'Mutation'"), so
 * every console merge of a draft PR answered 409 MERGE_REJECTED and Mushi's
 * fix PRs stayed drafts. GitHub's mutation is markPullRequestReadyForReview
 * (docs.github.com/en/graphql/reference/mutations#markpullrequestreadyforreview).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const github = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/github.ts'), 'utf8')

describe('markPullRequestReady', () => {
  it('calls the GraphQL mutation GitHub actually has', () => {
    expect(github).toMatch(/markPullRequestReadyForReview\(input: \{ pullRequestId: \$id \}\)/)
    expect(github).not.toMatch(/markPullRequestAsReady\(/)
  })
})
