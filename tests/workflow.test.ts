import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGliteDatabase } from '../src/db/pglite.js';
import { migrate } from '../src/db/migrate.js';
import { Repository } from '../src/db/repository.js';
import { BrandEngine } from '../src/services/engine.js';
import { ContentQualityError, OfflineContentEngine } from '../src/content/index.js';
import { MockLinkedIn, MockTelegram } from '../src/integrations/mocks.js';
import { PublishError } from '../src/integrations/linkedin.js';
import { buildApp } from '../src/api.js';
import { loadEnv } from '../src/core/config.js';
import { performanceScore, recordMetrics, weeklyReport } from '../src/services/analytics.js';
import type { LinkedInPort, Post, Version } from '../src/core/types.js';

let db: PGliteDatabase; let repo: Repository; let engine: BrandEngine;
let telegram: MockTelegram; let linkedin: MockLinkedIn; let updateId = 0;
const logger = { info() {}, warn() {}, error() {} };
const userId = '123456';
const update = (text: string, replyTo?: number, sender = userId) => ({ update_id: ++updateId, message: { message_id: 100000 + updateId, from: { id: Number(sender) }, chat: { id: Number(sender), type: 'private' }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) } });
const callback = (data: string, messageId: number) => ({ update_id: ++updateId, callback_query: { id: `callback-${updateId}`, from: { id: Number(userId) }, message: { message_id: messageId, chat: { id: Number(userId), type: 'private' } }, data } });
async function drain(): Promise<void> { await engine.runJobs(50); await engine.flushOutbox(50); }
async function draft(): Promise<{ post: Post; version: Version; messageId: number }> {
  const key = `test:${randomUUID()}`;
  await repo.enqueueJob(engine.userId, 'generate', { manual: true, slotKey: key, scheduledAt: new Date(Date.now() - 1000).toISOString() }, new Date().toISOString(), key);
  await drain();
  const post = (await repo.listPosts(engine.userId))[0]!;
  expect(post.status).toBe('waiting_approval');
  return { post, version: (await repo.latestVersion(engine.userId, post.id))!, messageId: telegram.messages.at(-1)!.messageId };
}
async function withPublisher(publisher: LinkedInPort) {
  engine = new BrandEngine({ repo, content: new OfflineContentEngine(), telegram, linkedin: publisher, telegramUserId: userId, logger }); await engine.initialize();
}
beforeEach(async () => {
  db = new PGliteDatabase(); await migrate(db); repo = new Repository(db);
  telegram = new MockTelegram(); linkedin = new MockLinkedIn(); await withPublisher(linkedin);
});
afterEach(async () => { await db.close(); });

describe('full human approval workflow', () => {
  it('scheduler -> draft -> scoped hook edit -> remove CTA -> approve latest -> store and notify exactly once', async () => {
    const settings = await engine.settings();
    // Exercise the actual scheduler at a due local wall time; Tue/Thu/Sat defaults tested separately.
    const local = DateTime.now().setZone(settings.timezone);
    await repo.saveSettings(engine.userId, { ...settings, postingDays: [local.weekday], postingTimes: [local.toFormat('HH:mm')] });
    await engine.tick(); await drain();
    const post = (await repo.listPosts(engine.userId))[0]!;
    expect(post.status).toBe('waiting_approval');
    const v1 = (await repo.latestVersion(engine.userId, post.id))!;
    expect(linkedin.published).toHaveLength(0);
    await engine.receive(update('girişi daha kısa ve vurucu yap')); await drain();
    const v2 = (await repo.latestVersion(engine.userId, post.id))!;
    expect(v2.version).toBe(2);
    expect(v2.content.blocks.filter(b => b.kind !== 'hook')).toEqual(v1.content.blocks.filter(b => b.kind !== 'hook'));
    expect(v2.content.blocks[0]?.text).not.toBe(v1.content.blocks[0]?.text);
    await engine.receive(update('CTA’yı çıkar')); await drain();
    const v3 = (await repo.latestVersion(engine.userId, post.id))!;
    expect(v3.version).toBe(3);
    expect(v3.content.blocks).toEqual(v2.content.blocks.filter(b => b.kind !== 'cta'));
    const approval = update('onayla');
    expect(await engine.receive(approval)).toBe(true);
    expect(await engine.receive(approval)).toBe(false);
    await drain();
    expect(linkedin.published).toHaveLength(1);
    expect(linkedin.published[0]!.text).toBe(v3.text);
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('published');
    expect((await db.query('SELECT * FROM published_posts WHERE user_id=$1 AND post_id=$2', [engine.userId, post.id])).rowCount).toBe(1);
    expect(telegram.messages.at(-1)?.text).toContain('✅ LinkedIn gönderisi yayınlandı.');
    expect(telegram.messages.at(-1)?.text).toContain('example.invalid/offline-post');
    await engine.tick(); await drain();
    expect(linkedin.published).toHaveLength(1);
  });
  it('rejects unauthorized users, private impersonation mismatch, groups and unapproved publication jobs', async () => {
    const { post } = await draft();
    const stranger = update('onayla', undefined, '999999');
    expect(await engine.receive(stranger)).toBe(false);
    expect(await engine.receive({ ...update('onayla'), message: { ...update('onayla').message, chat: { id: 123456, type: 'group' } } })).toBe(false);
    await repo.enqueueJob(engine.userId, 'publish', { postId: post.id, version: 1 }, new Date().toISOString(), 'malicious-job'); await drain();
    expect(linkedin.published).toHaveLength(0);
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('waiting_approval');
  });
  it('does not approve an old callback or a mismatched button payload', async () => {
    const { post, messageId } = await draft();
    await engine.receive(update('girişi kısalt')); await drain();
    await engine.receive(callback(`approve:${post.id}:1`, messageId)); await drain();
    expect(linkedin.published).toHaveLength(0);
    await engine.receive(callback(`approve:${post.id}:2`, messageId)); await drain();
    expect(linkedin.published).toHaveLength(0);
    expect((await repo.getPost(engine.userId, post.id))?.approvedVersion).toBeNull();
  });
  it('binds a delayed plain approval to receipt version, never a newer unreviewed version', async () => {
    const { post } = await draft();
    await engine.receive(update('girişi kısalt'));
    await engine.receive(update('onayla')); // captures v1 before v2 exists
    await drain();
    expect((await repo.latestVersion(engine.userId, post.id))?.version).toBe(2);
    expect(linkedin.published).toHaveLength(0);
  });
  it('does not later bind an approval received without a draft', async () => {
    await engine.receive(update('onayla'));
    await draft();
    expect(linkedin.published).toHaveLength(0);
  });
  it('reply targeting affects the selected older post while another draft is active', async () => {
    const a = await draft(); const b = await draft();
    await engine.receive(update('onayla', a.messageId)); await drain();
    expect(linkedin.published[0]?.text).toBe(a.version.text);
    expect((await repo.getPost(engine.userId, b.post.id))?.status).toBe('waiting_approval');
  });
  it('cancelled posts cannot publish even when an earlier approval job exists', async () => {
    const { post, messageId } = await draft();
    await engine.receive(callback(`approve:${post.id}:1`, messageId));
    await engine.receive(update('iptal', messageId));
    await drain();
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('cancelled');
    expect(linkedin.published).toHaveLength(0);
  });
  it('postponement invalidates approval and old scheduled jobs cannot publish', async () => {
    const { post, messageId } = await draft();
    await engine.receive(callback(`approve:${post.id}:1`, messageId));
    await engine.receive(update('2 saat ertele', messageId)); await drain();
    const postponed = (await repo.getPost(engine.userId, post.id))!;
    expect(postponed.status).toBe('postponed'); expect(postponed.approvedVersion).toBeNull();
    expect(new Date(postponed.scheduledAt).getTime()).toBeGreaterThan(Date.now() + 119 * 60_000);
    await engine.receive(update('onayla', messageId)); await drain();
    expect(linkedin.published).toHaveLength(0);
  });
  it('clarifies ambiguous edits without model retries or modifying the saved draft', async () => {
    const { post } = await draft();
    await engine.receive(update('bu örneği çıkar')); await drain();
    expect((await repo.latestVersion(engine.userId, post.id))?.version).toBe(1);
    expect(telegram.messages.at(-1)?.text).toContain('Revizyonu netleştirelim');
    expect((await db.query("SELECT * FROM jobs WHERE user_id=$1 AND type='telegram' AND status='done'", [engine.userId])).rowCount).toBe(1);
  });
  it('keeps an initial quality failure recoverable, preserving slot and idea on retry', async () => {
    const content = new OfflineContentEngine(); const original = content.generate.bind(content);
    content.generate = async () => { throw new ContentQualityError(['Independent review rejected']); };
    engine = new BrandEngine({ repo, content, telegram, linkedin, telegramUserId: userId, logger }); await engine.initialize();
    const key = 'quality-failure-test';
    await repo.enqueueJob(engine.userId, 'generate', { manual: true, slotKey: key, scheduledAt: new Date().toISOString() }, new Date().toISOString(), key);
    await drain();
    const failedJob = (await db.query<{ id: string; status: string }>('SELECT id,status FROM jobs WHERE user_id=$1 AND dedupe_key=$2', [engine.userId, key])).rows[0]!;
    expect(failedJob.status).toBe('failed');
    const first = (await repo.listPosts(engine.userId))[0]!; expect(first.currentVersion).toBe(0);
    expect(telegram.messages.at(-1)?.text).toContain('onaya veya yayına gönderilmedi');
    content.generate = original;
    const env = loadEnv({ ADMIN_API_TOKEN: 'a'.repeat(40), TELEGRAM_ALLOWED_USER_ID: userId, TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(40), APP_MODE: 'offline' });
    const app = await buildApp(engine, env);
    expect((await app.inject({ method: 'POST', url: `/v1/jobs/${failedJob.id}/retry`, headers: { authorization: `Bearer ${'a'.repeat(40)}` } })).statusCode).toBe(200);
    await drain(); await app.close();
    const recovered = (await repo.listPosts(engine.userId))[0]!;
    expect(recovered.id).toBe(first.id); expect(recovered.ideaId).toBe(first.ideaId);
    expect(recovered.status).toBe('waiting_approval'); expect(recovered.currentVersion).toBe(1);
    expect(linkedin.published).toHaveLength(0);
  });
  it('timeout after possible external acceptance blocks every retry', async () => {
    let calls = 0;
    await withPublisher({ publish: async () => { calls++; throw new PublishError('uncertain', 'Timeout after send'); } });
    const { post } = await draft();
    await engine.receive(update('onayla')); await drain();
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('publish_uncertain');
    await engine.receive(update('tekrar dene')); await drain();
    await repo.enqueueJob(engine.userId, 'publish', { postId: post.id, version: 1 }, new Date().toISOString(), 'duplicate-timeout'); await drain();
    expect(calls).toBe(1);
  });
  it('definite API rejection preserves approval, enables correctly mapped retry button', async () => {
    let calls = 0;
    await withPublisher({ publish: async (text, key) => { calls++; if (calls === 1) throw new PublishError('rejected', 'Token expired', 401); return linkedin.publish(text, key); } });
    const { post } = await draft(); await engine.receive(update('onayla')); await drain();
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('failed');
    const error = telegram.messages.at(-1)!;
    await engine.receive(callback(error.buttons![0]![0]!.callback_data, error.messageId)); await drain();
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('published');
    expect(calls).toBe(2); expect(linkedin.published).toHaveLength(1);
  });
  it('failure sending Telegram success never retries LinkedIn', async () => {
    const { post } = await draft(); await engine.receive(update('onayla'));
    await engine.runJobs(10);
    const original = telegram.send.bind(telegram); telegram.send = async () => { throw new Error('offline network'); };
    await engine.flushOutbox();
    expect(linkedin.published).toHaveLength(1); expect((await repo.getPost(engine.userId, post.id))?.status).toBe('published');
    telegram.send = original;
    await db.query("UPDATE outbox SET run_at=now() WHERE user_id=$1 AND status='pending'", [engine.userId]); await drain();
    expect(linkedin.published).toHaveLength(1);
    expect(telegram.messages.at(-1)?.text).toContain('yayınlandı');
  });
});

describe('protected administration and honest analytics', () => {
  const env = () => loadEnv({ ADMIN_API_TOKEN: 'a'.repeat(40), TELEGRAM_ALLOWED_USER_ID: userId, TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(40), APP_MODE: 'offline' });
  it('requires admin authentication and webhook secret; provides no administrative approval endpoint', async () => {
    const app = await buildApp(engine, env());
    expect((await app.inject('/v1/posts')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/telegram', payload: update('onayla') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: { 'x-telegram-bot-api-secret-token': 'b'.repeat(40) }, payload: update('onayla', undefined, '999999') })).statusCode).toBe(200);
    expect((await db.query('SELECT * FROM telegram_inbox')).rowCount).toBe(0);
    expect((await app.inject({ method: 'POST', url: `/v1/posts/${randomUUID()}/approve`, headers: { authorization: `Bearer ${'a'.repeat(40)}` } })).statusCode).toBe(404);
    await app.close();
  });
  it('validates settings and blocks changing Telegram identity through content settings', async () => {
    const app = await buildApp(engine, env()); const headers = { authorization: `Bearer ${'a'.repeat(40)}` };
    expect((await app.inject({ method: 'PATCH', url: '/v1/settings', headers, payload: { timezone: 'bad' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/v1/settings', headers, payload: { telegramUserId: '999999' } })).statusCode).toBe(409);
    expect((await engine.settings()).telegramUserId).toBe(userId); await app.close();
  });
  it('never scores incomplete measurement as zero; prevents older snapshots replacing newer performance', async () => {
    expect(performanceScore({ source: 'manual', observedAt: new Date().toISOString(), reactions: 10 })).toBeNull();
    const { post } = await draft(); await engine.receive(update('onayla')); await drain();
    const later = new Date(Date.now() + 1000).toISOString();
    await recordMetrics(db, engine.userId, post.id, { source: 'manual', observedAt: later, impressions: 1000, reactions: 20, comments: 5, reposts: 2 }, 'Europe/Istanbul');
    await recordMetrics(db, engine.userId, post.id, { source: 'manual', observedAt: new Date().toISOString(), reactions: 1 }, 'Europe/Istanbul');
    const score = (await db.query<{ score: number }>('SELECT score FROM content_performance WHERE user_id=$1', [engine.userId])).rows[0]?.score;
    expect(score).toBe(4.3);
    const report = await weeklyReport(db, engine.userId, new Date(Date.now() + 2000), 'Europe/Istanbul');
    expect(report).toContain('1 gönderi yayınlandı');
    expect(report).toContain('Karşılaştırılabilir ölçüm: 1/1');
  });
  it('reconciles an existing uncertain publication idempotently with one durable notification', async () => {
    let calls = 0;
    await withPublisher({ publish: async () => { calls++; throw new PublishError('uncertain', 'Timeout'); } });
    const { post } = await draft(); await engine.receive(update('onayla')); await drain();
    const app = await buildApp(engine, env());
    const request = { method: 'POST' as const, url: `/v1/posts/${post.id}/reconcile`, headers: { authorization: `Bearer ${'a'.repeat(40)}` }, payload: { urn: 'urn:li:share:123456789', confirmation: 'LINKEDIN_UZERINDE_YAYINLANDIGINI_KONTROL_ETTIM' } };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await db.query('SELECT * FROM outbox WHERE user_id=$1 AND dedupe_key=$2', [engine.userId, `reconciled:${post.id}`])).rowCount).toBe(1);
    expect((await repo.getPost(engine.userId, post.id))?.status).toBe('published');
    expect(calls).toBe(1); await app.close();
  });
  it('manual API metric input rejects fabricated source designation and future observations', async () => {
    const app = await buildApp(engine, env()); const headers = { authorization: `Bearer ${'a'.repeat(40)}` };
    expect((await app.inject({ method: 'POST', url: `/v1/posts/${randomUUID()}/metrics`, headers, payload: { source: 'api', impressions: 100, observedAt: new Date().toISOString() } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/v1/posts/${randomUUID()}/metrics`, headers, payload: { impressions: 100, observedAt: '2099-01-01T00:00:00Z' } })).statusCode).toBe(400);
    await app.close();
  });
});
