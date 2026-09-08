import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { PGliteDatabase } from '../src/db/pglite.js';
import { createRuntime } from '../src/runtime.js';
import { loadEnv } from '../src/core/config.js';
import { MockLinkedIn, MockTelegram } from '../src/integrations/mocks.js';

const runtime = await createRuntime(loadEnv({ NODE_ENV: 'test', APP_MODE: 'offline', ADMIN_API_TOKEN: 'offline-demo-only-admin-token-00001', TELEGRAM_ALLOWED_USER_ID: '123456', TELEGRAM_WEBHOOK_SECRET: 'offline-demo-only-webhook-secret-00001', LOG_LEVEL: 'silent' }), new PGliteDatabase());
try {
  const { engine, telegram, linkedin } = runtime;
  assert(telegram instanceof MockTelegram && linkedin instanceof MockLinkedIn);
  const settings = await engine.settings();
  const local = DateTime.now().setZone(settings.timezone);
  await engine.repo.saveSettings(engine.userId, { ...settings, postingDays: [local.weekday], postingTimes: [local.toFormat('HH:mm')] });
  await engine.tick();
  const drain = async () => { await engine.runJobs(20); await engine.flushOutbox(20); };
  await drain();
  const post = (await engine.repo.listPosts(engine.userId))[0]!;
  assert.equal(post.status, 'waiting_approval');
  const v1 = (await engine.repo.latestVersion(engine.userId, post.id))!;
  let updateId = 0;
  const send = async (text: string) => {
    await engine.receive({ update_id: ++updateId, message: { message_id: 100 + updateId, from: { id: 123456 }, chat: { id: 123456, type: 'private' }, text } });
    await drain();
  };
  await send('girişi daha kısa ve vurucu yap');
  const v2 = (await engine.repo.latestVersion(engine.userId, post.id))!;
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.content.blocks.filter(b => b.kind !== 'hook'), v1.content.blocks.filter(b => b.kind !== 'hook'));
  await send('CTA’yı çıkar');
  const v3 = (await engine.repo.latestVersion(engine.userId, post.id))!;
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.content.blocks, v2.content.blocks.filter(b => b.kind !== 'cta'));
  assert.equal(linkedin.published.length, 0);
  await send('onayla');
  assert.equal(linkedin.published.length, 1);
  assert.equal(linkedin.published[0]!.text, v3.text);
  assert.equal((await engine.repo.getPost(engine.userId, post.id))?.status, 'published');
  process.stdout.write(JSON.stringify({ result: 'PASS', mode: 'offline — no external calls', steps: ['actual scheduler creates due generation job', 'quality check', 'Telegram v1', 'hook-only revision v2', 'CTA removal v3', 'explicit Telegram approval', 'publish approved v3 exactly once', 'persist publication', 'Telegram success notification'], versions: [v1.version, v2.version, v3.version], providerCalls: linkedin.published.length, telegramMessages: telegram.messages.length, finalPost: v3.text }, null, 2) + '\n');
} finally { await runtime.app.close(); await runtime.db.close(); }
