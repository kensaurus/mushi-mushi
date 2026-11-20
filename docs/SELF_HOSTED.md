# Self-hosting Mushi Mushi

The self-hosting guide lives on the docs site, one page per job. This file is a
pointer so old links keep working; edit the pages under
[`apps/docs/content/self-hosting/`](../apps/docs/content/self-hosting/), not here.

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
supabase login
npx mushi-mushi@latest selfhost up --project-ref <your-ref> --console-url http://localhost:6464
```

| I want to… | Page |
| --- | --- |
| Go from zero to the first diagnosis on my own Supabase project | [Quickstart](https://kensaur.us/mushi-mushi/docs/self-hosting) |
| See every environment variable, where it goes, required or not | [Environment variables](https://kensaur.us/mushi-mushi/docs/self-hosting/environment) |
| Run everything in containers with no Supabase account | [Docker Compose](https://kensaur.us/mushi-mushi/docs/self-hosting/docker-compose) |
| Run each step myself instead of `selfhost up` | [Supabase by hand](https://kensaur.us/mushi-mushi/docs/self-hosting/supabase) |
| Serve the console on my own domain | [Host the console](https://kensaur.us/mushi-mushi/docs/self-hosting/admin-spa) |
| Add Langfuse traces and Sentry errors | [Langfuse + Sentry](https://kensaur.us/mushi-mushi/docs/self-hosting/observability) |
| Upgrade, bootstrap headlessly, add cron jobs, harden, run multi-region | [Operate and upgrade](https://kensaur.us/mushi-mushi/docs/self-hosting/operate) |
| Know what each edge function does and how it authenticates | [Edge functions](https://kensaur.us/mushi-mushi/docs/self-hosting/edge-functions) |

Check an install with `npx mushi-mushi selfhost doctor`, or the **Self-host
setup** checklist in the console (Settings → SDK & connection).
