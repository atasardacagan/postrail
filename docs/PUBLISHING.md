# Repository publishing and release

## Identity and About settings

- **Name:** `postrail`
- **Description:** AI LinkedIn content with Telegram approval, scoped revisions, durable scheduling, and optional analytics. Self-hosted TypeScript + PostgreSQL.
- **Topics:** `linkedin`, `telegram-bot`, `ai`, `automation`, `human-in-the-loop`, `content-generation`, `typescript`, `nodejs`, `fastify`, `postgresql`, `scheduler`, `self-hosted`, `oauth2`, `docker`, `n8n`
- **Website:** leave empty until the portfolio case study has a real public URL. The intended origin `https://www.ardacaganatas.com` is not live yet.
- **Social preview:** upload `assets/social-preview.png` in repository Settings → General → Social preview.
- **Features:** Issues and Releases useful; Wiki/Projects/Discussions are optional and not needed for the initial source release.
- **Private vulnerability reporting:** enable under repository security settings if available before advertising the private reporting path.

This local TypeScript project is distinct from the existing Python repository named `linkedin-ai-automation`. Do not overwrite that repository or rewrite its history to publish this project.

## Before a public push

Run `npm ci`, `npm run check`, `npm run demo`, and `npm run audit:source`. Run `npm run test:postgres` with a disposable PostgreSQL database. Inspect staged files with `git diff --cached --stat` and `git diff --cached --check`. Never add `.env`, `.data`, dependency directories, logs, test databases or personal paths. Fixture credentials are intentionally nonfunctional and must stay clearly identified as test data.

The local working copy originally had no Git repository or prior commit history. A new source history can be created from the audited files; do not import the environment or another project's history. The source audit scans reachable history once Git exists and is a focused check, not a guarantee that every possible secret format can be recognized.

## First release

Version metadata is `1.0.0`. Use tag `v1.0.0` only on the final verified source commit. The prepared notes are in `docs/releases/v1.0.0.md`. Include the source archive and `SHA256SUMS` as release assets. GitHub also generates archives from the tag.

1. Verify all three CI jobs on the final commit: quality/offline acceptance, PostgreSQL 17, production image build.
2. Resolve any failing job. Do not describe a pending run as passing.
3. Create the `v1.0.0` release from that verified commit with the prepared notes.
4. Open the README, image links, social preview and release download as an unauthenticated visitor.
5. Add the verified repository URL to `portfolio/project.json` and enable its source CTA. Leave a live-demo CTA disabled unless a live demo actually exists.

Do not add a build-passing badge manually. A workflow badge may point to the actual repository's Actions workflow once the repository exists. The README currently uses only descriptive technology and license badges.

## Ongoing releases

Follow Semantic Versioning for the documented application interfaces: patch for compatible corrections, minor for compatible features, major for breaking behavior. Keep migration files immutable once distributed. Document API/config/database compatibility and upgrade steps in the changelog. Back up PostgreSQL and the separate encryption key before deployment upgrades. No release process should bypass Telegram approval or publish social content.
