# Roadmap

The current scope is a self-hosted, single-operator workflow for LinkedIn text posts, with Telegram as the human review interface. This roadmap separates implemented capabilities from possible extensions. Future items are contribution directions, without release dates or delivery commitments.

## Available in the repository

| Area | Implemented behavior | Current boundary |
| --- | --- | --- |
| Content planning | Configurable posting schedule, persistent idea backlog, topic/format selection, and rolling content-pillar targets. | Turkish is the supported content language. A backlog refill can return fewer valid ideas than requested. |
| Live drafting | Responses-based structured generation, separate writer and critic calls, bounded regeneration, source checks, and repetition checks. | Requires a configured model and API account. Checks are fallible; live writing quality is not established by fixtures. |
| Human review | Telegram allowlist, inline actions, scoped natural-language edits, version history, cancellation, and postponement. | One configured operator per deployment. Ambiguous edit references require clarification. |
| Publishing | Official LinkedIn integration, OAuth support, version-bound approval, persistent attempts, and reconciliation for uncertain outcomes. | Product access and permissions are account-dependent. An uncertain POST is not blindly retried; provider-side exactly-once delivery is not assumed. |
| Analytics | Optional permission-dependent post analytics, manual measurements, weekly reports, and observed-pattern suggestions with exploration. | Missing data stays missing. The current weighted score uses impressions, reactions, comments, and reposts; it does not optimize directly for revenue or attributed leads. |
| Local evaluation | Finite offline content fixtures, an executable acceptance flow, database migrations, and automated tests. | Offline output is illustrative. See [VALIDATION.md](VALIDATION.md) for the distinction between completed checks and unverified external environments. |
| Operations | Docker/Compose configuration, persistent jobs and notifications, structured logs, setup checks, and administration APIs. | Deployment files and local tests do not establish that a particular production installation is validated. |
| Extensibility | Content and integration interfaces, tenant-aware persistence, optional embedding interface, and a bounded Hacker News source adapter. | No hosted SaaS onboarding, billing, default vector backend, or scheduled trend-ingestion pipeline. |

## Possible next contributions

### Editorial quality and evaluation

- A maintained Turkish evaluation corpus covering natural style, claim support, paragraph targeting, and adversarial source text.
- More precise claim-to-source references and an operator review workflow for provenance.
- Additional revision forms with explicit preservation tests and safe ambiguity handling.
- A persistent embedding provider and index, with measurable comparison against the existing lexical detector.
- Configurable language packs with tested prompts, revision parsing, examples, and locale behavior.

Any new quality mechanism should publish its limitations and keep the final human approval requirement.

### Research and learning

- Scheduled ingestion for approved trend sources, with source deduplication, retention, provenance, and user-controlled verification.
- Additional source adapters, such as allowlisted RSS feeds or permissioned product feeds.
- Clearer experiment attribution, sample-quality checks, and uncertainty-aware performance reports.
- Optional lead attribution and business-outcome analysis, based on supplied measurements rather than inferred customer results.
- Proposed schedule changes that the operator can review before applying them.

The existing Hacker News adapter is a starting point for collecting research leads. It does not constitute an autonomous fact-checking pipeline.

### Review experience and publishing formats

- A web dashboard for the calendar, draft history, ideas, measurements, configuration, and brand memory.
- More visible paragraph-level review and comparison between versions.
- Image posts, carousels, diagrams, articles, or other formats where official API access supports the intended operation.

Each additional format needs its own validation and approval behavior. Text-post support should remain usable without requiring media generation.

### SaaS and deployment operations

- Multi-account onboarding, per-tenant credentials, authenticated user sessions, quotas, and billing.
- Operational dashboards for job duration, provider cost, stalled work, and token lifecycle events.
- Deployment-specific backup/restore validation and broader production-like PostgreSQL concurrency exercises.
- Retention controls, data export, deletion workflows, and explicit migration guidance for hosted deployments.

Tenant-aware tables and worker queries provide a foundation. They are not equivalent to a complete multi-tenant SaaS product or an independently audited security boundary.

## Boundaries to preserve

- Publishing always requires explicit human approval of the current version.
- Source text and model output never grant publishing authority.
- Missing measurements never become invented performance results.
- Real account connections and live validation are reported separately from offline demonstrations.
- Organic inbound content remains the focus; automated DM campaigns and connection-request spam are outside the project scope.

For the current content behavior, read [CONTENT_ENGINE.md](CONTENT_ENGINE.md). For integration contracts and local setup, start with the [README](../README.md).
