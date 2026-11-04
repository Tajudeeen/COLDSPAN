# Grounded intake and workflow verification

Checked November 3, 2026. Active backend build: `coldspan-cf-20261103-4`.

## Current checks

- TypeScript checks cover the interface and typed Worker, using Wrangler-generated binding and runtime types.
- Seventy-four automated tests cover the prior lifecycle and persistence guarantees plus intake grounding, human-review binding, duplicate provider work, unknown outcomes, budget rollover and independent evidence tampering. Twenty of these are frozen candidate-validation cases. They are not twenty live-model evaluations.
- `intake-boundary-evaluation.json` records twenty hand-authored validation fixtures, twenty passes and zero provider calls. Provider transport tests inject synthetic responses. No live Meta accuracy, benefit or cost is measured.
- The SQLite adapter executes real local SQLite transactions. It is not a substitute for a Cloudflare runtime test. Hosted HTTP checks independently exercise the deployed Worker.
- The live suite holds a receipt committed by the previous backend across the actual typed-backend deployment, then verifies byte-equivalent receipt fields and persisted state. It also checks the full outage with a fixture interpretation and explicit human confirmation, healthy control, reservation race, authority refusal, isolation, CORS preflight, session metadata, compact history, expiry and unavailable Meta behavior. Nine hosted checks pass.
- `cloudflare-live-checks.json` records the actual hosted observations. `cloudflare-hosted-completed.json` is the exported outage evidence. Python replay is recorded in `cloudflare-hosted-replay.json`.

## Browser verification limit

A complete authenticated browser walkthrough has not been verified. The earlier cloud-browser attempt reached the private Site's ChatGPT sign-in screen. Its internal Vite preview rendered but upstream API connectivity failed. This release uses source checks, lifecycle tests and actual hosted API checks. Publication and API checks do not establish mobile-device compatibility or physical operation.

## History and limits

`cloudflare/deployed-worker.mjs` is retained as the historical parity baseline. The active entrypoint now uses typed modules. No database namespace was deleted, renamed or transferred during the upgrade.

Older, uncommitted migration tests were lost before source recovery. Their reported totals are not added to current checked-in test counts. All stock, rooms and movements remain synthetic. No Meta execution or real dispatch is claimed. The adapter is prepared but unavailable on the deployed Worker. Fixture records are explicitly labeled and cannot claim model usage. Expired-review browser archives preserve pending request identities only. They cannot restore expired cloud data or replace account authentication.

## Operational tooling, November 4, 2026

Seventy-eight tests pass, including negative checks for the semantic evaluation scorer and monitor. The read-only hosted readiness check passes for build `coldspan-cf-20261103-4`, including allowed-origin headers. Meta capability reports `MODEL_API_KEY_MISSING`, independently consistent with the Cloudflare secret-name inventory, which contains no configured secrets. This pass makes zero provider calls. The new scheduled monitor records availability failures in GitHub Actions. Owner notification delivery remains unverified. No new authenticated browser, real-device, backup restoration or account recovery verification is claimed. See `ops/PRODUCTION.md` for the remaining gates.
