import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PgDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { Repository } from '../src/db/repository.js';
import { BrandEngine } from '../src/services/engine.js';
import { OfflineContentEngine } from '../src/content/index.js';
import { MockLinkedIn, MockTelegram } from '../src/integrations/mocks.js';
import { buildApp } from '../src/api.js';
import { loadEnv } from '../src/core/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `brand_workflow_test_${randomUUID().replaceAll('-', '')}`;
const telegramUserId = '123456';
const webhookSecret = 'postgres-workflow-webhook-secret-123456789';
const logger = { info() {}, warn() {}, error() {} };

// Real application, scheduler, SQL transactions and worker queues. Only external providers
// use explicit fixture adapters; MockLinkedIn records every call without hiding duplicates.
describe.skipIf(!databaseUrl)('Real PostgreSQL end-to-end workflow (requires TEST_DATABASE_URL)', () => {
  let admin: PgDatabase | undefined;
  let apiDb: PgDatabase | undefined;
  let workerDb: PgDatabase | undefined;
  let app: FastifyInstance | undefined;
  let repo: Repository;
  let apiEngine: BrandEngine;
  let workerEngine: BrandEngine;
  let schemaCreated = false;
  const telegram = new MockTelegram();
  const linkedin = new MockLinkedIn();
  const clock = new Date(Date.now() - 2000);
  let updateId = 0;

  beforeAll(async () => {
    admin = new PgDatabase(databaseUrl!);
    // Locally generated UUID identifiers cannot inject SQL or address an existing schema.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const scoped = new URL(databaseUrl!);
    const previousOptions = scoped.searchParams.get('options');
    scoped.searchParams.set('options', `${previousOptions ? `${previousOptions} ` : ''}-csearch_path=${schema}`);
    apiDb = new PgDatabase(scoped.toString());
    workerDb = new PgDatabase(scoped.toString());
    await migrate(apiDb);
    repo = new Repository(apiDb);
    const dependencies = { content: new OfflineContentEngine(), telegram, linkedin, telegramUserId, logger, now: () => clock };
    apiEngine = new BrandEngine({ ...dependencies, repo });
    workerEngine = new BrandEngine({ ...dependencies, repo: new Repository(workerDb) });
    await apiEngine.initialize();
    await workerEngine.initialize();
    const env = loadEnv({ APP_MODE: 'offline', NODE_ENV: 'test', ADMIN_API_TOKEN: 'postgres-workflow-admin-token-123456789', TELEGRAM_ALLOWED_USER_ID: telegramUserId, TELEGRAM_WEBHOOK_SECRET: webhookSecret });
    app = await buildApp(apiEngine, env);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([apiDb?.close(), workerDb?.close()]);
    try {
      if (schemaCreated) await admin!.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await admin?.close(); }
  }, 30_000);

  function message(text: string, replyTo?: number) {
    return { update_id: ++updateId, message: { message_id: 100_000 + updateId, from: { id: Number(telegramUserId) }, chat: { id: Number(telegramUserId), type: 'private' }, text, ...(replyTo === undefined ? {} : { reply_to_message: { message_id: replyTo } }) } };
  }
  async function deliver(payload: object): Promise<void> {
    const response = await app!.inject({ method: 'POST', url: '/webhooks/telegram', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  }
  async function drain(): Promise<void> {
    // Both instances compete through separate PostgreSQL pools, as API and worker replicas do.
    await Promise.all([apiEngine.runJobs(50), workerEngine.runJobs(50)]);
    await Promise.all([apiEngine.flushOutbox(50), workerEngine.flushOutbox(50)]);
  }

  it('scheduler → v1 → scoped hook v2 → remove CTA v3 → explicit approval → one publish and durable notification', async () => {
    const settings = await apiEngine.settings();
    const local = DateTime.fromJSDate(clock, { zone: settings.timezone });
    await repo.saveSettings(apiEngine.userId, { ...settings, postingDays: [local.weekday], postingTimes: [local.toFormat('HH:mm')], ctaFrequency: 1 });
    await apiEngine.tick();
    await drain();
    const posts = await repo.listPosts(apiEngine.userId);
    expect(posts).toHaveLength(1);
    const post = posts[0]!;
    const v1 = (await repo.latestVersion(apiEngine.userId, post.id))!;
    expect(post.status).toBe('waiting_approval');
    expect(v1.version).toBe(1);
    expect(v1.content.blocks.some(block => block.kind === 'cta')).toBe(true);
    expect(linkedin.published).toHaveLength(0);
    const firstNotice = telegram.messages.find(item => item.buttons?.flat().some(button => button.callback_data === `approve:${post.id}:1`));
    expect(firstNotice).toBeDefined();
    expect(await repo.resolveMessage(apiEngine.userId, firstNotice!.messageId)).toEqual({ postId: post.id, version: 1 });

    await deliver(message('girişi daha kısa ve vurucu yap', firstNotice!.messageId));
    await drain();
    const v2 = (await repo.latestVersion(apiEngine.userId, post.id))!;
    expect(v2.version).toBe(2);
    expect(v2.content.blocks.filter(block => block.kind !== 'hook')).toEqual(v1.content.blocks.filter(block => block.kind !== 'hook'));
    expect(v2.content.blocks.find(block => block.kind === 'hook')!.text).not.toBe(v1.content.blocks.find(block => block.kind === 'hook')!.text);
    expect(linkedin.published).toHaveLength(0);

    await deliver(message('CTA’yı çıkar'));
    await drain();
    const v3 = (await repo.latestVersion(apiEngine.userId, post.id))!;
    expect(v3.version).toBe(3);
    expect(v3.content.blocks).toEqual(v2.content.blocks.filter(block => block.kind !== 'cta'));
    expect((await repo.getPost(apiEngine.userId, post.id))?.approvedVersion).toBeNull();
    expect(linkedin.published).toHaveLength(0);

    // A delayed reply to the original notification still refers to v1 and must fail safely.
    await deliver(message('onayla', firstNotice!.messageId));
    await drain();
    expect(linkedin.published).toHaveLength(0);
    expect((await repo.latestVersion(apiEngine.userId, post.id))?.version).toBe(3);

    const approval = message('onayla');
    await Promise.all([deliver(approval), deliver(approval)]);
    await drain();
    expect(linkedin.published).toHaveLength(1);
    expect(linkedin.published[0]!.text).toBe(v3.text);
    expect(linkedin.published[0]!.idempotencyKey).toBe(`${post.id}:3`);
    const saved = (await repo.getPost(apiEngine.userId, post.id))!;
    expect(saved.status).toBe('published');
    expect(saved.approvedVersion).toBe(3);
    expect(saved.currentVersion).toBe(3);
    const published = await apiDb!.query<{ version: number; url: string }>('SELECT version,url FROM published_posts WHERE user_id=$1 AND post_id=$2', [apiEngine.userId, post.id]);
    const approvals = await apiDb!.query<{ version: number }>('SELECT version FROM approvals WHERE user_id=$1 AND post_id=$2', [apiEngine.userId, post.id]);
    const attempts = await apiDb!.query('SELECT id FROM publish_attempts WHERE user_id=$1 AND post_id=$2', [apiEngine.userId, post.id]);
    expect(published.rowCount).toBe(1);
    expect(published.rows[0]!.version).toBe(3);
    expect(approvals.rows).toEqual([{ version: 3 }]);
    expect(attempts.rowCount).toBe(1);
    expect(telegram.messages.some(item => item.text.includes('✅ LinkedIn gönderisi yayınlandı.') && item.text.includes(published.rows[0]!.url))).toBe(true);
    expect((await repo.getVersion(apiEngine.userId, post.id, 1))?.text).toBe(v1.text);
    expect((await repo.getVersion(apiEngine.userId, post.id, 2))?.text).toBe(v2.text);

    await apiEngine.tick();
    await deliver(approval);
    await repo.enqueueJob(apiEngine.userId, 'publish', { postId: post.id, version: 3 }, new Date().toISOString(), 'duplicate-publish-regression');
    await drain();
    expect(linkedin.published).toHaveLength(1);
    expect((await repo.listPosts(apiEngine.userId))).toHaveLength(1);
    const notice = await apiDb!.query('SELECT id FROM outbox WHERE user_id=$1 AND dedupe_key=$2', [apiEngine.userId, `published:${post.id}`]);
    expect(notice.rowCount).toBe(1);
  }, 30_000);
});
