# Postrail

**AI drafts. You decide what ships.**

Postrail is a self-hosted LinkedIn content workflow that combines AI drafting, natural-language revisions, Telegram review, and publication through the official LinkedIn API. It keeps the final decision with the person whose name appears on the post.

## Portfolio card

**Postrail — Human-approved AI content workflows**

An AI-assisted LinkedIn publishing system with a persistent idea backlog, scoped text revisions, Telegram approval, and version-aware publishing. Built with TypeScript, Fastify, and PostgreSQL, Postrail makes a simple interaction—“shorten the opening,” then “approve”—work across durable state, external APIs, and failure recovery.

**Focus:** AI automation · Backend engineering · API integrations · Content operations

**Primary CTA:** [Explore the source](https://github.com/atasardacagan/postrail).

**Secondary CTA:** [View the workflow](https://github.com/atasardacagan/postrail#watch-the-workflow).

## The problem

Consistent professional content involves more than finding a topic and generating a paragraph. Someone has to choose a useful angle, avoid repeating earlier posts, edit the wording, confirm the final text, handle publishing failures, and decide what to learn from the available measurements.

Automating those steps introduces another problem: the person reviewing a draft must know exactly what their approval will publish. A later revision, a delayed message, or an uncertain API response must not quietly change that decision.

## The solution

Postrail brings the review loop into Telegram. A scheduled job selects an idea, generates a Turkish draft, and runs quality checks before sending it for review. The operator can approve it, request a natural-language revision, rewrite it from another angle, cancel it, or postpone it.

Each accepted edit becomes a new version. “Make the opening shorter and stronger” changes the opening block; “remove the CTA” removes the closing call to action while preserving the other paragraphs. The operator then approves the current version. The content model itself has no publishing authority.

## What makes the project distinctive

- **An enforceable approval boundary.** The writing interface cannot approve or publish. Human approval is recorded against a specific current version in the application and database workflow.
- **Edits with a defined scope.** The server identifies allowed paragraph IDs before the model edits text. Changes outside that set are rejected, preserving untargeted paragraphs exactly.
- **State that survives the happy path.** Persistent jobs, publication attempts, and notification records support retries and recovery. An uncertain publish result pauses automatic retry until the operator reconciles the outcome.
- **A content backlog with an editorial policy.** Topic selection balances educational, opinion, project, and soft-commercial posts while reducing recent format and topic repetition.
- **Learning with visible limits.** Available measurements can influence category, format, opening type, length, and CTA suggestions. Exploration remains part of selection; missing metrics are not invented.
- **A reproducible local workflow.** Forty distinct offline fixtures let contributors exercise the review and publication lifecycle without external account credentials.

## Engineering decisions

Business logic lives in a TypeScript backend, with PostgreSQL holding workflow state. Telegram is the review interface, the LLM handles writing and bounded editing, and the LinkedIn adapter handles publication. An optional n8n workflow can orchestrate backend calls without becoming the source of truth for approval.

The live content engine uses structured Responses API output with runtime validation. A separate critic call reviews quality and source support; deterministic checks cover structure, selected claim patterns, length, style, and repetition. These checks can reject or request another candidate. They do not prove factual accuracy.

The default similarity check uses normalized fingerprints and lexical comparison. The project exposes an embedding interface for future providers without claiming that vector search is enabled today. Model requests and idea batches are bounded so a weak response cannot create an unlimited generation loop.

## Stack and architecture

| Responsibility | Implementation |
| --- | --- |
| Application | TypeScript, Node.js, Fastify |
| Durable state | PostgreSQL, SQL migrations, persistent jobs and notification outbox |
| Local evaluation | PGlite, Vitest, offline content and integration adapters |
| AI drafting and editing | Responses API, strict JSON schemas, Zod validation |
| Human review | Telegram Bot API, private-chat operator allowlist |
| Publishing | Official LinkedIn API and OAuth integration |
| Operations | Docker/Compose configuration, structured logs, setup checks |

```text
Schedule → Idea selection → AI draft → Quality checks → Telegram review
                                                         │
                           Scoped revision ←──────────────┤
                           Cancel / postpone ←────────────┤
                           Explicit approval ─────────────┘
                                  ↓
                       Publish approved current version
                                  ↓
                       Store result → Notify operator
                                  ↓
                  Available metrics → Future suggestions
```

## Demonstrated behavior and current limits

The local acceptance flow exercises scheduling, initial drafting, opening revision, CTA removal, explicit approval, and one publication-adapter call with the final version. The recorded validation has 182 passing automated tests, including the native PostgreSQL 17.10 concurrency and workflow tests. Additional cases cover stale approvals, unauthorized actors, cancelled and postponed posts, provider failures, and persistence behavior. All three GitHub CI jobs passed, including the production Docker image build. Live provider connections and full deployment startup remain separately unverified; the validation record keeps those limits explicit.

This is an implemented engineering project, with live integration adapters and a runnable offline workflow. It is not a claim of deployed customer usage, measured audience growth, or production account validation. The current content language is Turkish, each deployment has one configured operator, and the offline fixture backlog is finite. A hosted SaaS dashboard, billing, and self-service multi-account onboarding are future work.

See [the content engine](../docs/CONTENT_ENGINE.md), [validation record](../docs/VALIDATION.md), and [roadmap](../docs/ROADMAP.md) for the implementation details and limits.

## Showcase assets

The following verified assets are included in the public source repository and portfolio package. Paths are relative to the repository root, ready for the website to import or copy. The presentation uses the recorded offline fixture workflow; it must not be captioned as a shipped web dashboard or a live LinkedIn account result. Designed cover art is illustrative. See the [asset provenance](../assets/README.md) for the recorded data and presentation details.

| Asset | Intended use |
| --- | --- |
| `assets/hero.png` | Project hero illustration. |
| `assets/social-preview.png` | Social share preview. |
| `assets/showcase/project-card.png` | Compact portfolio card image. |
| `assets/showcase/workflow.png` | Static presentation of the fixture approval workflow. |
| `assets/demo/workflow.gif` | Animated presentation of the recorded offline workflow. |
| `assets/brand/logo.svg` | Postrail identity mark. |

Suggested workflow caption: **“Recorded offline workflow: draft, revise, approve, publish through the fixture adapter.”**

## Website integration

`project.json` contains the reusable project data. The intended portfolio origin is `https://www.ardacaganatas.com`; the personal website is not live in this project context and has not been modified. No portfolio page route or hosted application demo is assumed.

The public repository is [atasardacagan/postrail](https://github.com/atasardacagan/postrail), and the source has been pushed. The source CTA and the [README workflow presentation](https://github.com/atasardacagan/postrail#watch-the-workflow) CTA are enabled in `project.json`. The workflow destination is recorded offline content, not a hosted application. `liveDemoUrl` and `portfolioPageUrl` remain `null`; keep them unset until those destinations actually exist. Repository asset paths do not imply that the personal portfolio website has been deployed.

## Short Turkish card

**Postrail — AI hazırlar, son kararı sen verirsin.**

AI ile LinkedIn taslakları hazırlayan, doğal dilde revizyon alan ve Telegram üzerinden açık onay bekleyen içerik sistemi. TypeScript, Fastify ve PostgreSQL ile geliştirilen yapı; her değişikliği sürümler, onaylanan son metni yayınlar ve belirsiz API sonuçlarında kontrolü kullanıcıda tutar. Yerel örnek akış gerçek hesap bağlantısı gerektirmeden denenebilir.

**CTA:** [Kaynak kodunu incele](https://github.com/atasardacagan/postrail).
