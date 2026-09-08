import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { settingsSchema, type Env } from './core/config.js';
import type { BrandEngine } from './services/engine.js';
import { recordMetrics, patterns, weeklyReport } from './services/analytics.js';
import type { OAuthService } from './services/oauth.js';
import { OAuthError } from './integrations/oauth.js';
import { ConflictError } from './core/state-machine.js';

function equalSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length > 1000) return false;
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
}
const idParam = z.object({ id: z.uuid() });
const nonnegative = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();
export const metricsSchema = z.object({
  impressions: nonnegative, reactions: nonnegative, comments: nonnegative, reposts: nonnegative,
  followerChange: z.number().int().safe().nullable().optional(), profileViews: nonnegative, inboundLeads: nonnegative,
  observedAt: z.iso.datetime({ offset: true }).refine(v => new Date(v).getTime() <= Date.now() + 60_000, 'Ölçüm gelecekte olamaz'),
}).strict().refine(v => Object.entries(v).some(([k, value]) => k !== 'observedAt' && value != null), 'En az bir ölçüm gerekli');

export async function buildApp(engine: BrandEngine, env: Env, oauth?: OAuthService) {
  const app = Fastify({ bodyLimit: 32_768, logger: false, trustProxy: false });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/health/live' || path === '/health/ready' || path === '/oauth/linkedin/callback') return;
    if (path === '/webhooks/telegram') {
      if (!equalSecret(request.headers['x-telegram-bot-api-secret-token'], env.TELEGRAM_WEBHOOK_SECRET)) return reply.code(401).send({ error: 'Webhook doğrulanamadı' });
      return;
    }
    if (!equalSecret(request.headers.authorization, `Bearer ${env.ADMIN_API_TOKEN}`)) return reply.code(401).send({ error: 'Yönetim kimliği gerekli' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Geçersiz istek', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (error instanceof ConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof OAuthError) return reply.code(400).send({ error: error.message });
    const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.code(status >= 400 && status < 500 ? status : 500).send({ error: 'İşlem tamamlanamadı; kayıt ve servis durumunu kontrol edin' });
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await engine.repo.db.query('SELECT 1'); return { status: 'ready', mode: env.APP_MODE }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.post('/webhooks/telegram', async request => { await engine.receive(request.body); return { ok: true }; });
  app.post('/v1/tick', async () => { await engine.tick(); return { queued: true }; });
  app.get('/v1/posts', async () => ({ posts: await engine.repo.listPosts(engine.userId) }));
  app.get('/v1/posts/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params); const post = await engine.repo.getPost(engine.userId, id);
    if (!post) return reply.code(404).send({ error: 'Gönderi bulunamadı' });
    const versions = await engine.repo.db.query('SELECT version,content,text,fingerprint,instruction,created_at FROM post_versions WHERE user_id=$1 AND post_id=$2 ORDER BY version', [engine.userId, id]);
    return { post, versions: versions.rows };
  });
  app.get('/v1/calendar', async () => ({ calendar: (await engine.repo.db.query('SELECT c.post_id,c.scheduled_at,p.status,p.current_version FROM content_calendar c JOIN post_drafts p ON p.id=c.post_id AND p.user_id=c.user_id WHERE c.user_id=$1 ORDER BY c.scheduled_at DESC LIMIT 100', [engine.userId])).rows,
    upcoming: (await engine.repo.db.query("SELECT run_at FROM jobs WHERE user_id=$1 AND type='generate' AND status='pending' ORDER BY run_at LIMIT 100", [engine.userId])).rows }));
  app.post('/v1/drafts/generate', async (_request, reply) => {
    const key = `manual:${randomUUID()}`;
    await engine.repo.enqueueJob(engine.userId, 'generate', { scheduledAt: new Date().toISOString(), slotKey: key, manual: true }, new Date().toISOString(), key);
    return reply.code(202).send({ queued: true, key });
  });
  app.get('/v1/ideas', async () => ({ ideas: await engine.repo.listIdeas(engine.userId, false) }));
  app.post('/v1/ideas', async (request, reply) => {
    const idea = z.object({ title: z.string().min(5).max(160), category: z.string().min(2).max(100), audience: z.string().min(2).max(160), angle: z.string().min(5).max(500), hookIdea: z.string().min(2).max(200), pillar: z.enum(['education', 'opinion', 'building', 'commercial']), format: z.string().min(2).max(50), series: z.string().max(100).nullable().default(null), priority: z.number().min(0).max(100).default(50), freshness: z.number().min(0).max(100).default(50) }).strict().parse(request.body);
    return reply.code(201).send({ ideas: await engine.repo.addIdeas(engine.userId, [idea]) });
  });
  app.get('/v1/settings', async () => engine.settings());
  app.patch('/v1/settings', async request => {
    const patch = z.record(z.string(), z.unknown()).parse(request.body);
    const settings = settingsSchema.parse({ ...await engine.settings(), ...patch });
    if (settings.telegramUserId !== env.TELEGRAM_ALLOWED_USER_ID) throw new ConflictError('Telegram kimliği güvenlik ayarıdır; env ile değiştirilip servis yeniden başlatılmalı');
    await engine.repo.saveSettings(engine.userId, settings); await engine.tick(); return settings;
  });
  app.get('/v1/memory', async () => ({ memory: (await engine.repo.db.query('SELECT id,preference,count,enabled FROM brand_memory WHERE user_id=$1 ORDER BY count DESC', [engine.userId])).rows }));
  app.patch('/v1/memory/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params); const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
    const result = await engine.repo.db.query('UPDATE brand_memory SET enabled=$1,updated_at=now() WHERE user_id=$2 AND id=$3 RETURNING id,preference,count,enabled', [enabled, engine.userId, id]);
    return result.rows[0] ?? reply.code(404).send({ error: 'Hafıza bulunamadı' });
  });
  app.delete('/v1/memory/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params); await engine.repo.db.query('DELETE FROM brand_memory WHERE user_id=$1 AND id=$2', [engine.userId, id]); return reply.code(204).send();
  });
  app.get('/v1/sources', async () => ({ sources: (await engine.repo.db.query('SELECT * FROM source_facts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [engine.userId])).rows }));
  app.post('/v1/sources', async (request, reply) => {
    const source = z.object({ url: z.url().nullable().default(null), text: z.string().min(5).max(4000), verified: z.boolean().default(false), personal: z.boolean().default(false) }).strict().parse(request.body);
    const id = randomUUID();
    // URL stored as a reference only. Never fetch arbitrary admin URLs (SSRF boundary).
    await engine.repo.db.query('INSERT INTO source_facts(id,user_id,url,text,verified,personal) VALUES($1,$2,$3,$4,$5,$6)', [id, engine.userId, source.url, source.text, source.verified, source.personal]);
    return reply.code(201).send({ id, ...source });
  });
  app.post('/v1/posts/:id/metrics', async (request, reply) => {
    const { id } = idParam.parse(request.params); const metrics = metricsSchema.parse(request.body);
    await recordMetrics(engine.repo.db, engine.userId, id, { ...metrics, source: 'manual' }, (await engine.settings()).timezone); return reply.code(201).send({ recorded: true });
  });
  app.get('/v1/analytics', async () => ({ patterns: await patterns(engine.repo.db, engine.userId),
    metrics: (await engine.repo.db.query('SELECT * FROM linkedin_metrics WHERE user_id=$1 ORDER BY observed_at DESC LIMIT 200', [engine.userId])).rows,
    note: 'Eksik veriler null kalır. Skor için impressions, reactions, comments, reposts gerekir. En az iki gönderi olmadan bir kalıp kanıtlanmış sayılmaz.' }));
  app.get('/v1/report', async () => ({ report: await weeklyReport(engine.repo.db, engine.userId, new Date(), (await engine.settings()).timezone) }));
  app.get('/v1/jobs', async () => ({ jobs: (await engine.repo.db.query('SELECT id,type,status,run_at,attempts,last_error FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [engine.userId])).rows,
    outbox: (await engine.repo.db.query('SELECT id,status,attempts,last_error FROM outbox WHERE user_id=$1 AND status<>\'done\' ORDER BY created_at LIMIT 100', [engine.userId])).rows }));
  app.post('/v1/jobs/:id/retry', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const result = await engine.repo.db.query("UPDATE jobs SET status='pending',run_at=now(),last_error=NULL WHERE user_id=$1 AND id=$2 AND status='failed' AND type<>'publish' RETURNING id", [engine.userId, id]);
    return result.rowCount ? { queued: true } : reply.code(409).send({ error: 'İş yeniden denenebilir durumda değil. Yayın hataları Telegram üzerinden yönetilir.' });
  });
  app.post('/v1/outbox/:id/retry', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const result = await engine.repo.db.query("UPDATE outbox SET status='pending',attempts=0,run_at=now(),last_error=NULL WHERE user_id=$1 AND id=$2 AND status='failed' RETURNING id", [engine.userId, id]);
    return result.rowCount ? { queued: true } : reply.code(409).send({ error: 'Bildirim yeniden denenebilir durumda değil' });
  });
  app.post('/v1/posts/:id/reconcile', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ urn: z.string().regex(/^urn:li:(share|ugcPost):\d+$/), confirmation: z.literal('LINKEDIN_UZERINDE_YAYINLANDIGINI_KONTROL_ETTIM') }).strict().parse(request.body);
    await engine.repo.db.transaction(async tx => {
      const row = (await tx.query<{ approved_version: number; status: string }>('SELECT approved_version,status FROM post_drafts WHERE user_id=$1 AND id=$2 FOR UPDATE', [engine.userId, id])).rows[0];
      if (row?.status === 'published') {
        const prior = await tx.query<{ linkedin_urn: string }>('SELECT linkedin_urn FROM published_posts WHERE user_id=$1 AND post_id=$2', [engine.userId, id]);
        if (prior.rows[0]?.linkedin_urn === body.urn) return;
      }
      if (!row || row.status !== 'publish_uncertain') throw new ConflictError('Gönderi uzlaştırma beklemiyor');
      const url = `https://www.linkedin.com/feed/update/${body.urn}/`;
      await tx.query('INSERT INTO published_posts(id,user_id,post_id,version,linkedin_urn,url) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), engine.userId, id, row.approved_version, body.urn, url]);
      await tx.query("UPDATE post_drafts SET status='published',failure=NULL,updated_at=now() WHERE user_id=$1 AND id=$2", [engine.userId, id]);
      await tx.query('INSERT INTO outbox(id,user_id,text,buttons,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,dedupe_key) DO NOTHING', [randomUUID(), engine.userId, `✅ LinkedIn üzerindeki yayın kaydı doğrulandı.\n${url}`, JSON.stringify([]), `reconciled:${id}`]);
    });
    return reply.code(200).send({ reconciled: true });
  });
  app.get('/v1/linkedin/connect', async (_request, reply) => oauth ? { authorizationUrl: await oauth.start() } : reply.code(503).send({ error: 'OAuth yapılandırılmadı' }));
  app.get('/v1/linkedin/status', async () => ({ mode: env.APP_MODE, connection: (await engine.repo.db.query("SELECT provider,expires_at,subject,scopes FROM oauth_connections WHERE user_id=$1 AND provider='linkedin'", [engine.userId])).rows[0] ?? null, environmentTokenConfigured: !!env.LINKEDIN_ACCESS_TOKEN }));
  app.get('/oauth/linkedin/callback', async (request, reply) => {
    if (!oauth) return reply.code(503).send({ error: 'OAuth yapılandırılmadı' });
    const query = z.object({ code: z.string().min(1).max(8192), state: z.string().length(43) }).parse(request.query);
    await oauth.complete(query.code, query.state); return { connected: true, message: 'LinkedIn bağlandı. Bu işlem gönderi yayınlamaz.' };
  });
  return app;
}
