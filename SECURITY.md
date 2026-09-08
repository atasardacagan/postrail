# Security policy

Postrail handles publishing credentials, private drafts, and actions that can appear under a real person's LinkedIn account. Its central security property is that the application must not publish a draft without the configured owner's explicit approval of that version.

**This project has not undergone an independent security audit.** Automated tests, local checks, and code review provide evidence for specific behavior; they are not a security certification or a guarantee that a deployment is free of vulnerabilities.

## Report a vulnerability privately

Private vulnerability reporting is enabled for the official repository. Open its **Security** tab and choose **Report a vulnerability**, or use the [private reporting form](https://github.com/atasardacagan/postrail/security/advisories/new). Submit details through that private advisory flow. Forks must enable their own reporting settings. [GitHub's private reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

If that option is unavailable, ask a maintainer for a private reporting channel. You may open an issue titled **Request for a private security reporting channel**, containing only that request. Do not include the vulnerability, affected account, exploit, sensitive logs, or credentials in the public issue. No private email address or response-time commitment is implied by this policy.

Once a private channel is established, provide:

- The affected commit or version and relevant component.
- A description of the impact and trust boundary involved.
- Minimal reproduction steps using an isolated local deployment and synthetic data.
- The expected protection and behavior observed.
- Any suggested mitigation, patch, or regression test.

Remove real tokens, authorization headers, cookies, database credentials, private drafts, and OAuth codes. If a credential has already been exposed, revoke or rotate it at the provider; deleting a public message does not revoke a credential.

Coordinate disclosure with the maintainer so a fix or mitigation can be assessed before exploit details become public. There is no published bug bounty or guaranteed response schedule. Report an issue even if you cannot reproduce it on the latest commit, but identify the version tested.

## Scope and maintenance

Security work currently targets the latest code on the repository's default branch. There is no announced long-term support or backport policy for earlier snapshots. Operators are responsible for tracking changes, reviewing migrations, and maintaining their runtime and dependencies.

Reports of the following are particularly relevant:

- Publishing without approval, publishing a stale or different version, or bypassing cancellation/postponement.
- Unauthorized Telegram commands, forged webhook requests, state-changing replay, or invalid message-to-draft binding.
- Credential exposure, unsafe OAuth state handling, token storage failures, or unauthorized account rebinding.
- Access to another user's drafts, sources, configuration, jobs, or analytics.
- Injection that crosses from untrusted content into privileged behavior.
- Queue or concurrency behavior that causes an unintended duplicate publication.

Report vulnerabilities in Telegram, LinkedIn, OpenAI, or a dependency to the relevant upstream project when appropriate. An unavailable API permission, expired token, model refusal, or difference in provider analytics is not by itself an application security vulnerability.

## Trust boundaries in this version

| Boundary | Implemented protection and practical limit |
| --- | --- |
| Telegram commands | The application checks the configured user ID, private chat, and chat ID, then binds actions to stored draft/version context. Control of that Telegram account remains control of the approval interface. |
| Telegram webhooks | A separate secret header authenticates delivery. Protect it as a credential; JSON sender IDs are not independently trustworthy without the authenticated delivery boundary. |
| Management API | Administrative routes require a bearer token with broad owner-level access. It is not a role-based access system. Health routes and the state-protected OAuth callback have different access rules. |
| Human approval | Durable approval and version checks gate publication. LLM output cannot authorize a post. Process and database administrators are outside this protection and must be trusted. |
| LinkedIn publication | Official API transport classifies ambiguous results and avoids automatic retry when acceptance is uncertain. It does not claim provider-backed exactly-once delivery. |
| OAuth storage | Token records use AES-256-GCM with user-bound context; OAuth state expires and is consumed once. Protect and back up the encryption key separately from the database. |
| Content and sources | Scope-limited edits, structured responses, and quality checks constrain content. They do not prove every factual claim or make a model immune to prompt injection. |
| Persistence | Application queries carry user scope. This version does not provide PostgreSQL row-level security or a complete public multitenant identity boundary. |

Private drafts, source notes, preferences, and history may be included in live AI requests. LinkedIn receives the approved post; Telegram receives drafts, reports, and workflow messages. Review what is sent to each provider before using sensitive material. Content tables are not all encrypted by the application; protect database storage and backups appropriately.

## Deployment responsibilities

Use `npm run env:init` to generate distinct local secrets and `npm run doctor` to inspect configuration without printing values. Doctor performs stricter placeholder and secret-separation checks than startup validation, and it does not connect to or verify external accounts. A successful startup does not prove a secret is unique or suitable for production.

Keep fixed offline credentials and mock endpoints restricted to local development. Production must use `APP_MODE=live` and its own secrets. The supplied Compose configuration binds the API to host loopback and runs application containers without root privileges; operators must still configure the reverse proxy, TLS, network access, database credentials, backups, and monitoring.

Use HTTPS for public traffic and protect administrative endpoints with appropriate network controls. Configure database transport and certificate verification for the deployment environment. Keep authorization headers, Telegram token-bearing URLs, and OAuth callback query strings out of reverse proxy and infrastructure logs as well as application logs.

If a publish attempt enters `publish_uncertain`, inspect the LinkedIn profile before taking further action. Reconciliation records a confirmed existing publication; a missing response is not evidence that publication failed. Do not manually change database status to force another attempt.

Do not test security hypotheses against another person's account or a live deployment without permission. Prefer recording adapters, local test databases, and focused regression tests. The test suite must not require real publishing credentials.
