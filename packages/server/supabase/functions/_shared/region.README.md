# Region routing

| Region | API endpoint (Jun 2026) | Notes |
| ------ | ----------------------- | ----- |
| `us`   | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` | Default catalog of record |
| `eu`   | Same Supabase origin today | Reserved for future EU cluster |
| `jp`   | Same Supabase origin today | Reserved for future JP cluster |

Regional hostnames (`api.us.mushimushi.dev`, etc.) are **not** live yet. All
SDK and server defaults point at the Supabase project above until multi-cluster
DNS ships.
