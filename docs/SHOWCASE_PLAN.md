# Open-source showcase plan

## What the code actually does

This is a TypeScript service, not a web dashboard. Fastify exposes a protected management API; a worker schedules jobs and drains PostgreSQL-backed queues. Telegram is the human interface. OpenAI Responses generates and reviews Turkish text. Official LinkedIn OAuth and Posts adapters publish only an approved immutable version. Postgres stores content, approvals, inbox/outbox, jobs and measurements. PGlite and explicit fixture adapters support account-free local verification.

The engineering focus is accountable automation: revisions preserve untargeted blocks, old approvals do not authorize new text, and uncertain external publish outcomes stop automatic retries. Metrics are optional and missing observations stay missing. This is a single-operator deployment with user-scoped queries, not a finished multi-tenant SaaS.

## Positioning and identity

**Postrail** — AI drafts. You decide what ships.

Repository slug: `postrail`. Description: AI LinkedIn content with Telegram approval, scoped revisions, durable scheduling, and optional analytics. Self-hosted TypeScript + PostgreSQL.

Public source repository: [atasardacagan/postrail](https://github.com/atasardacagan/postrail). The repository exists and the source has been pushed. The [README workflow presentation](https://github.com/atasardacagan/postrail#watch-the-workflow) is the public workflow CTA; it presents recorded offline fixture behavior, not a hosted application.

The intended personal portfolio origin is `https://www.ardacaganatas.com`. That website is not live in this project context and has not been modified. No deployed portfolio page or live application demo is claimed. Source publication, a versioned GitHub release, and deployment to the personal website are separate steps; publishing the source does not imply the other two are complete.

Five shortlisted names were evaluated for clarity, recall and obvious product-name overlap:

| Name | Assessment | Decision |
| --- | --- | --- |
| Postrail | Short; suggests a deliberate route from draft to publication; independent of LinkedIn branding | Selected |
| Draftlane | Clear workflow metaphor, but an existing content operations product uses the name | Rejected — [existing product](https://www.trydraftlane.com/) |
| Postward | Clear direction metaphor, but an existing AI care platform uses the name | Rejected — [existing product](https://www.postward.ai/) |
| DraftRelay | Good handoff metaphor, but an existing agent-artifact outbox uses the name | Rejected — [existing project](https://glama.ai/mcp/servers/raashy/draftrelay) |
| Postweave | Good content metaphor, but a closely related social automation repository uses the name | Rejected — [existing repository](https://github.com/Srashtiijain05/postweave) |

The limited name search is not a reservation of a domain, account or trademark. No availability claim is made.

## Implementation sequence

1. Audit code, runtime, source files, existing Git history and service limits.
2. Write an English README with a fast account-free path; keep Turkish operator instructions.
3. Add a proportionate MIT license, contribution/security guidance, issue/PR templates and reproducible CI.
4. Create an original vector identity, PNG hero/social/card exports and an accurately labeled offline workflow replay.
5. Prepare portable portfolio copy and metadata using the actual [public repository](https://github.com/atasardacagan/postrail) and its workflow section; leave the unpublished personal website and hosted demo destinations unset.
6. Prepare a versioned source release, release notes, a publication checklist and source-secret checks.
7. Verify commands, real PostgreSQL tests, local links, asset rendering and clean release contents.

## Acceptance criteria

- The first README screen explains LinkedIn content + Telegram approval and shows the real workflow.
- A developer can run a complete fixture scenario with no provider credentials.
- The real application approval/revision/publish behavior stays intact.
- Visuals cannot be mistaken for a shipped dashboard, a live account recording or an official LinkedIn product.
- No fake CI status, users, stars, downloads, growth claims or hosted demo link.
- Public source and history contain no local secrets or personal environment data; synthetic fixture credentials are clearly marked.
- Public release status is distinguished from prepared release material.
