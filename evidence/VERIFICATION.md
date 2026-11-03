# Workspace lifecycle and typed-backend verification

Checked November 3, 2026. Active backend build: `coldspan-cf-20261103-3`.

## Current checks

- TypeScript checks cover the interface and typed Worker, using Wrangler-generated binding and runtime types.
- Thirty-four automated tests include eight parity scenarios against the recovered backend, SQL rollback on injected receipt failure, persisted retry after disk SQLite restart, competing reservation versions, isolated drill history, expiry cleanup, transport recovery and workspace lifecycle.
- The SQLite adapter executes real local SQLite transactions. It is not a substitute for a Cloudflare runtime test. Hosted HTTP checks independently exercise the deployed Worker.
- The live suite holds a receipt committed by the previous backend across the actual typed-backend deployment, then verifies byte-equivalent receipt fields and persisted state. It also checks the full outage, healthy control, reservation race, authority refusal, isolation, CORS preflight, session metadata, compact history and expired-session refusal.
- `cloudflare-live-checks.json` records the actual hosted observations. `cloudflare-hosted-completed.json` is the exported outage evidence. Python replay is recorded in `cloudflare-hosted-replay.json`.

## Browser verification limit

A complete authenticated browser walkthrough has not been verified. The earlier cloud-browser attempt reached the private Site's ChatGPT sign-in screen. Its internal Vite preview rendered but upstream API connectivity failed. This release uses source checks, lifecycle tests and actual hosted API checks. Publication and API checks do not establish mobile-device compatibility or physical operation.

## History and limits

`cloudflare/deployed-worker.mjs` is retained as the historical parity baseline. The active entrypoint now uses typed modules. No database namespace was deleted, renamed or transferred during the upgrade.

Older, uncommitted migration tests were lost before source recovery. Their reported totals are not added to current checked-in test counts. All stock, rooms and movements remain synthetic. No Meta execution or real dispatch is claimed. Expired-review browser archives preserve pending request identities only. They cannot restore expired cloud data or replace account authentication.
