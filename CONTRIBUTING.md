# Contributing to Postrail

Postrail turns a content idea into a reviewed draft, a conversation with its owner, and an explicitly approved LinkedIn post. Contributions should make that workflow easier to operate, easier to understand, or harder to misuse.

The project uses Node.js 24, strict TypeScript, Fastify, PostgreSQL, and small provider adapters. Turkish is the current content and Telegram conversation language; English documentation and improvements to Turkish behavior are both welcome.

## Start with the offline workflow

Use Node.js 24 or newer. From the repository root:

```sh
npm ci
npm run check
npm run demo
```

No LinkedIn, Telegram, or AI credentials are needed for this path. `npm run check` runs type checking, linting, tests, and the build. The demo exercises scheduling, draft generation, targeted revision, CTA removal, approval of the latest version, and publication through an explicit recording adapter. It does not send a message or publish a real post.

For an interactive local API and worker:

```sh
npm run dev:offline
```

The offline server binds to `127.0.0.1:3000` and stores PGlite data in `.data/postgres`. Its fixed development credentials are documented in the README and must stay local. Only one process should open that PGlite directory. Use the offline API helpers described in [the API reference](docs/API.md) to inspect recorded messages and submit synthetic Telegram updates.

`npm run doctor -- --offline` checks local configuration without contacting external services. It does not verify that a port is available or that a live account is connected.

## Choose the right validation

| Change | Relevant verification |
| --- | --- |
| Documentation or issue templates | Commands, links, examples, and Markdown/YAML structure |
| Content generation or revision | Content tests; preserve unaffected blocks and source checks |
| Provider adapter | Mock HTTP contracts, error classification, and secret redaction |
| Queue, migration, transaction, or lifecycle | Database tests and real PostgreSQL suites |
| API, scheduler, or approval flow | Workflow tests and the offline acceptance demo |
| Container or dependency change | Full checks and a Docker build when Docker is available |

For code changes, run `npm run check` before requesting review. Include a focused regression test for a behavior change; avoid tests that only repeat implementation details. Do not mark an unrun check as passed.

### Real PostgreSQL

The normal test command skips the real PostgreSQL suites when `TEST_DATABASE_URL` is absent. PGlite tests exercise SQL-backed behavior, but they are not a substitute for independent PostgreSQL connections and locking tests.

Provide a **dedicated, disposable test database**, then run:

```sh
npm run test:postgres
```

Set `TEST_DATABASE_URL` in your shell or development secret mechanism before this command. This script deliberately fails when the variable is missing. Do not point it at a production database. Each suite creates a randomly named schema and drops that schema during cleanup; the database user needs schema creation privileges. See [PostgreSQL testing](docs/POSTGRES_TESTING.md) for setup details.

### Continuous integration

The checked-in GitHub Actions workflow has separate checks for:

- Node.js 24 type checking, linting, ordinary tests, build, and offline acceptance.
- Real PostgreSQL 17 concurrency and workflow tests against an ephemeral service database.
- Building the production Docker image without publishing it.

CI does not receive provider credentials or perform real LinkedIn, Telegram, or AI requests. A passing run verifies the tested code paths; it does not certify provider permissions, security, production deployment, or content quality in a live account.

## Keep the important boundaries intact

1. **Only explicit human approval can authorize publication.** The current draft, approved version, and version selected for publishing must agree. A model response or scheduling endpoint cannot grant that approval.
2. **Telegram commands stay tied to their original context.** Verify the allowed user, private chat, and message/version mapping. Duplicate updates and stale buttons must not affect a newer draft.
3. **A revision creates a new immutable version.** For a request targeting one block, every other block stays unchanged. A previous approval never transfers to edited text.
4. **An uncertain publish result must not trigger a blind retry.** LinkedIn may have accepted a timed-out request. Keep `publish_uncertain` and reconciliation distinct from a definite rejection.
5. **External effects follow durable state.** Keep transactions, leases, deduplication, jobs, and outbox handling in the business layer rather than burying them in a provider adapter or n8n workflow.
6. **Unknown information stays unknown.** Missing analytics are not zeroes. A headline is not a verified fact. A hypothetical case study must not become a claimed personal experience.
7. **Secrets and private content stay out of public artifacts.** Redact credentials and private prompts from exceptions, logs, screenshots, test fixtures, and issue reports.

The LLM is an editorial component. Do not give it publishing credentials, general database write access, or an alternate path around the approval service. Do not add automated direct messages, connection requests, scraping, or browser-based posting as a default integration strategy.

## Where changes belong

| Location | Responsibility |
| --- | --- |
| `src/core/` | Types, configuration, scheduling, state machine, diagnostics |
| `src/content/` | Strategy, structured generation, quality, revision scope, similarity |
| `src/integrations/` | Official provider transports, OAuth primitives, offline adapters |
| `src/services/` | Workflow orchestration, token lifecycle, analytics |
| `src/db/` and `migrations/` | Persistence, transactions, jobs, outbox, schema evolution |
| `src/api.ts` | Validated and authenticated HTTP operations |
| `src/runtime.ts` | Dependency wiring, worker loop, polling coordination |
| `tests/` | Unit, contract, database, and workflow regression tests |
| `n8n/` | Optional orchestration calling the backend |

Reuse existing ports and runtime wiring when adding an integration. Prefer a small, testable adapter to another framework. Keep user scope explicit in repository operations. The current application targets one configured owner; a `user_id` column alone does not make a feature safe for a public multitenant service.

Add a new migration for a schema change. Do not rewrite a migration that existing installations may already have applied. Explain compatibility, migration order, and operator actions in the pull request. Update `.env.example` and relevant documentation when configuration changes, using placeholders only.

## Propose a change

For a bug, use the bug report form and provide a minimal reproduction with synthetic data. Include the affected revision, runtime, mode, expected behavior, actual behavior, and sanitized error text. Describe provider access restrictions separately from an application failure.

For a substantial feature or architectural change, open a focused proposal before implementing it. Explain the user problem, the smallest useful behavior, and how approval, state, and data handling would work. Small fixes and clear documentation improvements can go directly to a pull request.

Keep a pull request focused on one outcome. Describe the concrete problem and resulting behavior, include relevant validation, and identify limitations or follow-up work. If AI assistance was used, review generated material with the same care as any other contribution and verify that you have the right to contribute it.

Do not include `.env`, `.data`, database dumps, personal draft history, access tokens, OAuth callback URLs containing codes, or private provider responses. Review the actual staged diff before submitting. An ignored path does not make previously tracked secrets safe.

Potential authorization bypasses, secret exposure, unintended publication, and cross-user data access should follow [SECURITY.md](SECURITY.md). Do not disclose exploit details in a public issue or pull request before a private reporting channel is established.

Use clear, respectful technical discussion. Explain tradeoffs and evidence, avoid personal remarks, and help reviewers reproduce behavior without needing access to your accounts.
