# Changelog

Changes to Postrail are recorded here. See GitHub Releases for downloadable versioned source packages.

## 1.0.0 — 2026-09-08

This is the first source release. It is an initial self-hosted implementation with a tested local workflow, rather than a claim of established production deployments or customer growth results.

### Added

- A TypeScript/Fastify application with PostgreSQL migrations, persistent jobs, a Telegram inbox, a notification outbox, and versioned content records.
- A configurable content schedule, maintained idea backlog, educational/opinion/project/commercial allocation targets, and recent-topic and format penalties.
- Live structured AI drafting, a separate critic call, bounded generation attempts, source-support heuristics, and fingerprint/lexical repetition checks.
- Turkish natural-language revision handling with server-controlled paragraph IDs, exact preservation of untargeted blocks, deterministic CTA removal, and new approval requirements after edits.
- Telegram private-chat authorization, inline approval actions, draft cancellation, and natural-language postponement using the configured timezone.
- Official LinkedIn publication and OAuth adapters, approval tied to the current version, durable publication attempts, and manual reconciliation for uncertain provider outcomes.
- Optional permission-dependent LinkedIn post metrics, manual measurements, weekly reporting, observed-pattern suggestions, and an exploration allocation.
- An explicit offline mode with 40 distinct fixtures and an executable draft → revise → approve → publication-adapter acceptance flow.
- Setup checks, environment-file generation, Docker/Compose configuration, an optional n8n orchestration workflow, and administration APIs.
- Postrail branding, recorded offline workflow presentation assets, English project documentation, and reusable portfolio content.

### Validation

- 182 automated tests passed, including the native PostgreSQL 17.10 concurrency and workflow checks.
- Type checking, linting, and the application build passed; all three GitHub CI jobs also passed on Node.js 24, PostgreSQL 17, and a Docker-capable runner.
- The offline acceptance flow produced three versions and one publication-adapter call for the final approved version.

See [the validation record](docs/VALIDATION.md) for the environment and evidence. The standard local test command can skip the dedicated native PostgreSQL tests when no test database is configured; use the [PostgreSQL testing guide](docs/POSTGRES_TESTING.md) to run them.

### Current boundaries

- Real OpenAI, Telegram, and LinkedIn account behavior was not validated with live credentials; live model quality and costs were not measured.
- The Docker image builds successfully in GitHub CI. Container startup and optional n8n activation still require deployment verification.
- Turkish is the supported content language, and each deployment has one configured operator.
- The offline fixture pool is finite. Source checks are fallible and do not perform autonomous web fact-checking.
- A default embedding backend, scheduled trend ingestion, a hosted dashboard, billing, and self-service multi-account onboarding are future work.
- LinkedIn publication is not presented as provider-guaranteed exactly-once delivery. Uncertain results stop automatic publication retry and require reconciliation.

Read the [release notes](docs/releases/v1.0.0.md) for the release overview and the [roadmap](docs/ROADMAP.md) for possible next contributions.
