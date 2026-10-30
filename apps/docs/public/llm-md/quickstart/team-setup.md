# Set up Mushi Mushi for a team

Source: https://kensaur.us/mushi-mushi/docs/quickstart/team-setup

---
title: Set up Mushi Mushi for a team
description: A checklist for a small dev team adopting Mushi Mushi, from sign-up to a weekly routine. Each step says what to do, where, and how to check it.
---

# Set up Mushi Mushi for a team

This page is for a team of 2 to 8 developers shipping a web app built with AI
tools. It lists what teams usually do when they adopt Mushi Mushi, in order.
Each step says what to do, where to do it in the console, and how to check it
worked.

Plan on an hour for steps 1 to 6, and a day of real traffic before step 8.

  **Teams need the Studio or Enterprise plan.** Free and Builder are solo
  workspaces. Studio has 5 seats (you and up to 4 teammates), and pending
  invitations count as seats. See [Teams and members](/admin/teams) and
  [Pricing](/pricing).

## 1. Accounts and team

**Do this:**

1. One person signs up at the console's `/signup` page. This person becomes
   the owner.
2. On **Set up**, name your app and create it. Creating it also makes the
   app's report key (`report:write`).
3. Upgrade to Studio under **Team → Billing** if you have not yet.
4. Open **Team → Members**. Invite each teammate by email with a role.

**Pick roles on purpose:**

| Role | Can do | Give it to |
| --- | --- | --- |
| Owner | Billing, plan changes, members. The last owner cannot be removed. | One or two people |
| Admin | Invite people, change project settings and integrations | Whoever sets up tools and keys |
| Member | Work in shared projects and review reports | Most developers |
| Viewer | Read-only access | Product, support, a manager |

Only admins can edit integrations. A viewer cannot override a review hold
(see step 7).

**Check it worked:** each invitee opens the invite email, signs in, and sees
the app. **Team → Members** lists them with the right role and no pending
invitation.

## 2. Connect your code (GitHub)

Mushi Mushi needs GitHub access to open fix pull requests. Fixes always open
as **draft** pull requests. Nothing lands on your main branch without a merge.

**Do this:**

1. Open **Connect** and find the **GitHub** section, or open
   **Integrations → GitHub (code repo)**.
2. Install the Mushi Mushi GitHub App. GitHub's own install screen asks which
   repositories the app may see. Pick only the repos this app lives in.
3. Set the **Default branch** if it is not `main`.

**Self-hosted, or no GitHub App?** Use a fine-grained personal access token
instead. It needs **Contents: write** and **Pull requests: write** on the repo.
Add **Actions secrets: read and write** only if you want Mushi Mushi to write
CI secrets for you. Paste it as the **Installation token** on the GitHub card.

**Check it worked:** on the GitHub card, click **Test connection** and get a
green result. Then open **Set up** and read **Setup gaps**: the GitHub access
line for your repo should not be red. See [Integrations](/admin/integrations)
and [Set up](/admin/onboarding#setup-gaps).

## 3. Install the SDK in your app

The SDK adds the report button to your app and sends reports to Mushi Mushi.

**Do this:**

1. Open **Connect → Bug capture SDK**. Pick your framework tab and copy the
   snippet. **Make a key and fill it in** puts your key into the snippet.
2. Put the project ID and key in environment variables, not in code:
   - Vite (React, Vue, Svelte): `VITE_MUSHI_PROJECT_ID` and `VITE_MUSHI_API_KEY`
   - Next.js: `NEXT_PUBLIC_MUSHI_PROJECT_ID` and `NEXT_PUBLIC_MUSHI_API_KEY`
3. Keep the key out of git. Put it in `.env.local` and make sure that file is
   in `.gitignore`.
4. Add the same variables to your hosting provider and to CI. These variables
   are read at **build time**, so set them where the build runs, then
   redeploy. A missing variable means the report button does not appear.
5. Deploy.

Prefer the terminal? `mushi connect` writes the variables to `.env.local` and
wires your editor in one step. See [CLI ↔ console loop](/quickstart/cli-console-loop).
Framework details: [React](/quickstart/react), [Vue](/quickstart/vue),
[Svelte](/quickstart/svelte), [Vanilla JS](/quickstart/web).

**Check it worked:** open your deployed app and look for the report button.
Then open **Connect**: the **App checked in** pill should be on. If it is not,
the **SDK health** section names the problem. See [Connect](/admin/connect)
and [SDK health](/admin/sdk-health).

## 4. Connect each developer's editor (MCP)

With MCP, each developer can ask their editor for a bug's diagnosis and fix
prompt without opening the console. Every developer does this once, with
their own account.

**Do this:**

1. Open **Connect**, pick your client (Cursor, Claude Code, VS Code and
   others), and use the **MCP** lane.
2. Or, in Claude Code, add the hosted server and sign in:

   ```bash
   claude mcp add --transport http mushi "https://kensaur.us/mushi-mushi/hosted-mcp/"
   claude mcp login mushi
   ```

3. In the browser, sign in, pick which projects the editor may see, and click
   **Approve**.

The editor gets what the developer's role allows, no more.

**Check it worked:** ask the editor *"list mushi tools"*, then *"get the
latest Mushi Mushi report"*. You should see the tools and a report. See
[MCP server](/quickstart/mcp).

## 5. Alerts (optional)

Decide who hears about new bugs, and where.

**Do this:**

1. Open **Integrations → Alerts**. Connect **Slack** (click **Add to Slack**,
   pick a channel, invite the bot) or **Discord**.
2. Use one shared channel, such as `#bugs`. Everyone on the team who should
   triage joins it.
3. Optional: connect Linear, Jira or GitHub Issues under **Issue trackers** if
   you want critical and high bugs copied there. PagerDuty pages on-call for
   critical bugs only.

Who gets what:

| Who | What they get | Where it is set |
| --- | --- | --- |
| The team channel | New bugs as cards, with buttons to dispatch a fix, resolve or dismiss (Slack) | **Integrations** |
| The billing contact | Usage emails at 50%, 80% and 100% of included diagnoses | **Team → Billing** (defaults to the owner) |
| The person who reported the bug | Messages in your app when it is diagnosed and fixed | **Reporter updates** |

**Check it worked:** click **Test connection** on the Slack or Discord card. A
test message should arrive in the channel. See [Slack app](/plugins/slack) and
[Discord](/plugins/discord).

## 6. AI keys and cost

**What you get:** Free includes 100 diagnoses a month, with a hard stop.
Builder and Studio include more, and monthly plans can run into capped
overage. Reports are always kept, even when diagnoses pause. See
[Pricing](/pricing).

**Do this:**

1. Decide whether to bring your own AI key. Under **Settings → AI keys**, add
   an Anthropic, OpenAI or Cursor key. Mushi Mushi then uses it for fix pull
   requests and agent work, and you pay that vendor directly. A Cursor key is
   what lets a cloud agent write fixes.
2. Set spend limits under **Settings → General → Spend limits**:
   - **Monthly AI budget**: all AI calls for the app stop at this amount until
     the 1st of next month.
   - **Auto-fix spend limit** and **Automatic fixes per day**: cap fixes Mushi
     Mushi starts on its own. New projects start at $2 per 30 days and 3
     automatic fixes a day.
   - **Ask me before fixes that may cost more than**: expensive fixes wait for
     approval.
3. On a paid plan, check the **Monthly spend cap** under **Team → Billing**.
   This caps overage on your bill. It is separate from the AI budget above.

**Check it worked:** after the first few reports, open **Team → AI spend**.
You should see each call with its model, cost and which key paid. See
[Settings](/admin/settings), [AI spend](/admin/cost) and [Billing](/admin/billing).

## 7. Review gate and merging

Decide how a fix gets from a draft pull request to your main branch.

**What happens by default:**

1. Each cloud agent fix gets an AI review a few minutes after its pull
   request opens. The verdict is **merge**, **fix first** or **hold**.
2. A **hold** blocks merging from Mushi Mushi. Only a project member who is
   not a viewer can override it, in the console, with a written reason that
   goes to the audit log.
3. Your CI must pass. A skipped or stopped check never counts as a pass.
4. Approved, green pull requests go into a merge queue. By default the queue
   batches them into a **release train**, so several fixes ship as one deploy.

**Do this:**

1. Agree as a team that a person reads every fix before it merges. The AI
   review helps you read; it does not replace you.
2. Leave **Merge proven fixes automatically** off at first. It is off by
   default, under **Settings → General → Fixes and CI → Verified merge**. Turn
   it on later, if you want, once you trust the gates.
3. Choose **Batch** (release trains) or **Each PR** in the **Merge when ready**
   panel on **Fixes**.

**Check it worked:** open **Pipeline**. Each stage shows a count, and nothing
is stuck without a reason. See [Agent PR review](/concepts/agent-pr-review),
[Verified merge](/admin/verified-merge), [Fixes](/admin/fixes) and
[Pipeline](/admin/pipeline).

## 8. Test the whole loop

Run one bug through every step before you rely on it.

1. **Test report.** On **Set up**, click **Send test report** (or **Submit
   test report** on the **Test it** tab). A diagnosis appears on the same
   screen.
2. **Real report.** Open your deployed app and file a bug with the report
   button. Check the screenshot preview before you send it.
3. **Diagnosis.** Open **Bugs**. The report is there with a plain-English
   diagnosis.
4. **Fix.** On the report, click **Dispatch fix**. Follow it on **Fixes**
   until a draft pull request opens.
5. **Review.** Read the AI review and the diff. Fix or hold if needed.
6. **Merge.** Merge from the console, or let the release train take it. The
   report is marked Fixed.
7. **Reporter is told.** Open **Reporter updates → Sent**. You should see a
   `fixed` message for that report.
8. **Deploy is seen.** To tell reporters "your fix is live", Mushi Mushi needs
   to see your deploys. Turn on **Release automatically when you ship** on
   **Releases**. It fires on a published GitHub release, a successful
   production deployment, or a `release.published` event from your CI.

**Check it worked:** **Set up → Setup gaps** shows no red line for deploy
events. If no deploy has been seen in 14 days, it says so. See
[Releases](/admin/releases) and [Reporter updates](/admin/notifications).

## 9. Ongoing routine

**Name one owner for the Bugs queue each week.** Rotate it. The owner does a
15-minute pass, once or twice a week:

1. **To-do**: clear what needs a person.
2. **Bugs**: dismiss noise and duplicates, dispatch fixes for real bugs.
3. **Pipeline**: open stuck groups. Re-run CI, send to follow-up, or decide on
   holds.
4. **Checks**: look at anything red or amber.
5. **Team → AI spend**: compare spend with the budget.

**Privacy and data:**

- **Screenshots.** Reporters see a preview of the screenshot and can remove it
  before they send. Under **Connect → Bug capture SDK**, keep **Privacy caption
  on screenshot preview** on, or write your own text.
- **Retention.** Reports older than your plan's window are deleted daily: Free
  14 days, Builder 90, Studio 180, Enterprise custom.
- **Storage.** To keep screenshots in your own bucket, see [Storage](/admin/storage)
  and [BYO storage](/security/byo-storage).
- **Who can see what.** Review **Team → Members** when someone joins or leaves.

See [Security](/security) for the full summary.

## Done when

| Area | Done when |
| --- | --- |
| Team | Every developer has accepted an invite with the right role |
| GitHub | **Test connection** is green; Setup gaps shows no red GitHub line |
| SDK | The report button shows in production; **App checked in** is on |
| Secrets | The key is in `.env.local`, hosting and CI, not in git |
| Editor | Each developer's editor lists the Mushi Mushi tools |
| Alerts | A test message arrived in the team channel |
| Cost | Spend limits are set; AI spend shows real calls |
| Review | The team agrees a person reads every fix; auto-merge is a deliberate choice |
| Loop | One real bug went report → diagnosis → draft PR → merge → reporter told |
| Deploys | Setup gaps shows deploys are seen |
| Routine | One person owns the Bugs queue this week |
