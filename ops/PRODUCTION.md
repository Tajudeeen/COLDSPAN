# Production progression

This release adds monitoring and a bounded live-model evaluation path. It does not enable Meta or change data retention, identity, audiences or operational authority.

## Availability and incident response

`npm run check:readiness` reads the deployed API without creating sessions or invoking a model. Set `EXPECTED_BUILD` to require an exact release. The scheduled GitHub workflow runs every six hours and retains a redacted report for 14 days. A failed job is visible in Actions. The repository owner must enable GitHub Actions failure notifications to receive alerts. No email or paging integration has been configured.

If health fails, inspect Cloudflare Worker errors and the last deployment before making another release. Do not log bearer tokens, source notes or upstream provider bodies. If only model capability is unavailable, manual/fixture review remains supported. A green availability check is not a production acceptance certificate.

## Live model evaluation

`npm run evaluate:model` produces a zero-call plan in ignored `ops-output/model-evaluation.json`.

After the owner configures a process-scoped `MODEL_API_KEY` and authorizes usage, run `COLDSPAN_EVAL_MAX_CALLS=1 npm run evaluate:model -- --live`. Maximum is three calls per invocation. The standalone runner calls Meta directly and does not consume the deployed Worker's daily admission counter. It never retries a failed or unknown request. Re-running is a new paid attempt. No automatic CI job uses live credentials.

The three labeled cases cover exact quantities, uncertainty and missing stock. Scoring checks defended output against semantic labels and requires questions where indicated. This is a starting smoke set, not a representative benchmark. Candidate validation may normalize confidence before scoring, so this does not separately measure raw model uncertainty recognition. Extend the labeled set and add adversarial inputs before making reliability claims. Usage and latency are recorded. Monetary cost remains unknown until current provider pricing is supplied. Raw notes, raw outputs and credentials are excluded from reports.

## Release procedure

1. Run type checks, unit tests, fixture evaluation, Worker dry run, frontend build and Python replay, as in `verify.yml`.
2. Record the Git SHA and current Cloudflare Worker version before deploying. Preserve the existing Durable Object class names and namespaces. Never delete or rename them to repair a failed deployment.
3. Deploy to an isolated staging Worker and isolated storage first. Staging provisioning and deployment credentials are still pending. A dry run does not prove a staging deployment.
4. Run hosted lifecycle checks against staging after making their API origin configurable. Current `verify:live` deliberately targets the existing synthetic API and writes evidence locally.
5. Promote the same reviewed bundle. Run exact-build readiness, hosted lifecycle verification and independent Python replay. Check the actual browser workflow before accepting the release.
6. If a code regression occurs, restore the previously recorded Worker version through Cloudflare deployment controls. A code rollback does not restore data. Re-run readiness and lifecycle checks. No automatic rollback or validated data restoration is claimed.

## Remaining gates

- Account authentication, organization membership, server-side roles, revocation and account-linked recovery are not implemented. Private Site sign-in does not establish API identity. Choose an identity provider and verify its callback on the real Site before replacing reviewer sessions.
- Seven-day reviewer expiry remains in force. Backups, restore drills, permanent retention and migration acceptance still need implementation before retaining customer data.
- Complete authenticated browser flow and physical Android/iOS passes remain unverified.
- Real inventory, shared warehouse reservations, sensors and authenticated receiving remain separate operational integration work.
- Operator user trials and domain validation are still needed before claiming real-world effectiveness.
