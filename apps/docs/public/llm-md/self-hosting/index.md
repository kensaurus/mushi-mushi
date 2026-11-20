# Self-hosting quickstart

Source: https://kensaur.us/mushi-mushi/docs/self-hosting

---
title: Self-hosting quickstart
description: "Run Mushi Mushi on your own Supabase project, from zero to the first diagnosis, with one command. Every feature on, no usage limits."
---

# Self-hosting quickstart

Run the whole Mushi Mushi server on your own [Supabase](https://supabase.com) project. The free tier is enough. Self-host turns every feature on and lifts every plan limit ([ADR 0063](https://github.com/kensaurus/mushi-mushi/blob/master/docs/adr/0063-reach-first-free-plan-and-free-self-host.md)). It is the same code Mushi Mushi Cloud runs: the server is AGPLv3 and the SDKs are MIT ([Open source & licensing](/concepts/open-source)).

This page takes you from nothing to your first diagnosis. Prefer containers and no Supabase account? Use [Docker Compose](/self-hosting/docker-compose) instead.

## Before you start

- [ ] A Supabase project, and its **project ref** (Project Settings → General; the `abcdefghijklmnopqrst` in `https://abcdefghijklmnopqrst.supabase.co`)
- [ ] The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), signed in: `supabase login`
- [ ] Node 22+, pnpm and git
- [ ] Optional: an Anthropic **or** OpenAI API key. Without one, reports get a rule-based category and severity, but no plain-English diagnosis or fix draft. You can add one later in the console.

### Clone the repo

The migrations and functions deploy from your clone.

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
```

You should see: a `mushi-mushi` folder, and your shell inside it.

### Deploy the server

```bash
npx mushi-mushi@latest selfhost up --project-ref <your-ref> --console-url http://localhost:6464
```

It asks you to confirm, then for an AI key (press Enter to skip). Then it links the project, applies every migration, sets the function secrets, points the database's cron jobs at your project, lifts the plan limits, deploys every edge function stamped with your commit, and saves the API address to the CLI config. `--console-url` is where you will serve the console in the next step; `up` sets it as the address for links and sign-in, and lets that origin call the API.

You should see, at the end:

```
  OK    /health 200 412ms
  OK    Server deploy: Running commit 3c64ea2.
✓  selfhost up complete.
```

### Serve the console

The console is a static app. Build it with your project's URL and anon key (Project Settings → API), then serve it:

```bash
pnpm install
VITE_SUPABASE_URL=https://<your-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon key> \
VITE_INSTANCE_TYPE=self-hosted \
pnpm --filter "@mushi-mushi/admin..." build
npx serve -s apps/admin/dist -l 6464
```

You should see: `Serving!` and `http://localhost:6464`. For a real domain, see [Host the console](/self-hosting/admin-spa).

### Sign up

Open `http://localhost:6464` and create an account. The first account owns the instance. Supabase emails a confirmation link first; to skip it while you test, turn off **Confirm email** under Authentication → Sign In / Providers.

You should see: the console, with **Self-hosted** in the sidebar footer.

### Sign the CLI in and run the doctor

```bash
npx mushi-mushi@latest login --endpoint https://<your-ref>.supabase.co/functions/v1/api
npx mushi-mushi@latest selfhost doctor
```

`login` opens your console to approve the CLI and mints its key; no SQL needed. The doctor checks the server, the console, the cron URL, the screenshots bucket and the AI key.

You should see: `OK` lines and maybe `INFO` lines, with exit code 0. `INFO` marks an optional extra that is not set up (an AI key, Langfuse, Sentry). Each `FAIL` or `WARN` line ends with its fix.

### Get your first diagnosis

In the console, create an app (**Projects** → New), then open **Settings → SDK & connection** and press **Send test bug**. The same page shows the **Self-host setup** checklist.

You should see: a test report under **Reports**, with a plain-English diagnosis if you set an AI key, or a rule-based category if not. To catch real bugs, run `npx mushi-mushi@latest init` in your app's repo.

## Next

| I want to… | Go to |
| --- | --- |
| See every setting and where it goes | [Environment variables](/self-hosting/environment) |
| Run everything in containers, no Supabase account | [Docker Compose](/self-hosting/docker-compose) |
| Run each step myself, or understand what `selfhost up` did | [Supabase by hand](/self-hosting/supabase) |
| Put the console on a real domain | [Host the console](/self-hosting/admin-spa) |
| Add Langfuse traces and Sentry errors | [Observability](/self-hosting/observability) |
| Upgrade, bootstrap from IaC, add cron jobs, harden | [Operate and upgrade](/self-hosting/operate) |

  Re-running `selfhost up` is safe: it applies only new migrations and redeploys. It rotates the internal caller secret in both places unless you export `MUSHI_INTERNAL_CALLER_SECRET` first. In CI, add `--yes`. No Supabase CLI, or want to read every command first? `selfhost up --print-commands` prints them with placeholders for each secret.
