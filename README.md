# COLDSPAN

When a produce distributor's cold room fails, competing recovery plans can double-book space and lose track of custody. Coldspan rehearses a human-approved recovery and exports evidence an independent checker can replay.

This is a synthetic simulator. The owner-private interface calls a deployed Cloudflare Worker. Each reviewer session has a separate SQLite-backed Durable Object containing drills, reservations, events and exact retry receipts. No vehicles, sensors, equipment or Meta model are connected.

## Review the workflow

Open https://coldspan-preview.deeen-code.chatgpt.site with the owning ChatGPT account. Start an outage drill, confirm the synthetic counts, propose a recovery plan, approve its exact digest and reserve capacity. Dispatch each work order, advance the simulated clock five minutes, report its arrival and ask the simulator to confirm it. Reconcile and download evidence.

```sh
python3 verifier/check.py coldspan-evidence.json
```

The outage fixture moves 12 synthetic crates through three handoffs. This is an accounting demonstration, not measured food-safety or customer impact.

## Develop and verify

Requires Node 24 or later and Python 3.10 or later.

```sh
npm ci
npm run typecheck
npm run typecheck:worker
npm test
npm run build
npm run worker:check
npm run verify:live
python3 verifier/check.py evidence/cloudflare-hosted-completed.json
```

The live check creates isolated synthetic reviewer data on the deployed API. Credentials stay in process memory and are never saved in evidence. Tests include browser transport and pending-action recovery. Three historical browser-adapter tests remain regression checks. They do not establish live backend behavior. Hosted checks cover a complete outage, a healthy control, concurrent reservation, altered retries, server-assigned arrival authority, cross-session isolation and rejected origins.

`web/remote-api.ts` is the active transport. Browser storage contains the review access key, selected drill ID and any unresolved action identity. Operational state and committed receipts are held by Cloudflare. A timeout, malformed response or server error retains the original action ID. New mutations are blocked until that identity is reconciled. A definitive refusal clears the pending request. Requests are serialized within a browser instance and server versions resolve competing tabs.

## Backend recovery and deployment

`cloudflare/worker.ts` is the active Worker entrypoint. It uses `cloudflare/store.ts` for transactional persistence and the shared deterministic rules in `src/domain.ts`. Wrangler generates binding and runtime types during `npm run typecheck:worker`. The generated declaration and backend bundle are ignored build artifacts.

`cloudflare/deployed-worker.mjs` remains an immutable copy of the recovered October backend. Parity tests compare the typed store against this copy across all eight scenarios. `evidence/backend-provenance.json` identifies the historical module. The typed source preserves its schema, action identities and payload hashes. The upgrade check starts with a receipt committed by the old backend and recovers that exact receipt after deploying the typed backend.

`wrangler.jsonc` retains the existing compatibility date and both SQLite Durable Object class names. The active build is `coldspan-cf-20261103-3`. Frontend publication retains the existing Site identity in `.openai/hosting.json`. `.github/workflows/verify.yml` runs type checks, tests, the Worker dry run, frontend build and independent evidence replay on pushes and pull requests. It does not deploy or call a model.

## Saved drills and session expiry

The workspace selector opens any retained drill and restores the chosen drill after reload. Its compact history endpoint returns summaries rather than downloading all event ledgers. The interface shows connection state and the server-issued expiry time, blocks mutations while loading and offers a real bootstrap retry if connectivity fails.

An existing access key is never silently replaced after an authentication or expiry failure. Starting a separate review requires an explicit action and a fresh server confirmation that the old review expired. Pending action identities are copied into an expired-review record in browser storage before leaving the old workspace. This archive contains request identities, not an access key or recoverable cloud data. Account-linked recovery remains unfinished.

## Trust boundaries and remaining work

- Reviewer sessions expire after seven days and are removed by a Durable Object alarm. The browser-held bearer is the access key. Clearing browser storage loses access. There is no account-linked API recovery or organization membership.
- The frontend is owner-private. The Worker API accepts isolated synthetic reviewer sessions and enforces bearer scope, bounded input, per-IP request gates and quotas. Origin checking is browser protection, not authentication.
- SQL transactions commit state and its idempotent receipt together. Capacity is scoped to a synthetic drill, not a shared physical warehouse.
- Python replay establishes internal consistency. Hashes do not prove physical truth, authorship or an external timestamp.
- Meta integration, model evaluation, production identity, backups, operational alerts and physical integrations remain unfinished.
- Independent prototype work started October 25, 2026. Event registration, selection, permitted reuse and final rules must be established separately. No event submission or qualifying entry is claimed.

See `evidence/VERIFICATION.md` for current observations and verification limits.
