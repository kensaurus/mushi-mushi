# Providers & AI routes: operator notes

`/providers` (operators only) shows the shared AI provider accounts, spend and model routes of every Kensaurus app, read from `kensaurus-ops` on kenji (yen-yen `docs/kensaurus-provider-watch.md`, "Operator console API").

- **Server:** `GET`/`POST /v1/admin/kensaurus/ops` in `api-ext` (`api/routes/kensaurus-ops.ts`), behind `jwtAuth` and `MUSHI_OPERATOR_USER_IDS`. It needs the secrets `KENSAURUS_OPS_URL` and `KENSAURUS_OPS_CONSOLE_TOKEN`. Without them the route answers 404, so a self-hosted install shows nothing.
- **Caching:** the server holds each snapshot for 60 s. The page's Refresh and every write read again with `?fresh=1`.
- **Writes:** the server sets `actor` to `console:<user id>`, and kenji audits every change (History tab). An upstream 401 becomes 502 `upstream_auth`, which means the token here and on kenji differ.
- **Guards:** the page will not turn off or delete an app's last enabled default route (upstream answers 409). It offers only models that have a price row.
