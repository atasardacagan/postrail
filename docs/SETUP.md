# Set up Postrail

Postrail is a self-hosted backend with Telegram as its review interface. This guide takes you from an account-free local test to your own connected deployment. The current content and conversation language is Turkish, and each deployment serves one configured operator.

**A scheduled time creates a draft for review. It never authorizes publication.** Every new version needs your explicit Telegram approval before it can reach LinkedIn.

For the detailed Turkish operator guide, see [SETUP.tr.md](SETUP.tr.md). For request schemas and offline simulation examples, see [API.md](API.md).

## 1. Run the account-free acceptance test

Install Node.js **24 or newer** and npm. From the repository root:

```sh
npm ci
npm run check
npm run demo
```

This path requires no `.env`, Docker, provider credentials, or social account. The demo runs the real scheduler, migrations, persistence, revision handling, and approval gate with explicit offline writer/Telegram/LinkedIn adapters. It prints the result of one simulated publication, not a real LinkedIn URL.

To keep a local API and worker running:

```sh
npm run dev:offline
```

The server listens on `http://127.0.0.1:3000`; `/health/ready` returns its status. Data persists in `.data/postgres` using PGlite. This is an API, not a web dashboard. Only one process may open that PGlite directory at a time.

The local-only admin token is `offline-only-local-admin-token-0001`, and its simulated Telegram user is `123456`. Do not use these public fixture values in a live deployment. The [offline API examples](API.md#offline-geliştirme-yardımcıları) explain how to request drafts, inspect recorded messages, and simulate commands.

## 2. Create your private configuration

```sh
npm run env:init
```

This creates `.env` from [`.env.example`](../.env.example), generates independent admin/webhook/encryption secrets, generates a PostgreSQL password, and writes the file with owner-only permissions. The generated `DATABASE_URL` uses that same database password. An existing `.env` is preserved; do not delete it just to regenerate keys.

Edit `.env` locally. Keep `APP_MODE=live` for connected use. Keep the encryption key stable and back it up separately from the database: replacing it makes existing OAuth token records unreadable. Do not commit `.env`, `.data`, database dumps, or real credentials.

The important fields are:

| Configuration | What to provide |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Your BotFather token |
| `TELEGRAM_ALLOWED_USER_ID` | Your actual numeric Telegram user ID |
| `LLM_API_KEY` | Your OpenAI API key |
| `LLM_MODEL` | A model your API account can access; default `gpt-5-mini` |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Your LinkedIn Developer App credentials |
| `LINKEDIN_REDIRECT_URI` | The exact registered OAuth callback URL |
| `DATABASE_URL` | Your PostgreSQL connection; Compose sets the internal host automatically |
| `POSTGRES_PASSWORD` | Used by the supplied Compose PostgreSQL service |
| `ADMIN_API_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Independent generated secrets |
| `TOKEN_ENCRYPTION_KEY` | Generated 32-byte key represented as 64 hex characters |

`LINKEDIN_API_VERSION` defaults to `202605`. Keep it on a supported provider version when deploying. `LINKEDIN_ANALYTICS_ENABLED=false` is the correct starting point unless the app has additional analytics access.

## 3. Create a Telegram bot and obtain your user ID

1. Open the official [BotFather](https://t.me/BotFather) in Telegram and use `/newbot`.
2. Save the resulting token in `TELEGRAM_BOT_TOKEN`.
3. Open a **private chat** with your new bot and send `/start`.
4. Before starting the worker, inspect the ID on your own private message using this local command:

```sh
node --env-file=.env --input-type=module <<'NODE'
try {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error();
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error'
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error();
  const identities = (result.result ?? []).flatMap(update => {
    const message = update.message;
    return message?.chat?.type === 'private' && message.from
      ? [{ userId: message.from.id, chatId: message.chat.id }]
      : [];
  });
  console.log(JSON.stringify(identities, null, 2));
} catch {
  console.error('Could not read Telegram updates. Check the bot token and polling/webhook configuration.');
  process.exitCode = 1;
}
NODE
```

The command reads the token from `.env` and prints only IDs, not the token, raw provider response, or a token-bearing error URL. Choose the ID belonging to **your own message** and save it as `TELEGRAM_ALLOWED_USER_ID`. This is not the bot ID or an `@username`. In a private chat, your user ID and chat ID match.

If the result is empty, send another private message and retry. An existing bot with an active webhook cannot also use `getUpdates`: obtain your identity from its existing private update delivery or change its delivery mode after completing the configuration below. Do not run this bootstrap command beside an active polling worker. The [official Bot API](https://core.telegram.org/bots/api#getupdates) documents update delivery.

## 4. Configure LinkedIn Developer App access

1. Create or select your app in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps). Complete the portal's application and associated-page verification steps.
2. Enable the **Share on LinkedIn** product and confirm that the app can request `w_member_social`.
3. Enable **Sign In with LinkedIn using OpenID Connect** so the app can request `openid profile` and retrieve your author identity through the official `userinfo` endpoint.
4. Register a callback URL in the app's OAuth settings, for example `https://your-own-host/oauth/linkedin/callback`. Replace the example host with your real HTTPS host. Set `LINKEDIN_REDIRECT_URI` to exactly the same URL, including its scheme, port if present, and path.
5. Copy the client ID and client secret into `.env`. They belong in the server environment, not a public page or an n8n workflow.

Postrail requests `openid profile w_member_social`. The publishing adapter uses `POST https://api.linkedin.com/rest/posts` with the configured API version and a personal `urn:li:person:...` author. Product access is a provider-side requirement; code cannot grant an unapproved permission. See the official [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-05) and [OpenID Connect guide](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).

An alternative is a pre-issued `LINKEDIN_ACCESS_TOKEN` plus `LINKEDIN_AUTHOR_URN`, with the OAuth client fields left empty. That token is not automatically refreshed. When all three OAuth fields are configured, runtime uses the stored OAuth connection in preference to the environment token.

## 5. Check configuration and choose Telegram delivery

```sh
npm run doctor
```

Fix every missing or invalid field before live use. Doctor prints key names and fixed guidance without exposing secret values. It detects placeholders and reused secrets more strictly than startup validation. It does not test database connectivity, API permissions, token validity, DNS, or live model output.

For an account-free local check or machine-readable output:

```sh
npm run doctor -- --offline
npm run doctor -- --json
```

The easiest initial Telegram mode is `TELEGRAM_MODE=polling`. Once all required live fields are present, run:

```sh
npm run telegram:configure
```

This removes an existing webhook without dropping pending updates. Polling requires no public Telegram inbound URL. OAuth still needs a callback URL reachable by your browser and accepted by LinkedIn.

For webhooks, set `TELEGRAM_MODE=webhook` and register your real public HTTPS endpoint:

```sh
npm run telegram:configure -- https://your-own-host/webhooks/telegram
```

The command registers `TELEGRAM_WEBHOOK_SECRET` with Telegram. The reverse proxy must preserve `X-Telegram-Bot-Api-Secret-Token`. A request with the wrong secret receives `401`; an arbitrary sender ID in JSON does not grant access. Polling and webhook delivery must not run concurrently for the same bot. These configuration commands contact Telegram but do not publish a LinkedIn post.

## 6. Start the API, worker, and database

### Docker Compose

On a machine with Docker Engine and Compose:

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api worker
curl http://127.0.0.1:3000/health/ready
```

Compose starts PostgreSQL 17, waits for its health check, applies migrations, and starts separate API and worker containers. It overrides `DATABASE_URL` inside the containers to use the `postgres` service and generated password. PostgreSQL data lives in a named volume. `docker compose down -v` deletes that volume, so do not use it as a routine restart command.

The API binds to host `127.0.0.1:3000`. Configure your HTTPS reverse proxy to reach it, route `/oauth/linkedin/callback`, and, when applicable, `/webhooks/telegram`. Keep management endpoints behind appropriate access controls. The worker must stay running to process drafts, updates, publication jobs, and notifications.

Changing `.env` requires recreating the affected containers. Setting the environment file's `PORT` does not update the fixed Compose port mapping and health command; keep port 3000 or change those settings together.

### Native Node.js with your PostgreSQL server

Provision a dedicated PostgreSQL database and set its real `DATABASE_URL`. The generated URL is configuration, not a database installer. Configure TLS and certificate verification as required for your database provider.

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

In a separate terminal with the same private configuration:

```sh
npm run start:worker
```

For development with source files, use `npm run dev` and `npm run worker`. Use `HOST=127.0.0.1` for a native server behind a local proxy. Production should use `NODE_ENV=production` and `APP_MODE=live`.

`/health/live` checks the API process; `/health/ready` checks database access. Neither verifies worker progress or external accounts. Inspect `/v1/jobs` and the worker logs separately.

## 7. Authorize your LinkedIn account

The following API examples assume `ADMIN_API_TOKEN` is already available in your current shell through your private environment or secret manager. Do not paste a real token into shared commands, issue reports, or logs.

```sh
curl -s http://127.0.0.1:3000/v1/linkedin/connect \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Open the returned `authorizationUrl` in your own browser. Sign into the intended LinkedIn account and grant the requested permissions. On success, the callback reports that the account is connected. **Connecting an account does not publish anything.**

```sh
curl -s http://127.0.0.1:3000/v1/linkedin/status \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Status reports stored identity, scope, and expiry information without returning token values. It does not prove that LinkedIn has not subsequently revoked the token. Authorization state expires after 10 minutes and is single-use; obtain a new connect URL if it expires or the flow fails.

LinkedIn does not issue programmatic refresh tokens to every self-service app. Postrail refreshes only when a valid provider-issued refresh token is stored; otherwise, reconnect when the access token expires. [LinkedIn's programmatic refresh documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)

## 8. Review and publish your first draft

Confirm that your bot's private chat has received `/start`. Queue a draft:

```sh
curl -X POST http://127.0.0.1:3000/v1/drafts/generate \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

HTTP `202` means the job is queued. The worker fills the idea backlog, generates content, runs separate quality review, and sends a passing draft to Telegram. Initial idea generation and review require live AI calls and can take time.

Reply to that draft in Telegram:

1. `girişi daha kısa ve vurucu yap` — shorten and strengthen the opening.
2. After the new version arrives, `CTA’yı çıkar` — remove the CTA.
3. Read the final version and send `onayla`, or use that version's approval button.

Only the explicitly approved current version can publish. A successful publication stores its LinkedIn identity and sends the resulting URL to Telegram. If several drafts are open, reply to the specific draft or use its inline button. An old version's button does not approve new text.

`iptal` cancels a draft. `yeniden yaz` requests another angle. `2 saat ertele`, `yarına ertele`, `akşam 7'ye al`, and `Cuma günü paylaş` postpone it using the configured timezone; the new time requires fresh approval. Requests that identify only “this part” may require a paragraph number or a quote to clarify the edit scope.

## 9. Change the calendar and editorial preferences

Default preparation times are Tuesday, Thursday, and Saturday at 10:30, `Europe/Istanbul`. The weekly report defaults to Sunday at 18:00. Update database settings without editing source code:

```sh
curl -X PATCH http://127.0.0.1:3000/v1/settings \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"postingDays":[2,4,6],"postingTimes":["10:30"],"timezone":"Europe/Istanbul","ctaFrequency":0.55,"hashtagMode":"none"}'
```

Days use ISO numbering: Monday 1 through Sunday 7. Every time applies to every selected day; adding a second time adds a second slot on each day. `contentLanguage` is currently fixed to `tr`. `minPostLength` and `maxPostLength` are enforced; the initial range is 100–2400 characters, while the editorial prompt usually targets 600–1600. The LinkedIn text limit is capped at 3000.

Other settings include categories, quality and similarity thresholds, commercial content ratio, exploration ratio, backlog target, and report schedule. `telegramUserId` cannot be changed through this API to bypass the environment allowlist.

Use `/v1/memory` to inspect, disable, or delete learned preferences. Set `memoryEnabled=false` to stop using and learning them. Add real project notes through `/v1/sources`; mark `verified` and `personal` only when accurate. A source URL is stored as a reference, not fetched or automatically fact-checked. Full schemas are in [API.md](API.md).

## 10. Collect metrics and optionally use n8n

Manual metrics work without LinkedIn analytics permissions. Submit a real cumulative snapshot to `/v1/posts/:id/metrics`, with its observation timestamp and only the fields you actually know. Unknown fields remain `null`; do not substitute zero or estimated client results. The [API reference](API.md#manuel-metrikler-ve-öğrenme) includes the request schema.

For optional automatic post analytics, obtain Community Management API access and the `r_member_postAnalytics` permission, set `LINKEDIN_ANALYTICS_ENABLED=true`, and reconnect OAuth for the added scope. The collector requests lifetime totals for impressions, reactions, comments, and reposts. Follower/profile totals and inbound leads are not fabricated. Basic publishing permission alone does not grant analytics access. [Member Post Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-05)

n8n is optional. Import [n8n/scheduler.json](../n8n/scheduler.json), set the HTTP request to your backend's `/v1/tick`, and configure a Header Auth credential named `Authorization` with `Bearer <ADMIN_API_TOKEN>` as its value. Store the real value in n8n credentials, not the workflow JSON. The example `http://api:3000` host resolves only when n8n shares the Compose network; otherwise use your actual protected backend address.

The imported workflow starts inactive. Enable it after configuration. It only queues scheduled work, so the backend worker still needs to run. Built-in and n8n ticks share slot deduplication. Neither is an approval or direct publishing route.

## Recovery, privacy, and final checks

| Symptom | Next step |
| --- | --- |
| No Telegram draft | Check `/start`, the real allowed user ID, delivery mode, worker, and `/v1/jobs` outbox records |
| Webhook `401` | Check the matching secret and proxy header forwarding |
| Stale-version message | Use the latest draft's message or button |
| AI job fails | Check model access/quota and job status; quality or source rejection can also stop a draft |
| LinkedIn `401` | Reconnect OAuth or replace the pre-issued token |
| LinkedIn `403` | Check app products and scopes; analytics needs separate permission |
| LinkedIn `426` | Review the provider's supported API versions and update configuration |
| `failed` publication | Correct the definite error and use the Telegram retry action for the existing approved version |
| `publish_uncertain` | Inspect the actual LinkedIn profile before doing anything that might republish |

A timed-out or ambiguous LinkedIn request may already have created the post. Postrail stops automatic republication rather than guessing. If you confirm the post exists, use `/v1/posts/:id/reconcile` with its real `urn:li:share:...` or `urn:li:ugcPost:...` and the explicit confirmation literal documented in [API.md](API.md#belirsiz-yayın-sonucunu-uzlaştırma). This records an existing publication and sends no new LinkedIn POST. There is no “assume it did not publish” endpoint; do not force database state to retry an uncertain result.

Failed non-publishing jobs can be retried through `/v1/jobs/:id/retry`. A failed Telegram notification has its own `/v1/outbox/:id/retry` route; retrying a notification does not republish content. Preserve the database and inspect the failure before retrying.

Use one operator per deployment. Protect admin access, retain encrypted backups, keep encryption keys separate, and exclude secrets and OAuth query strings from proxy logs. Live AI calls include relevant drafts, sources, history, and preferences; Telegram receives review content. Read [SECURITY.md](../SECURITY.md) before exposing the service.

For deployment changes, run `npm run check`; use `npm run test:postgres` with an explicit disposable `TEST_DATABASE_URL` to exercise separate database connections. Ordinary tests may skip that suite without the variable. See [PostgreSQL testing](POSTGRES_TESTING.md) and the [validation record](VALIDATION.md) for scope. A local test or image build is not evidence that your provider accounts are connected; verify those separately, with your explicit approval for the first real post.
