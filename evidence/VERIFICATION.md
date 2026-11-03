# Cloudflare connection verification

Checked November 3, 2026 against backend build `coldspan-cf-20261026-2`.

The resumed source checkout contained the older browser-local interface. The live backend was healthy. Its complete runtime module was recovered through the Cloudflare API and preserved in source. No backend policy or database namespace was changed during this frontend connection.

Observed hosted behavior is recorded in `cloudflare-live-checks.json`. The completed outage export is `cloudflare-hosted-completed.json`. The independent checker result is `cloudflare-hosted-replay.json`. These are synthetic records without session tokens.

Frontend transport tests cover scoped bearer headers, explicit mutation intent, a lost committed response followed by exact-identity recovery, server errors, timeouts, malformed JSON, malformed success receipts and definitive version conflicts. Historical browser-local tests remain clearly separate from the active remote adapter.

The cloud browser reached the private Site's ChatGPT sign-in screen and had no authenticated session. A complete browser walkthrough of the connected release is not verified. API checks and publication do not establish browser interaction, mobile-device compatibility or real-world operation.

An internal Vite preview rendered the interface but its upstream API proxy returned an empty response. Browser workflow verification remained blocked. The attempt exposed a browser-lock dependency, which was removed. Pending requests now use one storage key per action identity so one tab's refusal cannot erase another tab's unknown outcome. A regression test covers that race and legacy journal migration.

The earlier migration reported 23 storage tests and nine hosted checks. Those uncommitted test files and outputs were not retained in the recovered source. Current checked-in commands and outputs are the reproducible evidence for this revision. Do not add historical counts to the current test total.
