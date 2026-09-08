import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Env } from './core/config.js';
import type { Database } from './db/database.js';
import { PgDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { migrate } from './db/migrate.js';
import { LiveContentEngine, OfflineContentEngine } from './content/index.js';
import { LinkedInClient } from './integrations/linkedin.js';
import { LinkedInAnalytics } from './integrations/linkedin-analytics.js';
import { TelegramBot } from './integrations/telegram.js';
import { MockLinkedIn, MockTelegram } from './integrations/mocks.js';
import { LinkedInOAuth, TokenCipher } from './integrations/oauth.js';
import { OAuthService } from './services/oauth.js';
import { BrandEngine } from './services/engine.js';
import { buildApp } from './api.js';

export async function createRuntime(env: Env, database?: Database) {
  let db = database;
  if (!db) {
    if (env.DATABASE_URL) db = new PgDatabase(env.DATABASE_URL);
    else {
      if (env.APP_MODE !== 'offline') throw new Error('DATABASE_URL gerekli');
      await mkdir('.data', { recursive: true });
      const { PGliteDatabase } = await import('./db/pglite.js');
      db = new PGliteDatabase('.data/postgres');
    }
  }
  await migrate(db);
  const repo = new Repository(db);
  const userId = await repo.ensureUser(env.TELEGRAM_ALLOWED_USER_ID);
  const logger = pino({ level: env.LOG_LEVEL, redact: { paths: ['token', 'secret', 'authorization', 'headers.authorization', 'req.headers', 'body', 'env', 'apiKey', 'accessToken', 'clientSecret'], censor: '[REDACTED]' } });
  const oauth = env.APP_MODE === 'live' && env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && env.LINKEDIN_REDIRECT_URI
    ? new OAuthService(db, userId, new LinkedInOAuth({ clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, redirectUri: env.LINKEDIN_REDIRECT_URI, analyticsEnabled: env.LINKEDIN_ANALYTICS_ENABLED }), new TokenCipher(Buffer.from(env.TOKEN_ENCRYPTION_KEY!, 'hex').toString('base64'))) : undefined;
  const token = async () => oauth ? oauth.accessToken() : env.LINKEDIN_ACCESS_TOKEN!;
  const lastMessage = env.APP_MODE === 'offline' ? Number((await db.query<{ id: string }>('SELECT COALESCE(max(message_id),0)::text AS id FROM telegram_messages WHERE user_id=$1', [userId])).rows[0]!.id) : 0;
  const telegram = env.APP_MODE === 'live' ? new TelegramBot({ token: env.TELEGRAM_BOT_TOKEN! }) : new MockTelegram(lastMessage);
  const linkedin = env.APP_MODE === 'live' ? new LinkedInClient({ accessToken: token, authorUrn: async () => oauth ? oauth.authorUrn() : env.LINKEDIN_AUTHOR_URN!, version: env.LINKEDIN_API_VERSION }) : new MockLinkedIn();
  const analytics = env.APP_MODE === 'live' && env.LINKEDIN_ANALYTICS_ENABLED ? new LinkedInAnalytics({ enabled: true, accessToken: token, version: env.LINKEDIN_API_VERSION }) : undefined;
  const content = env.APP_MODE === 'live' ? new LiveContentEngine({ apiKey: env.LLM_API_KEY!, model: env.LLM_MODEL }) : new OfflineContentEngine();
  const engine = new BrandEngine({ repo, content, telegram, linkedin, telegramUserId: env.TELEGRAM_ALLOWED_USER_ID, logger, analytics });
  await engine.initialize();
  const app = await buildApp(engine, env, oauth);
  if (env.APP_MODE === 'offline' && telegram instanceof MockTelegram && linkedin instanceof MockLinkedIn) {
    app.get('/v1/offline/messages', async () => ({ messages: telegram.messages, published: linkedin.published, warning: 'Offline fixture adaptörleri; gerçek yayın yok.' }));
    app.post('/v1/offline/telegram', async request => ({ accepted: await engine.receive(request.body) }));
    app.post('/v1/offline/drain', async () => { await engine.runJobs(50); await engine.flushOutbox(50); return { processed: true }; });
  }
  return { app, engine, db, telegram, linkedin, logger, env };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;

export function startWorker(runtime: Runtime): () => Promise<void> {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> = Promise.resolve();
  const { engine, db, telegram, logger, env } = runtime;
  const pollOwner = randomUUID();
  let lastTick = 0;
  async function cycle(): Promise<void> {
    try {
      if (Date.now() - lastTick > 60_000) { await engine.tick(); lastTick = Date.now(); }
      await engine.runJobs(5);
      await engine.flushOutbox(20);
    } catch { logger.error({ event: 'worker_cycle_failed' }); }
    if (!stopping) timer = setTimeout(() => { work = cycle(); }, env.WORKER_INTERVAL_MS);
  }
  async function polling(): Promise<void> {
    if (!(telegram instanceof TelegramBot) || env.TELEGRAM_MODE !== 'polling') return;
    while (!stopping) {
      try {
        // Short DB lease ensures only one replica polls this bot; update dedupe survives restarts.
        const lease = await db.query<{ value: { offset?: number } }>(`INSERT INTO runtime_state(user_id,key,value) VALUES($1,'telegram-poll',$2)
          ON CONFLICT(user_id,key) DO UPDATE SET value=runtime_state.value || excluded.value,updated_at=now()
          WHERE (runtime_state.value->>'leaseUntil')::timestamptz < now() OR runtime_state.value->>'owner'=$3 RETURNING value`,
          [engine.userId, JSON.stringify({ owner: pollOwner, leaseUntil: new Date(Date.now() + 40_000).toISOString() }), pollOwner]);
        if (!lease.rows[0]) { await new Promise(resolve => setTimeout(resolve, 5000)); continue; }
        const updates = await telegram.getUpdates(lease.rows[0].value.offset, 25);
        for (const update of updates) {
          await engine.receive(update);
          await db.query("UPDATE runtime_state SET value=jsonb_set(value,'{offset}',$2::jsonb),updated_at=now() WHERE user_id=$1 AND key='telegram-poll' AND value->>'owner'=$3", [engine.userId, JSON.stringify(update.update_id + 1), pollOwner]);
        }
      } catch {
        logger.warn({ event: 'telegram_poll_failed' });
        if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  work = cycle();
  const poll = polling();
  return async () => {
    stopping = true; if (timer) clearTimeout(timer);
    await Promise.all([work, poll]);
    await db.query("DELETE FROM runtime_state WHERE user_id=$1 AND key='telegram-poll' AND value->>'owner'=$2", [engine.userId, pollOwner]);
  };
}
