# Grounded note intake

The active release supports an interpretation and human-review workflow. Live Meta execution is unavailable: the Worker has no `MODEL_API_KEY` binding and `MODEL_CALLS_ENABLED` is `false`. No live provider call was made during this release. Provider tests use injected responses. The illustrative extraction is a fixed replay, not generated AI output.

## Review path

Create a synthetic drill, optionally with source notes up to 4,000 characters. The selected note becomes immutable initial-state evidence. Load the illustrative extraction for a default note, inspect exact source quotes and uncertainty, and copy candidates into manual review. The confirmation checkbox is reset. Only an explicit facts action can confirm counts. Plans, capacity, approval, reservations and arrival authority retain the deterministic kernel.

The current fixtures still start with six crates of greens and six crates of tomatoes. A contradictory note cannot change that stock. Confirmation fails if the proposed counts disagree with the fixture inventory.

## Adapter and boundary

`cloudflare/meta.ts` implements the documented Meta Chat Completions structured-output contract. It sends one request to the fixed Meta endpoint, allows only the configured standard `muse-spark-1.3` model, caps completion and reasoning output at 1,024 tokens, and stops the request after 15 seconds. It exposes no execution tools, arbitrary provider URL or Contributor model option. Responses are streamed into a bounded 32 KiB buffer. Access denial, rate limits, refusal, truncation, malformed JSON and unknown network outcomes remain explicit failures.

`src/intake.ts` validates candidate shape, known batch IDs, exact unique source quotes, integer quantities, units and uncertainty markers. The conservative English lexical checks recognize digits and number words zero through twenty. This is not general language comprehension, physical fact verification or OCR. Missing facts and uncertain units require human review. Quotes cannot establish whether an observation is true or current. Unsupported output never authorizes movement.

The response record preserves the source hash, prompt version, parsed candidate output, local validation result, provider label, reported usage and observed latency when available. It does not retain credentials or raw HTTP error bodies. There is no independently authenticated provider receipt or external trust anchor.

## Retry and usage boundaries

A server-issued action ID reserves an interpretation record before any provider request. Concurrent retries share that record. Terminal failures and unknown outcomes are not retried automatically. A stranded pending record becomes `UNKNOWN_OUTCOME` after two minutes when checked again. The provider allowance remains counted even if the response was lost.

Configured Meta requests share a server-side ceiling of three admissions per UTC day across the Worker. This is a small experiment limit, not a monetary budget or a production entitlement system. The counter persists in the existing Durable Object namespace. Cleanup cannot erase a counter already used in a new day. A delayed interpretation cannot be applied after the incident version changes.

## Enabling a bounded live check

Owner setup and explicit provider-use authorization remain required. Do not send a key through chat, commit it or place it in client code. Configure `MODEL_API_KEY` in the Cloudflare Worker's secret settings, or use Wrangler's interactive `secret put MODEL_API_KEY` command. Adding the key alone does not enable requests. Keep `MODEL_CALLS_ENABLED=false` until account access, current pricing and an allowed usage limit have been established. Only then change the server flag and perform the small live check.

The first live check must verify actual account/model access, structured-output behavior, usage, latency and failure handling. The public API currently uses isolated reviewer bearers rather than organization accounts. Account-linked identity and production usage authorization remain separate work.

## Evaluation and evidence

`npm run evaluate:intake` checks twenty frozen, hand-authored candidate-validation cases. It records zero provider calls and must not be presented as model accuracy, extraction precision/recall, model benefit or a live-model benchmark. An actual provider evaluation against labeled inputs remains unfinished.

Operational evidence stays schema 1 for drills without interpretation records. Drills with records export schema 2 and a manifest-covered `interpretations.json` artifact. The Python verifier accepts both versions. It independently checks source hashes, quotes, quantities, batch bindings, replay labels and links from human review to the facts-confirmation event. Its checks prove internal consistency, not physical truth or independently verified Meta execution.

## Official protocol references

Retrieved November 3, 2026:

- https://dev.meta.ai/docs/structured-output
- https://dev.meta.ai/docs/api-reference/chat-completions/schemas
- https://dev.meta.ai/docs/models

The endpoint, schema support and model described in these sources do not establish account authorization or event eligibility.
