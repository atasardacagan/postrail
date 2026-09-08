# Validation record

Recorded on **2026-09-08**, macOS arm64, Node.js 26.5.0 and npm 11.17.0. The deployment target and GitHub Actions configuration use Node.js 24. Local Node.js 24 container execution was not available on this machine.

## Observed results

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; no warnings |
| Full suite with disposable native PostgreSQL 17.10 | **182 PASS; 0 skipped; 10 test files** |
| Standard suite without `TEST_DATABASE_URL` | 173 PASS; 9 explicit PostgreSQL tests skipped |
| `npm run build` | PASS |
| `npm run demo` | PASS; real scheduler, three versions, one fixture publication |
| `npm run demo:record` | PASS; captured state and preserved-block assertions for showcase |
| `npm run assets:render` | SVG, PNG and 16-second GIF generated; visual review performed |
| `npm audit --omit=dev` | No known production dependency vulnerabilities reported |
| `npm run doctor -- --offline` | PASS for local offline options |
| `npm run doctor` with unfinished live configuration | Expected exit 1, no credential values printed |
| `npm run test:postgres` without an explicit test URL | Expected exit 1; no silent success |
| Environment generation | Independent random secrets, consistent database password, mode 0600, no overwrite, symlink and concurrent creation protection |

A temporary PostgreSQL 17.10 process bound only to localhost, used a disposable database and generated test password, and stopped after the suite. It ran the actual `pg` driver and separate connection pools. An earlier restricted session could not bind a port; after the environment changed, the native verification completed successfully. The temporary harness fix corrected a shadowed `resolve` function; application business logic did not change.

Earlier local HTTP smoke verification also exercised authorization rejection and the full v1 → v2 → v3 → approval → published flow, including persistence after restart. Current automated HTTP handler checks use Fastify injection. Those records are separate from a public deployment or live provider test.

## Test coverage

| Suite | Tests | What it checks |
| --- | ---: | --- |
| Schedule and configuration | 9 | Istanbul calendar, postponement parsing, invalid times and production mock guard |
| Provider contracts | 44 | Telegram boundaries, LinkedIn payload/API behavior, definite vs ambiguous failures, OAuth encryption and nullable analytics |
| Content | 30 | Distinct fixtures, editorial mix, learning/exploration, bounded idea batches, scoped edits, repetition and unsupported claims |
| Database rules | 25 | User scope, immutable records, lifecycle, current approval, leases/fencing, receipt-time target binding and outbox |
| Persistent OAuth | 3 | Single-use state, encrypted tokens, conditional serialized refresh |
| End-to-end workflow and API | 18 | Main acceptance flow, unauthorized/stale/cancelled/postponed behavior, recoverable failure and metric validation |
| Configuration diagnostics | 38 | Missing/example fields, independent secrets, safe report output and runtime options |
| Environment initialization | 6 | Randomness, password consistency, file permissions, no overwrite and concurrent creation |
| Native PostgreSQL concurrency | 8 | Separate-pool contention, migration, approval/version races, publication claims, job serialization and deduplication |
| Native PostgreSQL workflow | 1 | Scheduler through scoped revisions, explicit approval, one publication and durable notification |

The first 173 tests do not require a separate database server. SQL checks use PGlite's PostgreSQL WebAssembly engine and real migrations, not a JavaScript map pretending to be a database. The remaining nine require `TEST_DATABASE_URL`; see [PostgreSQL testing](POSTGRES_TESTING.md). A successful local suite is not a claim that remote GitHub CI has already run.

## Acceptance scenario

1. A real scheduler enqueues a due generation job; the recording accelerates the slot while dedicated tests verify the default calendar.
2. Idea selection and quality review produce v1 for the Telegram adapter.
3. `girişi daha kısa ve vurucu yap` produces v2; non-hook blocks remain identical.
4. `CTA’yı çıkar` produces v3; only the CTA is removed.
5. No publication occurs before `onayla` explicitly approves v3.
6. The publication adapter receives v3 once.
7. PostgreSQL stores the publication and a durable success notification.
8. Duplicate updates, stale buttons, delayed approvals and repeated workers do not authorize another version or create another successful publication call in these scenarios.

Offline URLs use `example.invalid`. Demo content is a fixture, not live model output. Visuals show recorded application state in a composed layout; no shipped dashboard or audience growth is implied.

## Still requires external validation

- Real Telegram, OpenAI and LinkedIn credentials, product permissions, OAuth and a specifically approved first post.
- Actual model output quality, factual accuracy and account-specific costs.
- Docker container build/boot, persistent volume behavior and public TLS deployment on a Docker-capable host. The CI workflow includes a build job; its existence alone is not a passing result.
- Optional n8n workflow import/activation and optional LinkedIn analytics permission.

No autonomous web fact-checking or external exactly-once guarantee is claimed. Uncertain LinkedIn creation outcomes halt automatic retries for operator reconciliation. See [architecture](ARCHITECTURE.md), [security](../SECURITY.md) and [live setup](SETUP.md).
